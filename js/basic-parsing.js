// Basic Salesforce Object Parsing
// This file contains the parser for the text System.debug prints for Apex values (toString(), see System.debug.md):
// SObjects Type:{...}, classes Class:[...], system classes Ns.Type[...], lists (...), sets {...} and maps {key=value}.
// Salesforce separates items with ", " (fields of system classes with ";"). Splitting is depth aware: separators
// and the key "=" only count outside (), {} and [].
// Quotes are not delimiters: toString() does not quote strings, so O'Brien is just text.

// Deeper nesting than this is shown as text
const TOSTRING_MAX_DEPTH = 50;

// Printed for an object that was already printed earlier in the same value (a shared reference or a cycle)
const TOSTRING_ALREADY_OUTPUT = '(already output)';
const ALREADY_OUTPUT_LABEL = '(same object as above)';

// Salesforce prints only the first 10 items of a list, set or map, then this marker
const TOSTRING_CUT_MARKER = '...';

const BRACKET_CLOSERS = { '(': ')', '{': '}', '[': ']' };

// Parses text that is one toString value. Returns { value, cut } (cut: Salesforce left out items after the 10th),
// or null when the text is not one record, class, system object, list, set or map.
function parseApexValueText(text) {
  try {
    const ctx = { cut: false };
    const value = parseStructure(String(text).trim(), 1, ctx);
    return value === undefined ? null : { value, cut: ctx.cut };
  } catch (error) {
    return null;
  }
}

// The value of parseApexValueText, or the trimmed text when it is not a structure
function parseSalesforceObjectNotation(text) {
  const result = parseApexValueText(text);
  return result ? result.value : String(text).trim();
}

// A custom exception prints as "ProbeException:[]: message" (its class body is empty). It is shown like a System
// exception, "ProbeException: message" (Apex exception class names end with "Exception").
function tidyExceptionText(text) {
  return text.replace(/\b(\w*Exception):\[\]: /g, '$1: ');
}

// For each bracket, the index of the bracket that pairs with it, or -1. An opener that is never closed (e.g.
// "Sad :(" in a text value) and a closer without an opener are plain text, so they do not change the depth.
function bracketPartners(text) {
  const partner = new Int32Array(text.length).fill(-1);
  const openers = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '{' || char === '[') {
      openers.push(i);
    } else if ((char === ')' || char === '}' || char === ']') && openers.length > 0) {
      const open = openers.pop();
      partner[open] = i;
      partner[i] = open;
    }
  }
  return partner;
}

// { body, partner } for the text between the bracket at openIndex and the last character, when that bracket closes
// at the end: no closer of its kind is left over in the body (a left-over "}" in "{x} {y}" means the first bracket
// closed earlier). Null otherwise.
function closedBody(text, openIndex) {
  const close = BRACKET_CLOSERS[text[openIndex]];
  if (!close || text.length - 1 <= openIndex || text[text.length - 1] !== close) return null;
  const body = text.slice(openIndex + 1, -1);
  const partner = bracketPartners(body);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === close && partner[i] < 0) return null;
  }
  return { body, partner };
}

// Splits text on a separator (one or more characters) that is at depth 0 (outside brackets)
function splitTopLevel(text, separator, partner = bracketPartners(text)) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (partner[i] >= 0) {
      depth += (char === '(' || char === '{' || char === '[') ? 1 : -1;
    } else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i));
      start = i + separator.length;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// Index of the first separator character at depth 0, or -1
function indexOfTopLevel(text, separator) {
  const partner = bracketPartners(text);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (partner[i] >= 0) {
      depth += (char === '(' || char === '{' || char === '[') ? 1 : -1;
    } else if (char === separator && depth === 0) {
      return i;
    }
  }
  return -1;
}

// The items of a list, set or map, or the fields of a record or class: { parts, joiner }. Salesforce separates them
// with ", "; text built in code often uses "," alone, so "," is used when there is no ", " at depth 0.
function splitItems({ body, partner = bracketPartners(body) }) {
  if (body === '') return { parts: [], joiner: ', ' };
  const parts = splitTopLevel(body, ', ', partner);
  if (parts.length > 1) return { parts, joiner: ', ' };
  const commaParts = splitTopLevel(body, ',', partner);
  return commaParts.length > 1 ? { parts: commaParts.map(part => part.trim()), joiner: ',' } : { parts, joiner: ', ' };
}

// Converts number text only when nothing is lost: no leading zeros (02134), within the safe
// integer range, and decimals that print back the same (trailing zeros aside)
function parseSafeNumber(text) {
  if (/^-?(0|[1-9]\d*)$/.test(text)) {
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(text)) {
    const number = Number(text);
    return String(number) === text.replace(/\.?0+$/, '') ? number : undefined;
  }
  return undefined;
}

// Numbers as Apex prints them: Integer, Long and Decimal (10.50), Double in scientific notation (1.2345E-5,
// 1.23456789015E10: a decimal point before the E) and Decimal in scientific notation (1E-7, 1.5E+8: a sign after
// the E). Text such as 02134 or the code 1E5 stays text.
const APEX_NUMBER_TEXT = /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\d(?:\.\d+E[+-]?|E[+-])\d+)$/;

// A number exactly as Apex printed it: 10.50 stays 10.50, 9007199254740993 and 1.2345E-5 are not rewritten.
// Numbers that a JavaScript number would change are kept as JSON.rawJSON (Chrome 114+); without it, only numbers
// that convert without loss become numbers. Text that is not a number gives undefined.
function exactNumber(text) {
  if (!APEX_NUMBER_TEXT.test(text)) return undefined;
  const number = Number(text);
  if (String(number) === text) return number;
  if (typeof JSON.rawJSON === 'function') return JSON.rawJSON(text);
  return parseSafeNumber(text);
}

// One value: null, true/false, a number, (already output), a structure, or text
function parseValue(text, depth, ctx) {
  if (text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  const number = exactNumber(text);
  if (number !== undefined) return number;
  if (text === TOSTRING_ALREADY_OUTPUT) return ALREADY_OUTPUT_LABEL;
  if (depth > TOSTRING_MAX_DEPTH) return text;
  const structure = parseStructure(text, depth, ctx);
  return structure === undefined ? tidyExceptionText(text) : structure;
}

// The whole text as one structure: a record Type:{...}, a class Class:[...], a system object Ns.Type[...],
// a compound address, a list (...), or a set or map {...}. Undefined for anything else (also cut-off text).
function parseStructure(text, depth, ctx) {
  const typed = text.match(/^(\w+):([{[])/);
  const typedBody = typed && closedBody(text, typed[0].length - 1);
  if (typedBody) {
    return parseFields(splitItems(typedBody), typed[2] === '{' ? 'record' : 'class', depth, ctx);
  }
  const system = text.match(/^[A-Za-z]\w*(?:\.\w+)+\[/);
  const systemBody = system && closedBody(text, system[0].length - 1);
  if (systemBody) return parseSystemFields(systemBody, depth, ctx);
  const addressBody = text.startsWith('API address [') && closedBody(text, 12);
  if (addressBody) {
    const address = parseAddress(addressBody.body);
    if (address !== undefined) return address;
  }
  const listBody = text[0] === '(' && closedBody(text, 0);
  if (listBody) return parseItems(splitItems(listBody), depth, ctx);
  // A JSON text value such as {"a":1} stays text
  const braceBody = text[0] === '{' && !/^\{\s*"/.test(text) && closedBody(text, 0);
  if (braceBody) {
    if (braceBody.body === '') return {};
    const items = splitItems(braceBody);
    // A map entry always has "=" (a set of texts with "=" in them looks the same and is read as a map)
    return indexOfTopLevel(items.parts[0], '=') > 0 ? parseFields(items, 'map', depth, ctx) : parseItems(items, depth, ctx);
  }
  return undefined;
}

// Drops Salesforce's "..." after the 10th item of a list, set or map
function dropCutMarker(parts, ctx) {
  if (parts.length > 1 && parts[parts.length - 1] === TOSTRING_CUT_MARKER) {
    parts.pop();
    ctx.cut = true;
  }
  return parts;
}

// Items of a list or set -> array
function parseItems({ parts }, depth, ctx) {
  return dropCutMarker(parts, ctx).map(part => parseValue(part, depth + 1, ctx));
}

const FIELD_NAME = /^\w+$/;
const CLASS_FIELD_NAME = /^\w+(?:\.\w+)*$/;

// Fields "key=value" -> object. Each entry splits on its first "=" at depth 0. A part that does not start a new
// entry belongs to the previous value (e.g. Name=Smith, John):
// - record fields are names; class fields are names too, Parent.field for an inherited field
// - map keys can be any text, e.g. {first name=Bob} or {Account:{Name=Bob}=null}
// kind: 'record', 'class' or 'map'
function parseFields({ parts, joiner }, kind, depth, ctx) {
  if (kind === 'map') dropCutMarker(parts, ctx);
  let entries = collectFieldEntries(parts, joiner, kind, kind === 'class');
  if (entries.unsorted) entries = collectFieldEntries(parts, joiner, kind, false);
  const names = kind === 'class' ? inheritedFieldNames(entries.map(([key]) => key)) : entries.map(([key]) => key);
  const result = {};
  entries.forEach(([, rawValue], i) => {
    setEntry(result, names[i], rawValue === null ? null : parseValue(rawValue, depth + 1, ctx));
  });
  return result;
}

// Entries of a record, class or map. Salesforce prints class fields sorted by character code, so in a class a name
// that does not sort after the previous one is text inside the previous value (e.g. note=a, b=c). That holds only
// for a text value: after a number, null, true/false or a structure, or when many names are out of order, the
// fields were not printed sorted (e.g. a toString() override that looks like a class) and entries.unsorted is set.
function collectFieldEntries(parts, joiner, kind, useOrder) {
  let previousName = null;
  let outOfOrder = 0;
  let unsorted = false;
  const entries = collectEntries(parts, joiner, (key, previousValue) => {
    if (kind === 'map') return true;
    if (!(kind === 'class' ? CLASS_FIELD_NAME : FIELD_NAME).test(key)) return false;
    if (!useOrder || key.includes('.')) return true;
    if (previousName !== null && key <= previousName) {
      if (!isTextValue(previousValue)) {
        unsorted = true;
        return true;
      }
      outOfOrder++;
      return false;
    }
    previousName = key;
    return true;
  });
  entries.unsorted = unsorted || outOfOrder * 4 > entries.length;
  return entries;
}

// True when a raw value reads as text: not null, true/false, a number, a list, set, map, record or class
function isTextValue(rawValue) {
  if (rawValue === null || rawValue === 'null' || rawValue === 'true' || rawValue === 'false') return false;
  if (exactNumber(rawValue) !== undefined || /^[({[]/.test(rawValue)) return false;
  return !/^\w+:[{[]/.test(rawValue) && !/^[A-Za-z]\w*(?:\.\w+)+\[/.test(rawValue);
}

// [[key, raw value]] from "key=value" parts; a part whose key is not accepted joins the previous value.
// acceptKey(key, previous raw value) decides.
function collectEntries(parts, joiner, acceptKey) {
  const entries = [];
  for (const part of parts) {
    const equalIndex = indexOfTopLevel(part, '=');
    const key = equalIndex > 0 ? part.slice(0, equalIndex).trim() : '';
    const previous = entries.length > 0 ? entries[entries.length - 1] : null;
    if (key !== '' && acceptKey(key, previous ? previous[1] : null)) {
      entries.push([key, part.slice(equalIndex + 1)]);
    } else if (previous && previous[1] !== null) {
      previous[1] += joiner + part;
    } else {
      entries.push([part.trim(), null]);
    }
  }
  return entries;
}

// Sets a key on a plain object, also "__proto__" (an assignment would set the object's prototype instead)
function setEntry(object, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    object[key] = value;
  }
}

// Inherited fields (BaseItem.price) are shown by their own name (price) unless another field has that name
function inheritedFieldNames(keys) {
  const shortName = (key) => CLASS_FIELD_NAME.test(key) ? key.slice(key.lastIndexOf('.') + 1) : key;
  const counts = new Map();
  keys.forEach(key => counts.set(shortName(key), (counts.get(shortName(key)) || 0) + 1));
  return keys.map(key => counts.get(shortName(key)) === 1 ? shortName(key) : key);
}

const SYSTEM_GETTER = /^(?:get|is)[A-Z]\w*$/;

// System class objects: getter names with ";" after each, e.g.
// Database.SaveResult[getErrors=(...);getId=null;isSuccess=false;] (getId is shown as id), or
// "Name=value, " pairs, e.g. System.HttpRequest[Endpoint=https://x.com, Method=POST].
// A part without a name belongs to the previous value (a message can contain ";").
function parseSystemFields({ body, partner }, depth, ctx) {
  const getters = /^(?:get|is)[A-Z]\w*=/.test(body);
  const { parts, joiner } = getters
    ? { parts: splitTopLevel(body.endsWith(';') ? body.slice(0, -1) : body, ';'), joiner: ';' }
    : splitItems({ body, partner });
  const entries = collectEntries(parts, joiner, (key) => (getters ? SYSTEM_GETTER : FIELD_NAME).test(key));
  const result = {};
  for (const [key, rawValue] of entries) {
    const name = getters && key.startsWith('get') ? key.charAt(3).toLowerCase() + key.slice(4) : key;
    setEntry(result, name, rawValue === null ? null : parseValue(rawValue, depth + 1, ctx));
  }
  return result;
}

const ADDRESS_FIELDS = ['city', 'state', 'postalCode', 'country', 'stateCode', 'countryCode', 'latitude', 'longitude', 'geocodeAccuracy'];

// Compound address field: "API address [ street, city, state, postalCode, country, stateCode, countryCode,
// latitude, longitude, geocodeAccuracy]" -> the parts that are not null. It splits from the right because
// the street can hold commas and line breaks.
function parseAddress(body) {
  const parts = body.split(', ');
  if (parts.length <= ADDRESS_FIELDS.length) return undefined;
  const values = parts.splice(parts.length - ADDRESS_FIELDS.length);
  const street = parts.join(', ').trim();
  const address = {};
  if (street !== 'null' && street !== '') address.street = street;
  ADDRESS_FIELDS.forEach((name, i) => {
    if (values[i] === 'null') return;
    const number = name === 'latitude' || name === 'longitude' ? exactNumber(values[i]) : undefined;
    address[name] = number !== undefined ? number : values[i];
  });
  return address;
}
