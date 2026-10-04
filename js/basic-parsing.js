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

// Marks the brackets that belong to a pair. An opener that is never closed (e.g. "Sad :(" in a text value)
// and a closer without an opener are plain text, so they do not change the depth.
function pairedBrackets(text) {
  const paired = new Uint8Array(text.length);
  const openers = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '{' || char === '[') {
      openers.push(i);
    } else if ((char === ')' || char === '}' || char === ']') && openers.length > 0) {
      paired[openers.pop()] = 1;
      paired[i] = 1;
    }
  }
  return paired;
}

// True when the bracket at openIndex closes at the last character: no closer of its kind is left over between
// them (a left-over "}" in "{x} {y}" means the first bracket closed earlier)
function closesAtEnd(text, openIndex) {
  const close = BRACKET_CLOSERS[text[openIndex]];
  if (!close || text.length - 1 <= openIndex || text[text.length - 1] !== close) return false;
  const body = text.slice(openIndex + 1, -1);
  const paired = pairedBrackets(body);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === close && !paired[i]) return false;
  }
  return true;
}

// Splits text on a separator (one or more characters) that is at depth 0 (outside brackets)
function splitTopLevel(text, separator) {
  const paired = pairedBrackets(text);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (paired[i]) {
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
  const paired = pairedBrackets(text);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (paired[i]) {
      depth += (char === '(' || char === '{' || char === '[') ? 1 : -1;
    } else if (char === separator && depth === 0) {
      return i;
    }
  }
  return -1;
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

const JSON_NUMBER_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

// A number exactly as Apex printed it: 10.50 stays 10.50, 9007199254740993 and 1.2345E-5 are not rewritten.
// Numbers that a JavaScript number would change are kept as JSON.rawJSON (Chrome 114+); without it, only numbers
// that convert without loss become numbers. Text that is not a number (02134) gives undefined.
function exactNumber(text) {
  if (!JSON_NUMBER_TEXT.test(text)) return undefined;
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
  return structure === undefined ? text : structure;
}

// The whole text as one structure: a record Type:{...}, a class Class:[...], a system object Ns.Type[...],
// a compound address, a list (...), or a set or map {...}. Undefined for anything else (also cut-off text).
function parseStructure(text, depth, ctx) {
  const typed = text.match(/^(\w+):([{[])/);
  if (typed && closesAtEnd(text, typed[0].length - 1)) {
    return parseFields(text.slice(typed[0].length, -1), typed[2] === '{' ? 'record' : 'class', depth, ctx);
  }
  const system = text.match(/^[A-Za-z]\w*(?:\.\w+)+\[/);
  if (system && closesAtEnd(text, system[0].length - 1)) {
    return parseSystemFields(text.slice(system[0].length, -1), depth, ctx);
  }
  if (text.startsWith('API address [') && closesAtEnd(text, 12)) {
    const address = parseAddress(text.slice(13, -1));
    if (address !== undefined) return address;
  }
  if (text[0] === '(' && closesAtEnd(text, 0)) {
    return parseItems(text.slice(1, -1), depth, ctx);
  }
  // A JSON text value such as {"a":1} stays text
  if (text[0] === '{' && closesAtEnd(text, 0) && !/^\{\s*"/.test(text)) {
    const body = text.slice(1, -1);
    if (body === '') return {};
    // A map entry always has "=" (a set of texts with "=" in them looks the same and is read as a map)
    return indexOfTopLevel(splitTopLevel(body, ', ')[0], '=') > 0 ? parseFields(body, 'map', depth, ctx) : parseItems(body, depth, ctx);
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

// Items of a list or set: "a, b, c" -> array
function parseItems(body, depth, ctx) {
  if (body === '') return [];
  return dropCutMarker(splitTopLevel(body, ', '), ctx).map(part => parseValue(part, depth + 1, ctx));
}

const FIELD_NAME = /^[A-Za-z]\w*$/;
const CLASS_FIELD_NAME = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)*$/;

// "key=value, key=value" -> object. Each entry splits on its first "=" at depth 0. A part that does not start a
// new entry belongs to the previous value (e.g. Name=Smith, John):
// - record fields are names; class fields are names too, Parent.field for an inherited field
// - map keys can be any text, e.g. {first name=Bob} or {Account:{Name=Bob}=null}
// kind: 'record', 'class' or 'map'
function parseFields(body, kind, depth, ctx) {
  const parts = body === '' ? [] : splitTopLevel(body, ', ');
  if (kind === 'map') dropCutMarker(parts, ctx);
  // Salesforce prints class fields sorted by character code, so a name that does not sort after the previous
  // one is text (e.g. note=a, b=c). The order decides only when it is clearly there: many names out of order
  // mean another format, e.g. a toString() override that looks like a class.
  let entries = collectFieldEntries(parts, kind, kind === 'class');
  if (entries.outOfOrder * 4 > entries.length) entries = collectFieldEntries(parts, kind, false);
  const names = kind === 'class' ? inheritedFieldNames(entries.map(([key]) => key)) : entries.map(([key]) => key);
  const result = {};
  entries.forEach(([, rawValue], i) => {
    result[names[i]] = rawValue === null ? null : parseValue(rawValue, depth + 1, ctx);
  });
  return result;
}

// Entries of a record, class or map; entries.outOfOrder counts class names left as text because of their order
function collectFieldEntries(parts, kind, useOrder) {
  let previousName = null;
  let outOfOrder = 0;
  const entries = collectEntries(parts, ', ', (key) => {
    if (kind === 'map') return true;
    if (!(kind === 'class' ? CLASS_FIELD_NAME : FIELD_NAME).test(key)) return false;
    if (!useOrder || key.includes('.')) return true;
    if (previousName !== null && key <= previousName) {
      outOfOrder++;
      return false;
    }
    previousName = key;
    return true;
  });
  entries.outOfOrder = outOfOrder;
  return entries;
}

// [[key, raw value]] from "key=value" parts; a part whose key is not accepted joins the previous value
function collectEntries(parts, joiner, acceptKey) {
  const entries = [];
  for (const part of parts) {
    const equalIndex = indexOfTopLevel(part, '=');
    const key = equalIndex > 0 ? part.slice(0, equalIndex).trim() : '';
    if (key !== '' && acceptKey(key)) {
      entries.push([key, part.slice(equalIndex + 1)]);
    } else if (entries.length > 0 && entries[entries.length - 1][1] !== null) {
      entries[entries.length - 1][1] += joiner + part;
    } else {
      entries.push([part.trim(), null]);
    }
  }
  return entries;
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
function parseSystemFields(body, depth, ctx) {
  const getters = /^(?:get|is)[A-Z]\w*=/.test(body);
  const separator = getters ? ';' : ', ';
  const parts = body === '' ? [] : splitTopLevel(getters && body.endsWith(';') ? body.slice(0, -1) : body, separator);
  const entries = collectEntries(parts, separator, (key) => (getters ? SYSTEM_GETTER : FIELD_NAME).test(key));
  const result = {};
  for (const [key, rawValue] of entries) {
    const name = getters && key.startsWith('get') ? key.charAt(3).toLowerCase() + key.slice(4) : key;
    result[name] = rawValue === null ? null : parseValue(rawValue, depth + 1, ctx);
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
