// Syntax Highlighting for Debug Logs and JSON
// This file handles syntax highlighting for different content types
// Note: escapeHtml() is defined in basic-utilities.js (loaded first)

function applyDebugLogHighlighting(text) {
  // Check if text already contains actual HTML tags (not debug content like <init>)
  // Only match proper HTML tags with valid tag names, not arbitrary angle bracket content
  const hasExistingHTML = /<(span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>/i.test(text) || 
                         /<\/\w+>/.test(text) ||
                         text.includes('SEARCH_HIGHLIGHT_START_') || 
                         text.includes('SEARCH_HIGHLIGHT_END_');
  
  if (hasExistingHTML) {
    // If text already has HTML tags or search markers, apply highlighting carefully
    return applyDebugLogSyntaxToHTML(text);
  } else {
    // Simple case: plain text, escape HTML and apply highlighting
    let highlighted = escapeHtml(text);
    return applyDebugLogPatterns(highlighted);
  }
}

function applyDebugLogSyntaxToHTML(htmlText) {
  // Handle search markers and HTML tags separately
  let result = htmlText;
  
  // First, protect search markers from processing
  const markers = [];
  result = result.replace(/(SEARCH_HIGHLIGHT_START_\d+_\d+_MARKER|SEARCH_HIGHLIGHT_END_\d+_\d+_MARKER)/g, (match, marker) => {
    const index = markers.length;
    markers.push(marker);
    return `PROTECTED_MARKER_${index}`;
  });
  
  // Split into HTML tags and text content, but only split on actual HTML tags
  const parts = result.split(/(<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>|<\/\w+>)/i);
  
  const processedParts = parts.map(part => {
    // If this part is a real HTML tag, return as-is
    if (part.match(/^<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>$|^<\/\w+>$/i)) {
      return part;
    }
    
    // Otherwise, it's text content - escape and apply debug log highlighting
    let highlighted = escapeHtml(part);
    return applyDebugLogPatterns(highlighted);
  });
  
  // Restore protected markers
  let finalResult = processedParts.join('');
  markers.forEach((marker, index) => {
    finalResult = finalResult.replace(`PROTECTED_MARKER_${index}`, marker);
  });
  
  return finalResult;
}

function applyDebugLogPatterns(text) {
  // Apply debug log specific highlighting patterns
  return text
    // Highlight timestamps
    .replace(/^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\))/gm, '<span class="debug-timestamp">$1</span>')
    // Highlight log levels and operations
    .replace(new RegExp('\\|(' + [
      'USER_INFO', 'CODE_UNIT_STARTED', 'USER_DEBUG', 'HEAP_ALLOCATE',
      'SOQL_EXECUTE_BEGIN', 'SOQL_EXECUTE_END', 'SOQL_EXECUTE_EXPLAIN', 'SOSL_EXECUTE_BEGIN', 'SOSL_EXECUTE_END',
      'QUERY_MORE_ITERATIONS', 'QUERY_MORE_BEGIN', 'QUERY_MORE_END', 'DML_BEGIN', 'DML_END', 'FOR_UPDATE_LOCKS_RELEASE',
      'IDEAS_QUERY_EXECUTE', 'USER_MODE_PERMSET_APPLIED', 'BULK_DML_RETRY', 'SAVEPOINT_SET', 'SAVEPOINT_ROLLBACK',
      'SAVEPOINT_RESET', 'SAVEPOINT_RELEASE', 'METHOD_ENTRY', 'METHOD_EXIT', 'STATEMENT_EXECUTE', 'SYSTEM_MODE_ENTER',
      'SYSTEM_MODE_EXIT', 'VARIABLE_SCOPE_BEGIN', 'VARIABLE_ASSIGNMENT', 'CUMULATIVE_LIMIT_USAGE', 'LIMIT_USAGE_FOR_NS',
      'CODE_UNIT_FINISHED', 'WF_RULE_INVOCATION', 'WF_APPROVAL', 'WF_FIELD_UPDATE',
      'WF_SPOOL_ACTION_BEGIN', 'WF_ACTION', 'WF_FORMULA', 'WF_RULE_EVAL_BEGIN', 'WF_RULE_EVAL_END', 'WF_RULE_EVAL_VALUE',
      'WF_CRITERIA_BEGIN', 'WF_CRITERIA_END', 'WF_RULE_ENTRY_ORDER', 'WF_RULE_NOT_EVALUATED', 'WF_RULE_FILTER',
      'WF_ESCALATION_RULE', 'WF_ESCALATION_ACTION', 'WF_TIME_TRIGGERS_BEGIN', 'WF_TIME_TRIGGER', 'WF_ACTIONS_END',
      'WF_ENQUEUE_ACTIONS', 'WF_APPROVAL_SUBMIT', 'WF_APPROVAL_SUBMITTER', 'WF_APPROVAL_REMOVE', 'WF_NEXT_APPROVER',
      'WF_EVAL_ENTRY_CRITERIA', 'WF_PROCESS_FOUND', 'WF_SOFT_REJECT', 'WF_HARD_REJECT', 'WF_PROCESS_NODE', 'WF_ASSIGN',
      'WF_REASSIGN_RECORD', 'WF_RESPONSE_NOTIFY', 'WF_OUTBOUND_MSG', 'WF_ACTION_TASK', 'WF_EMAIL_ALERT', 'WF_EMAIL_SENT',
      'SLA_PROCESS_CASE', 'SLA_NULL_START_DATE', 'SLA_EVAL_MILESTONE', 'SLA_END', 'WF_KNOWLEDGE_ACTION', 'WF_SEND_ACTION',
      'WF_CHATTER_POST', 'WF_QUICK_CREATE', 'WF_FLOW_ACTION_BEGIN', 'WF_FLOW_ACTION_DETAIL', 'WF_FLOW_ACTION_END',
      'WF_FLOW_ACTION_ERROR', 'WF_FLOW_ACTION_ERROR_DETAIL', 'WF_APEX_ACTION', 'EVENT_SERVICE_PUB_BEGIN',
      'EVENT_SERVICE_PUB_DETAIL', 'EVENT_SERVICE_PUB_END', 'EVENT_SERVICE_SUB_BEGIN', 'EVENT_SERVICE_SUB_DETAIL',
      'EVENT_SERVICE_SUB_END', 'SCHEDULED_FLOW_DETAIL', 'FLOW_CREATE_INTERVIEW_BEGIN', 'FLOW_CREATE_INTERVIEW_END',
      'FLOW_CREATE_INTERVIEW_ERROR', 'FLOW_START_INTERVIEWS_BEGIN', 'FLOW_START_INTERVIEWS_END',
      'FLOW_START_INTERVIEWS_ERROR', 'FLOW_START_INTERVIEW_BEGIN', 'FLOW_START_INTERVIEW_END',
      'FLOW_START_INTERVIEW_LIMIT_USAGE', 'FLOW_INTERVIEW_PAUSED', 'FLOW_INTERVIEW_RESUMED',
      'FLOW_INTERVIEW_FINISHED', 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE', 'FLOW_ELEMENT_LIMIT_USAGE',
      'FLOW_BULK_ELEMENT_LIMIT_USAGE', 'FLOW_ELEMENT_BEGIN', 'FLOW_ELEMENT_END', 'FLOW_ELEMENT_FAULT',
      'FLOW_ELEMENT_DEFERRED', 'FLOW_ELEMENT_ERROR', 'FLOW_BULK_ELEMENT_BEGIN', 'FLOW_BULK_ELEMENT_END',
      'FLOW_BULK_ELEMENT_DETAIL', 'FLOW_BULK_ELEMENT_NOT_SUPPORTED', 'FLOW_ASSIGNMENT_DETAIL', 'FLOW_SUBFLOW_DETAIL',
      'FLOW_RULE_DETAIL', 'FLOW_VALUE_ASSIGNMENT', 'FLOW_LOOP_DETAIL', 'FLOW_ACTIONCALL_DETAIL', 'FLOW_WAIT_WAITING_DETAIL',
      'FLOW_WAIT_RESUMING_DETAIL', 'FLOW_WAIT_EVENT_WAITING_DETAIL', 'FLOW_WAIT_EVENT_RESUMING_DETAIL',
      'INVOCABLE_ACTION_DETAIL', 'INVOCABLE_ACTION_ERROR', 'FLOW_COLLECTION_PROCESSOR_DETAIL',
      'FLOW_SCHEDULED_PATH_QUEUED', 'ROUTE_WORK_ACTION', 'ADD_SKILL_REQUIREMENT_ACTION', 'ADD_SCREEN_POP_ACTION',
      'VALIDATION_RULE', 'VALIDATION_FAIL', 'VALIDATION_PASS', 'VALIDATION_ERROR', 'VALIDATION_FORMULA',
      'CALLOUT_REQUEST_PREPARE', 'CALLOUT_REQUEST_FINALIZE', 'CALLOUT_REQUEST', 'CALLOUT_RESPONSE',
      'FUNCTION_INVOCATION_REQUEST', 'FUNCTION_INVOCATION_RESPONSE', 'XDS_RESPONSE', 'XDS_RESPONSE_DETAIL',
      'XDS_RESPONSE_ERROR', 'XDS_REQUEST_DETAIL', 'NAMED_CREDENTIAL_REQUEST', 'NAMED_CREDENTIAL_RESPONSE',
      'NAMED_CREDENTIAL_RESPONSE_DETAIL', 'EXTERNAL_SERVICE_REQUEST', 'EXTERNAL_SERVICE_RESPONSE',
      'EXTERNAL_SERVICE_CALLBACK', 'VARIABLE_SCOPE_END', 'BULK_COUNTABLE_STATEMENT_EXECUTE', 'EXCEPTION_THROWN',
      'CONSTRUCTOR_ENTRY', 'CONSTRUCTOR_EXIT', 'BULK_HEAP_ALLOCATE', 'HEAP_DEALLOCATE', 'FORMULA_BUILD',
      'FORMULA_EVALUATE_BEGIN', 'FORMULA_EVALUATE_END', 'DATAWEAVE_USER_DEBUG', 'USER_DEBUG_FINEST',
      'USER_DEBUG_FINER', 'USER_DEBUG_FINE', 'USER_DEBUG_DEBUG', 'USER_DEBUG_INFO', 'USER_DEBUG_WARN',
      'USER_DEBUG_ERROR', 'EMAIL_QUEUE', 'FATAL_ERROR', 'VF_APEX_CALL', 'VF_PAGE_MESSAGE', 'ENTERING_MANAGED_PKG',
      'HEAP_DUMP', 'SCRIPT_EXECUTION', 'PUSH_NOTIFICATION_NO_DEVICES', 'PUSH_NOTIFICATION_SENT',
      'PUSH_NOTIFICATION_NOT_ENABLED', 'PUSH_NOTIFICATION_INVALID_CERTIFICATE', 'PUSH_NOTIFICATION_INVALID_APP',
      'PUSH_NOTIFICATION_INVALID_NOTIFICATION', 'SESSION_CACHE_PUT_BEGIN', 'SESSION_CACHE_GET_BEGIN',
      'SESSION_CACHE_PUT_END', 'SESSION_CACHE_GET_END', 'SESSION_CACHE_MEMORY_USAGE', 'SESSION_CACHE_REMOVE_BEGIN',
      'SESSION_CACHE_REMOVE_END', 'ORG_CACHE_PUT_BEGIN', 'ORG_CACHE_GET_BEGIN', 'ORG_CACHE_PUT_END',
      'ORG_CACHE_GET_END', 'ORG_CACHE_MEMORY_USAGE', 'ORG_CACHE_REMOVE_BEGIN', 'ORG_CACHE_REMOVE_END',
      'AE_PERSIST_VALIDATION', 'APP_ANALYTICS_FINE', 'APP_ANALYTICS_WARN', 'APP_ANALYTICS_ERROR',
      'CUMULATIVE_PROFILING_BEGIN', 'CUMULATIVE_PROFILING', 'CUMULATIVE_PROFILING_END', 'CUMULATIVE_LIMIT_USAGE_END',
      'TESTING_LIMITS', 'LIMIT_USAGE', 'TOTAL_EMAIL_RECIPIENTS_QUEUED', 'STATIC_VARIABLE_LIST',
      'STACK_FRAME_VARIABLE_LIST', 'REFERENCED_OBJECT_LIST', 'VF_APEX_CALL_START', 'VF_APEX_CALL_END',
      'VF_SERIALIZE_VIEWSTATE_BEGIN', 'VF_SERIALIZE_VIEWSTATE_END', 'VF_DESERIALIZE_VIEWSTATE_BEGIN',
      'VF_DESERIALIZE_VIEWSTATE_END', 'VF_SERIALIZE_CONTINUATION_STATE_BEGIN',
      'VF_SERIALIZE_CONTINUATION_STATE_END', 'VF_DESERIALIZE_CONTINUATION_STATE_BEGIN',
      'VF_DESERIALIZE_CONTINUATION_STATE_END', 'VF_EVALUATE_FORMULA_BEGIN', 'VF_EVALUATE_FORMULA_END',
      'SYSTEM_METHOD_ENTRY', 'SYSTEM_METHOD_EXIT', 'SYSTEM_CONSTRUCTOR_ENTRY', 'SYSTEM_CONSTRUCTOR_EXIT',
      'DUPLICATE_DETECTION_BEGIN', 'DUPLICATE_DETECTION_RULE_INVOCATION',
      'DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY', 'DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS',
      'DUPLICATE_DETECTION_END', 'DUPLICATE_RULE_FILTER', 'DUPLICATE_RULE_FILTER_RESULT',
      'DUPLICATE_RULE_FILTER_VALUE', 'PUSH_TRACE_FLAGS', 'POP_TRACE_FLAGS', 'MATCH_ENGINE_BEGIN',
      'MATCH_ENGINE_INVOCATION', 'MATCH_ENGINE_END', 'RLM_PRICING_BEGIN', 'RLM_PRICING_END',
      'RLM_CONFIGURATOR_BEGIN', 'RLM_CONFIGURATOR_STATS', 'RLM_CONFIGURATOR_END', 'TEMPLATE_PROCESSING_ERROR',
      'WAVE_APP_LIFECYCLE', 'APP_CONTAINER_INITIATED', 'TEMPLATED_ASSET', 'TRANSFORMATION_SUMMARY',
      'RULES_EXECUTION_SUMMARY', 'ASSET_DIFF_SUMMARY', 'JSON_DIFF_SUMMARY', 'RULES_EXECUTION_DETAIL',
      'ASSET_DIFF_DETAIL', 'JSON_DIFF_DETAIL', 'NBA_STRATEGY_BEGIN', 'NBA_STRATEGY_END', 'NBA_NODE_BEGIN',
      'NBA_NODE_END', 'NBA_STRATEGY_ERROR', 'NBA_NODE_ERROR', 'NBA_OFFER_INVALID', 'NBA_NODE_DETAIL'
    ].join('|') + ')\\|', 'g'), '|<span class="debug-operation">$1</span>|')
    // Highlight EXECUTION_STARTED in green and EXECUTION_FINISHED in red (no ending pipe)
    .replace(/\|EXECUTION_STARTED/g, '|<span class="debug-execution-started">EXECUTION_STARTED</span>')
    .replace(/\|EXECUTION_FINISHED/g, '|<span class="debug-execution-finished">EXECUTION_FINISHED</span>')
    // Highlight DEBUG level in USER_DEBUG
    .replace(/\|DEBUG\|/g, '|<span class="debug-level">DEBUG</span>|')
    // Highlight numbers in brackets like [1], [6], [8]
    .replace(/\[(\d+)\]/g, '[<span class="debug-number">$1</span>]')
    // Highlight byte allocations
    .replace(/(Bytes:)(\d+)/g, '$1<span class="debug-number">$2</span>')
    // Highlight query row counts
    .replace(/(Rows:)(\d+)/g, '$1<span class="debug-number">$2</span>')
    // Highlight "out of" limits
    .replace(/(\d+)\s+(out of)\s+(\d+)/g, '<span class="debug-number">$1</span> <span class="debug-text">$2</span> <span class="debug-number">$3</span>');
}

function applyJsonSyntaxHighlighting(text) {
  // Check if text already contains actual HTML tags (not content like <init>)
  const hasExistingHTML = /<(span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>/i.test(text) || 
                         /<\/\w+>/.test(text) ||
                         text.includes('SEARCH_HIGHLIGHT_START_') || 
                         text.includes('SEARCH_HIGHLIGHT_END_');
  
  if (hasExistingHTML) {
    // If text already has HTML tags or search markers, apply highlighting carefully
    return applyJsonSyntaxToHTML(text);
  } else {
    // Simple case: plain text, escape HTML and apply highlighting
    let highlighted = text.replace(/&/g, '&amp;')
                         .replace(/</g, '&lt;')
                         .replace(/>/g, '&gt;');
    
    // Apply JSON syntax highlighting patterns
    highlighted = highlighted
      // Highlight JSON keys (strings followed by colon)
      .replace(/"([^"\\]|\\.)*"(\s*:)/g, '<span class="json-key">$&</span>')
      // Highlight JSON strings (not keys)
      .replace(/"([^"\\]|\\.)*"(?!\s*:)/g, '<span class="json-string">$&</span>')
      // Highlight numbers
      .replace(/\b-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, '<span class="json-number">$&</span>')
      // Highlight booleans
      .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
      // Highlight null
      .replace(/\bnull\b/g, '<span class="json-null">null</span>');
    
    return highlighted;
  }
}

function applyJsonSyntaxToHTML(htmlText) {
  // Handle search markers and HTML tags separately
  let result = htmlText;
  
  // First, protect search markers from processing
  const markers = [];
  result = result.replace(/(SEARCH_HIGHLIGHT_START_\d+_\d+_MARKER|SEARCH_HIGHLIGHT_END_\d+_\d+_MARKER)/g, (match, marker) => {
    const index = markers.length;
    markers.push(marker);
    return `PROTECTED_MARKER_${index}`;
  });
  
  // Split into HTML tags and text content, but only split on actual HTML tags
  const parts = result.split(/(<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>|<\/\w+>)/i);
  
  const processedParts = parts.map(part => {
    // If this part is a real HTML tag, return as-is
    if (part.match(/^<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>$|^<\/\w+>$/i)) {
      return part;
    }
    
    // Otherwise, it's text content - escape and apply JSON syntax highlighting
    let highlighted = part.replace(/&/g, '&amp;')
                         .replace(/</g, '&lt;')
                         .replace(/>/g, '&gt;');
    
    // Apply JSON syntax highlighting patterns
    highlighted = highlighted
      // Highlight JSON keys (strings followed by colon)
      .replace(/"([^"\\]|\\.)*"(\s*:)/g, '<span class="json-key">$&</span>')
      // Highlight JSON strings (not keys)
      .replace(/"([^"\\]|\\.)*"(?!\s*:)/g, '<span class="json-string">$&</span>')
      // Highlight numbers
      .replace(/\b-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, '<span class="json-number">$&</span>')
      // Highlight booleans
      .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
      // Highlight null
      .replace(/\bnull\b/g, '<span class="json-null">null</span>');
    
    return highlighted;
  });
  
  // Restore protected markers
  let finalResult = processedParts.join('');
  markers.forEach((marker, index) => {
    finalResult = finalResult.replace(`PROTECTED_MARKER_${index}`, marker);
  });
  
  return finalResult;
}