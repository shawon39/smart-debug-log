// Complex Salesforce Object Parsing
// This file contains the entry point for custom class bodies and quoted arrays ("[key=value, ...]").
// The parsing itself is done by the depth-aware toString() parser in basic-parsing.js.

function parseComplexContent(content) {
  try {
    // This function handles complex content that can contain key=value pairs
    // and nested collections like Bookmarks=(Bookmark:[...], Bookmark:[...])
    return parseFields(splitItems({ body: content }), 'record', 1, { cut: false });
  } catch (error) {
    return content;
  }
}
