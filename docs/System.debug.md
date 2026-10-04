You are trying to do something pretty hardcore here: reverse-engineer `System.debug` output and build your *own* JSON formatter on top of that. That is possible in a “best effort” way, but it will always be a bit fragile because Salesforce does not officially guarantee these string formats.

I will do what you asked:

1. Summarize what `System.debug` actually uses internally.
2. Show concrete patterns for different Apex types (based on real examples).
3. Propose a parsing strategy you can build into your tool to turn those patterns into JSON.

---

## 1. What `System.debug` actually prints

`System.debug(obj)` is effectively:

```apex
System.debug(String.valueOf(obj));
```

`String.valueOf`:

* If `obj` is `null`, returns the literal string `'null'`.
* If not null, it calls `obj.toString()` internally. ([Medium][1])

So your parser is really a **`toString()` parser**.

Key point:
Different types have different default `toString()` implementations:

* **Primitives**: basic textual value (`5`, `true`, `2024-05-01 10:15:00`, `null`, etc.). ([Lightning Challenge][2])
* **Lists, Sets, Maps**: custom formats based on container type. ([Salesforce Developers][3])
* **SObjects**: `ObjectName:{Field1=value1, Field2=value2, ...}`. ([OpFocus][4])
* **Custom classes (no override)**: `ClassName:[field1=value1, field2=value2]`. ([O'Reilly Media][5])

There is **no setting** in Salesforce that tells `System.debug` to “print JSON instead”. You only control:

* Log levels (Apex code, System, etc.). ([Salesforce][6])
* Whether you yourself call `JSON.serialize` / `serializePretty` before `System.debug`. ([OpFocus][4])

So if you want JSON, you either:

* Call `JSON.serialize(JSONStuff)` yourself, or
* Parse these `toString()` formats and convert them manually, which is what you want to do.

---

## 2. Observed patterns per type (your “research test”)

Below is a compact catalog of **real patterns** from docs and community examples.

### 2.1 Primitive values

Rough pattern (after trimming):

* **Integer / Long / Decimal**:
  `123`, `-5`, `3.14`

* **Boolean**:
  `true` or `false` ([Lightning Challenge][2])

* **Date / Datetime / Time**:
  *Date* often prints in locale format or using `.format()` if you used it yourself.
  *Datetime* examples: `2020-01-28T22:30:48Z` or `2020-01-28 23:52:20` depending on formatting methods. ([Gist][7])

* **String**:
  Value text with **no quotes**. Example: `Hello world`.

* **Null**:
  Literal `null` (string) when you log `null` via `System.debug`. ([Medium][1])

Heuristic for parser:
Try `null` → JSON null.
Then try `true` / `false` → JSON booleans.
Then number regex → JSON number.
Else → JSON string.

---

### 2.2 SObjects

Single SObject:

```apex
Account a = new Account(
    Name = 'Test Account',
    BillingStreet = '123 Test Dr',
    BillingCity = 'Test City'
);
System.debug(a);
```

Typical output:

```text
Account:{Name=Test Account, BillingStreet=123 Test Dr, BillingCity=Test City, ...}
```

OpFocus and other blogs show exactly this style. ([johnspipkin][8])

Important details:

* Prefix: `<ObjectName>:` (e.g. `Account:`, `Contact:`, `MyCustom__c:`).
* Then `{` ... `}` with `FieldName=value` pairs separated by `, `.
* Some **values themselves** contain brackets and commas, for example compound address:

  `BillingAddress=API address [ The Landmark @ One Market, SanFrancisco, CA, 94105, US, null, ...]` ([niteshsalesforce.blogspot.com][9])

So a naive `split(',')` will break.

Your parser should:

* Detect regex like `^([A-Za-z0-9_]+:{)` → treat as SObject or custom class.
* Parse inside `{ ... }` with **depth counters** for `[]`, `{}`, `()` to handle commas inside values.

---

### 2.3 Lists

**List of primitives**

Example from Apex List docs:

```apex
List<Integer> numbers = new List<Integer>{47, 52, null};
System.debug(numbers);
```

Log looks like:

````text
(47, 52, null)
``` :contentReference[oaicite:12]{index=12}  

So:

* Outer parentheses: `(` ... `)`  
* Elements separated by `, `  
* Elements themselves use the **primitive rules**.

**List of SObjects**

From an example log:  

```text
USER_DEBUG|[13]|DEBUG|(Account:{Id=001..., Name=sForceTest1, ...}, ...)
``` :contentReference[oaicite:13]{index=13}  

So for lists of SObjects:

* Outer parentheses: `(` ... `)`  
* Inside: `Account:{...}` chunks separated by `, `.

Heuristic:

* If trimmed value starts with `(` and ends with `)` → treat as **List**.  
* Inside, split on `,` at depth 0, then recursively parse each entry.

---

### 2.4 Sets

From Set examples and training material:

```apex
Set<Integer> s = new Set<Integer>{1, 2, 3};
System.debug(s);
````

Debug prints like:

````text
{1, 2, 3}
``` :contentReference[oaicite:14]{index=14}  

For Set of SObjects:

```text
{Account:{Name=Test1}, Account:{Name=Test2}}
````

Heuristic:

* Starts with `{` and ends with `}`
* Elements separated by `, `
* **No un-nested `=` signs** at top level → treat as Set, not Map.

Then parse each element recursively (same as list).

---

### 2.5 Maps

Map example from a tutorial:

```apex
Map<Integer, String> priceMap = new Map<Integer, String>{
    40000 => 'motorola',
    50000 => 'samsung'
};
System.debug('My Mobile prices List = ' + priceMap);
```

Debug:

````text
My Mobile prices List = {40000=motorola, 50000=samsung, 60000=nokia, 70000=iphone x}
``` :contentReference[oaicite:15]{index=15}  

Map with SObject keys:

```apex
Map<Account, Integer> m = new Map<Account, Integer>();
// ...
System.debug(m);
````

Examples show patterns like:

````text
{Account:{Name=Bob}=null}
``` :contentReference[oaicite:16]{index=16}  

So pattern:

* Outer `{` `}` like Set.  
* Inside: entries like `<key>=<value>` separated by `, ` at depth 0.

Heuristic:

* Starts with `{` and ends with `}`  
* At top level you find `=` separators → treat as **Map**.  
* For each entry:
  * Split on the **first** `=` at depth 0 → left is key, right is value.  
  * Recursively parse left and right.

For JSON, you must decide:

* Use keys as JSON object keys (stringify); or  
* Represent as array of `{ "key": ..., "value": ... }`.

---

### 2.6 Custom Apex classes

From Apex Design Patterns:  

```apex
public class ToStringDemo {
    public String companyName {get;set;}
    public String city {get;set;}
}

ToStringDemo obj = new ToStringDemo();
obj.companyName = 'Salesforce';
obj.city = 'SFO';
System.debug(obj);
````

Output:

```text
ToStringDemo:[city=SFO, companyName=Salesforce]
```

And they explicitly say:

> Salesforce uses predefined `className:[variable1=value,variable2=value,...]` format for objects where you did not override `toString()` ([O'Reilly Media][5])

Heuristic:

* Regex like `^([A-Za-z0-9_]+):\[.*\]$` → custom class with default `toString`.
* Inside `[...]` same style as SObject fields, but brackets are square.

Be careful: many devs override `toString()` in custom classes, so format may be anything.

---

### 2.7 Prefix text around the value

In real logs you often see:

````text
DEBUG|My Mobile prices List = {40000=motorola, 50000=samsung, ...}
``` :contentReference[oaicite:18]{index=18}  

Or:

```apex
System.debug('***** user1 : ' + JSON.serializePretty(user1));
````

So for your parser:

* Strip the part **before** the first `=` or `:` that does not look like a type pattern.
* Or simpler: split on `|DEBUG|` at log level, then inside message find the **first occurrence that looks like one of your patterns** and parse only that part.

You already parse JSON segments, so you can also check:

* If message contains `{` followed by `"` → likely JSON, your existing logic.
* Else → try `toString` patterns.

---

## 3. Strategy to turn this into JSON

Now, how do you turn all these messy formats into JSON in a robust way?

I suggest a **recursive descent parser with type detection**.

### 3.1 High level algorithm

For each debug message:

1. **Extract the value portion**

   From full log line:

   ```text
   12:00:00.000 (1234567)|USER_DEBUG|[45]|DEBUG|My Mobile prices List = {40000=motorola, 50000=samsung}
   ```

   Split on `|DEBUG|`, take the right side:

   ```text
   My Mobile prices List = {40000=motorola, 50000=samsung}
   ```

   Then:

   * If you want, store `"My Mobile prices List"` as `label`.
   * Value candidate is the substring after the last `=`, or just scan for first substring that matches one of the patterns.

2. **Type detection function**

   Pseudo:

   ```text
   detectType(str):

     trim s

     if s == 'null' -> Null
     if s == 'true' or 'false' -> Boolean
     if matches number regex -> Number

     if s starts with '(' and ends with ')' -> List
     if s starts with '{' and ends with '}':
         if has '=' at depth 0 -> Map
         else -> Set

     if matches ^[A-Za-z0-9_]+:\{.*\}$ -> SObject-like
     if matches ^[A-Za-z0-9_]+:\[.*\]$ -> CustomClass-default-toString

     else -> String
   ```

3. **Recursive parse by type**

   *Primitive / null / boolean / number*
   -> Directly to JSON primitive.

   *List*

   * Drop outer `(` `)`.
   * Walk char by char, keep counters for `()`, `{}`, `[]`.
   * Do not treat quotes as delimiters: `toString()` does not quote strings, so an apostrophe (`Name=O'Brien`) is plain text. Only real JSON has quoted strings.
   * When you see a comma at depth 0 and not inside quotes, split.
   * For each element, call parser recursively.

   *Set*

   Same as List but using `{` `}` and with an extra check that there is no `=` at depth 0.

   *Map*

   * Drop outer `{` `}`.
   * First split into **entries** by commas at depth 0.
   * For each entry:

     * Find first `=` at depth 0.
     * Left side → parse recursively as key.
     * Right side → parse recursively as value.
   * Convert to your chosen JSON shape.

   *SObject / custom class*

   For `Account:{...}` or `MyClass:[...]`:

   * Extract type name: substring before `:`.
   * Inside body: `{...}` or `[...]`

   Body handling:

   * Use same depth-aware parsing.
   * For each `field=value` pair:

     * Split on the first `=` at depth 0.
     * Field name = left.
     * Value = right, parse recursively.

   JSON shape example (the type name is left out: it is noise in the debug view):

   ```json
   {
     "Name": "Test Account",
     "BillingStreet": "123 Test Dr"
   }
   ```

   For custom class:

   ```json
   {
     "city": "SFO",
     "companyName": "Salesforce"
   }
   ```

4. **Combine with label (optional)**

   If original message was:

   ```text
   My Mobile prices List = {40000=motorola, 50000=samsung}
   ```

   You can emit:

   ```json
   {
     "label": "My Mobile prices List",
     "value": {
       "40000": "motorola",
       "50000": "samsung"
     }
   }
   ```

---

## 4. Limitations you must accept

I will be direct here because this is important.

1. **Formats are not formally documented or guaranteed.**
   Community examples and books explain current behavior, but Salesforce treats `toString()` format as a debug representation, not a contract. ([Salesforce Stack Exchange][10])

2. **toString can be overridden.**
   Any custom class can override `toString()` and output arbitrary text or JSON. Then your parser logic may fail or mis-detect.

3. **Values can contain commas, equals, brackets.**
   You already saw address example that contains `,` inside `[]`. ([niteshsalesforce.blogspot.com][9])
   Your depth-aware parsing reduces risk, but edge cases will still exist (for example, free-text fields with `=` characters).

4. **Truncation and log limits.**
   Large values are truncated by the log size limit. Even `JSON.serializePretty` gets truncated when too large. ([Salesforce Stack Exchange][11])
   Your parser must handle incomplete trailing data gracefully.

So your system will be “best effort”, not 100 percent safe.

---

## 5. Practical best practices to combine with this

If you want this to be usable and not a headache:

1. **Standardize how you log complex objects**

   For example:

   ```apex
   Logger.logObject('orderSummary', myOrderSummary);
   ```

   Where `Logger.logObject` internally does either:

   * `System.debug(JSON.serializePretty(obj));` for critical stuff. ([OpFocus][4])
   * Or `System.debug(obj);` when you want to exercise your toString parser.

   Your external parser always knows:

   * `"orderSummary"` is the label.
   * Value segment starts after `=` or after a known marker.

2. **Override `toString()` for your own classes**

   For your core domain classes, you can make life easy:

   ```apex
   public override String toString() {
       return JSON.serialize(this);
   }
   ```

   Then `System.debug(myDomainObj);` already outputs JSON for those classes, and your existing JSON path handles them.

3. **Use a logging framework for serious structured logs**

   For production-grade logging, use an Apex logging framework (Nebula Logger, Triton, RFLIB, Apex Unified Logging, etc.). These log data into custom objects or platform events in a structured way instead of relying on raw debug strings. ([Pablo Gonzalez][12])

   Your “`System.debug` parser” can then be an **extra** tool for local debugging, not the only source of truth.

---

## 6. Short answer to “can we base JSON on patterns?”

Yes. You can:

* Use the patterns I listed as your **grammar**.
* Build a depth-aware recursive parser that turns those `toString` strings into JSON.
* Combine it with your existing JSON detection (`JSON.CLS` side) so the tool supports both real JSON and Apex debug strings.

But you must accept:

* It will never be 100 percent reliable, because the format is not a public contract.
* You should keep it as a helper for debugging, not as the only way to move data between systems.

If you want, next step I can help you design the actual parsing grammar and a small prototype (for example in JavaScript or Apex) based on these rules.

---

## 7. Observed in a real org (API 67, 2026-10-04)

Captured in a Developer Edition org (with a namespace) from anonymous Apex and a deployed test class with wrappers,
inner classes, inheritance, properties, enums, a `toString()` override and a custom exception. The messages are in
`tests/fixtures/real-org-debug.log` (Ids anonymised) and checked by `tests/track-b-parsing.test.js`.

| Value | Printed as |
|---|---|
| SObject | `Account:{Id=…, Name=…}`. Fields in query or assignment order. Explicit nulls print (`Phone=null`), empty strings print `Website=`. Parent relationships (`Owner.Name`, `c.Account = …`) and child subqueries never print. Multi-line text keeps its line breaks. |
| Address field | `API address [ street, city, state, postalCode, country, stateCode, countryCode, latitude, longitude, geocodeAccuracy]` (the street can hold commas and line breaks) |
| Custom class (top-level, inner, namespaced org) | Short name only: `OrderWrapper:[…]`. Fields sorted by character code (A–Z before a–z). Private and transient fields print, static fields do not. Getter-only properties print `null`. Inherited fields print as `BaseItem.price=…`. No fields: `Empty:[]`. |
| Same object twice, or a cycle | `(already output)` |
| List / Set / Map | `(…)` / `{…}` / `{key=value}`, items separated by `, `. Only the first 10 items, then `...`. String-keyed maps and sets are sorted; enum-keyed maps are not. |
| System classes | `Database.SaveResult[getErrors=(…);getId=null;isSuccess=false;]`, `Database.Error[…;]`, `Schema.DescribeFieldResult[…;]`, `System.Location[getLatitude=37.79;getLongitude=-122.39;]`, `System.HttpRequest[Endpoint=…, Method=POST]`, `System.HttpResponse[Status=…, StatusCode=0]` |
| Exceptions | `System.MathException: Divide by 0`; a custom exception: `ProbeException:[]: message` |
| Primitives | Date `2026-10-04 00:00:00`, Datetime (GMT) `2026-10-04 10:19:41`, Time `10:15:00.000Z`, Decimal keeps its scale `12.50`, Double `1.2345E-5`, Long `9007199254740993`, Blob `Blob[5]`, enum `ACTIVE` |
| Raw log body (Tooling API `ApexLog/{id}/Body`) | Not HTML-escaped: `<b>` and a literal `&amp;` appear as debugged |

What the debug view does with it: no type names; inherited fields by their own name; `(already output)` as
`"(same object as above)"`; the `...` cut as a note under the value; system classes as objects (`getErrors` → `errors`);
addresses as objects without the nulls; numbers exactly as printed (Apex number forms only: `1.0E10`, `1E-7` are
numbers, a code such as `1E5` stays text); `ProbeException:[]: message` as `ProbeException: message`; text around
values kept in place. Text built in code with `,` alone (no space) is split on `,`. Class fields are read in sorted
order only after a text value and when few names are out of order, so `toString()` overrides keep every field.

Still ambiguous (no reliable fix):
* SObject text with `, Name=value` in it (`Description=a=b, c=d`) shows an extra field `c`.
* A `Set<String>` element containing `=` (`{net=30, vip}`) looks the same as a map.

[1]: https://medium.com/%40idanblich/why-your-apex-code-is-one-tostring-away-from-breaking-production-2a05fc874ab7?utm_source=chatgpt.com "Why Your Apex Code is One toString() Away from Breaking ..."
[2]: https://lightningchallenges.com/lessons/apex-syntax/variables-data-types/apex-boolean?utm_source=chatgpt.com "Understanding Boolean Values in Apex"
[3]: https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_methods_system_list.htm?utm_source=chatgpt.com "List Class | Apex Reference Guide"
[4]: https://opfocus.com/blog/debugging-with-json-serializepretty/?utm_source=chatgpt.com "Debugging with JSON.serializePretty()"
[5]: https://www.oreilly.com/library/view/apex-design-patterns/9781782173656/ch06s05.html "The ignoring toString() method - Apex Design Patterns [Book]"
[6]: https://help.salesforce.com/s/articleView?id=code_setting_debug_log_levels.htm&language=en_US&type=5&utm_source=chatgpt.com "Debug Log Levels"
[7]: https://gist.github.com/pratapjadhavar/c20126bf75f8a1920313abe0f0d0d894?utm_source=chatgpt.com "Different date & time formatting in apex salesforce"
[8]: https://johnspipkin.wordpress.com/2016/02/23/debugging-with-json-serializepretty/?utm_source=chatgpt.com "Debugging with JSON.serializePretty() - johnspipkin"
[9]: https://niteshsalesforce.blogspot.com/?utm_source=chatgpt.com "Salesforce knowledge"
[10]: https://salesforce.stackexchange.com/questions/419415/string-join-vs-tostring-in-apex?utm_source=chatgpt.com "String.join() vs. .toString() in Apex"
[11]: https://salesforce.stackexchange.com/questions/255527/system-debugjson-serializeo-not-longer-shows-full-string?utm_source=chatgpt.com "System.debug(JSON.Serialize(o)) Not longer shows full ..."
[12]: https://www.pablogonzalez.io/triton-more-than-an-apex-logging-framework/?utm_source=chatgpt.com "Triton—More than an Apex logging framework - Pablo Gonzalez"
