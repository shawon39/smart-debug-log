// Raw Response View and Search Functionality
// This file handles raw response display, view toggling, and search functionality

// View state management
let isRawView = false;
let searchMatches = [];
let currentMatchIndex = -1;
let searchTerm = '';
let searchDebounceTimer = null;
const SEARCH_DEBOUNCE_DELAY = 300; // milliseconds
const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_MATCHES = 500; // Maximum number of matches to prevent performance issues

// Initialize view preference from storage
async function initializeViewPreference() {
  try {
    const savedViewPreference = await getViewPreferenceFromStorage();
    isRawView = savedViewPreference === VIEW_RAW_RESPONSE;
    
    // Update button appearance based on saved preference
    const { toggleViewBtn } = elements;
    if (toggleViewBtn) {
      if (isRawView) {
        toggleViewBtn.textContent = 'Show Debug Messages';
        toggleViewBtn.classList.remove('primary');
        toggleViewBtn.classList.add('secondary');
        toggleViewBtn.title = 'Switch back to debug messages view';
      } else {
        toggleViewBtn.textContent = 'Show Raw Response';
        toggleViewBtn.classList.remove('secondary');
        toggleViewBtn.classList.add('primary');
        toggleViewBtn.title = 'Switch to raw response view';
      }
    }
  } catch (error) {
    console.warn('Failed to initialize view preference:', error);
    isRawView = false;
  }
}

function detectContentType(content) {
  if (!content || typeof content !== 'string') {
    return 'plain';
  }
  
  // Check for Salesforce debug log patterns
  const debugLogPatterns = [
    /^\d+\.\d+\s+APEX_CODE,/,  // Version line like "64.0 APEX_CODE,FINEST;..."
    /\|\d+\|\w+\|/,             // Timestamp entries like "|323161|USER_INFO|"
    /EXECUTION_STARTED/,         // Common debug log entries
    /CODE_UNIT_STARTED/,
    /USER_DEBUG/,
    /HEAP_ALLOCATE/,
    /SOQL_EXECUTE/
  ];
  
  // If it matches debug log patterns, it's a debug log
  if (debugLogPatterns.some(pattern => pattern.test(content))) {
    return 'debug_log';
  }
  
  // Check if it's JSON (starts with { or [ and basic JSON structure)
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch (e) {
      // Not valid JSON, might be debug log with JSON content
    }
  }
  
  return 'plain';
}

async function toggleDebugView() {
  if (!currentRawResponse) return;
  
  isRawView = !isRawView;
  
  // Save user preference to storage
  const viewPreference = isRawView ? VIEW_RAW_RESPONSE : VIEW_DEBUG_MESSAGES;
  await saveViewPreferenceToStorage(viewPreference);
  
  if (isRawView) {
    showRawResponse();
  } else {
    showDebugMessages();
  }
}

function showRawResponse() {
  const { debugContent, toggleViewBtn, copyRawBtn, rawSearchContainer, errorContent, limitsContent } = elements;
  
  // Update button state and text
  toggleViewBtn.textContent = 'Show Debug Messages';
  toggleViewBtn.classList.remove('primary');
  toggleViewBtn.classList.add('secondary');
  toggleViewBtn.title = 'Switch back to debug messages view';
  
  // Show copy button and search container
  copyRawBtn?.classList.remove('hidden');
  rawSearchContainer?.classList.remove('hidden');
  
  // Parse and display Error Analysis & Governor Limits even in raw view
  if (currentRawResponse && (errorContent || limitsContent)) {
    const parsedContent = parseDebugLogContent(currentRawResponse);
    
    // Display error analysis
    if (errorContent && parsedContent.errors) {
      // Store error data for re-rendering when filter changes
      currentErrorData = parsedContent.errors;
      
      // Smart filter initialization: adjust filters based on what exists
      if (!parsedContent.errors.hasFatalErrors && parsedContent.errors.hasExceptions) {
        // Only exceptions exist, show them
        currentErrorFilters = { showFatal: false, showException: true };
      } else if (parsedContent.errors.hasFatalErrors && !parsedContent.errors.hasExceptions) {
        // Only fatal errors exist, show them
        currentErrorFilters = { showFatal: true, showException: false };
      }
      // If both exist, currentErrorFilters stays as is
      
      const formattedErrors = formatErrorsForDisplay(parsedContent.errors, currentErrorFilters);
      errorContent.innerHTML = formattedErrors;
      
      // Wire up filter checkbox event listeners
      wireUpErrorFilterListeners();
    }
    
    // Display limits
    if (limitsContent) {
      if (parsedContent.limits) {
        const formattedLimits = formatGovernorLimits(parsedContent.limits);
        limitsContent.innerHTML = formattedLimits;
      } else {
        limitsContent.innerHTML = '<div class="info-message">No CUMULATIVE_LIMIT_USAGE information found in this log.</div>';
      }
    }
  }
  
  // Display raw response with syntax highlighting
  displayRawResponse();
  
  // Set up search event listeners
  setupSearchListeners();
}

function showDebugMessages() {
  const { debugContent, toggleViewBtn, copyRawBtn, rawSearchContainer, errorContent, limitsContent } = elements;
  
  // Update button state and text
  toggleViewBtn.textContent = 'Show Raw Response';
  toggleViewBtn.classList.remove('secondary');
  toggleViewBtn.classList.add('primary');
  toggleViewBtn.title = 'Switch to raw response view';
  
  // Hide copy button and search container
  copyRawBtn?.classList.add('hidden');
  rawSearchContainer?.classList.add('hidden');
  
  // Clear search state
  clearSearch();
  
  // Reset error filters to default (Fatal only)
  currentErrorFilters = { showFatal: true, showException: false };
  
  // Re-display debug messages and error analysis/limits (trigger original parsing)
  if (currentRawResponse) {
    const parsedContent = parseDebugLogContent(currentRawResponse);
    displayDebugContent(parsedContent);
  }
}

function resetToDebugView() {
  isRawView = false;
  clearSearch();
  showDebugMessages();
}


function displayRawResponse() {
  const { debugContent } = elements;
  if (!debugContent || !currentRawResponse) return;
  
  try {
    // Detect content type and apply appropriate highlighting
    const contentType = detectContentType(currentRawResponse);
    let highlightedContent;
    
    if (contentType === 'json') {
      highlightedContent = applyJsonSyntaxHighlighting(currentRawResponse);
    } else if (contentType === 'debug_log') {
      highlightedContent = applyDebugLogHighlighting(currentRawResponse);
    } else {
      // Plain text - just escape HTML
      highlightedContent = escapeHtml(currentRawResponse);
    }
    
    // Create raw response container
    const rawContainer = document.createElement('div');
    rawContainer.className = 'raw-response-container';
    rawContainer.innerHTML = highlightedContent;
    
    // Store the original text for searching
    rawContainer.dataset.originalText = currentRawResponse;
    
    // Replace debug content
    debugContent.innerHTML = '';
    debugContent.appendChild(rawContainer);
    
  } catch (error) {
    // Fallback to plain text if highlighting fails
    const rawContainer = document.createElement('div');
    rawContainer.className = 'raw-response-container';
    rawContainer.textContent = currentRawResponse;
    rawContainer.dataset.originalText = currentRawResponse;
    debugContent.innerHTML = '';
    debugContent.appendChild(rawContainer);
  }
}

// Search Functions

function setupSearchListeners() {
  const { rawSearchInput, searchPrevBtn, searchNextBtn, clearSearchBtn } = elements;
  
  // Remove existing listeners to prevent duplicates
  rawSearchInput?.removeEventListener('input', handleSearchInput);
  rawSearchInput?.removeEventListener('keydown', handleSearchKeydown);
  searchPrevBtn?.removeEventListener('click', searchPrevious);
  searchNextBtn?.removeEventListener('click', searchNext);
  clearSearchBtn?.removeEventListener('click', clearSearch);
  
  // Add new listeners
  rawSearchInput?.addEventListener('input', handleSearchInput);
  rawSearchInput?.addEventListener('keydown', handleSearchKeydown);
  searchPrevBtn?.addEventListener('click', searchPrevious);
  searchNextBtn?.addEventListener('click', searchNext);
  clearSearchBtn?.addEventListener('click', clearSearch);
}

function handleSearchInput(event) {
  const query = event.target.value.trim();
  
  // Clear any existing debounce timer
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  
  // Check minimum character requirement
  if (query.length > 0 && query.length < SEARCH_MIN_CHARS) {
    // Show hint that minimum characters are required
    updateSearchInfo(0, 0, `Type at least ${SEARCH_MIN_CHARS} characters to search`);
    
    // Clear any existing search highlights
    if (searchTerm !== '') {
      searchTerm = '';
      searchMatches = [];
      currentMatchIndex = -1;
      const rawContainer = elements.debugContent?.querySelector('.raw-response-container');
      if (rawContainer && isRawView && currentRawResponse) {
        displayRawResponseWithoutSearch(rawContainer, currentRawResponse);
      }
    }
    return;
  }
  
  // Debounce the search to avoid performance issues with large logs
  searchDebounceTimer = setTimeout(() => {
    if (query !== searchTerm) {
      searchTerm = query;
      performSearch(query);
    }
  }, SEARCH_DEBOUNCE_DELAY);
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      searchPrevious();
    } else {
      searchNext();
    }
  } else if (event.key === 'Escape') {
    clearSearch();
  }
}

function performSearch(query) {
  const { debugContent, searchResultsInfo } = elements;
  
  if (!query || !debugContent) {
    // Clear search state and remove highlights when query is empty
    searchTerm = '';
    searchMatches = [];
    currentMatchIndex = -1;
    updateSearchInfo(0, 0);
    
    // Remove visual highlights from DOM
    const rawContainer = debugContent.querySelector('.raw-response-container');
    if (rawContainer && isRawView && currentRawResponse) {
      displayRawResponseWithoutSearch(rawContainer, currentRawResponse);
    }
    return;
  }
  
  const rawContainer = debugContent.querySelector('.raw-response-container');
  if (!rawContainer) return;
  
  // Get the original text content
  const originalText = rawContainer.dataset.originalText || currentRawResponse;
  
  try {
    // Clear any previous search highlights
    searchMatches = [];
    currentMatchIndex = -1;
    
    // Create case-insensitive search for exact sequence
    const searchTerm = query.toLowerCase();
    const textToSearch = originalText.toLowerCase();
    const matches = [];
    let totalMatchCount = 0;
    let limitReached = false;
    
    // Find occurrences up to the maximum limit for performance
    let startIndex = 0;
    let foundIndex = textToSearch.indexOf(searchTerm, startIndex);
    
    while (foundIndex !== -1) {
      totalMatchCount++;
      
      // Only store matches up to the limit to prevent performance issues
      if (matches.length < SEARCH_MAX_MATCHES) {
        matches.push({
          index: foundIndex,
          length: query.length,
          text: originalText.substring(foundIndex, foundIndex + query.length)
        });
      } else if (!limitReached) {
        limitReached = true;
        // Stop searching after we've hit the limit to save time
        break;
      }
      
      startIndex = foundIndex + 1;
      foundIndex = textToSearch.indexOf(searchTerm, startIndex);
    }
    
    if (matches.length > 0) {
      // Apply search highlighting with clean approach
      applyCleanSearchHighlighting(rawContainer, originalText, matches);
      searchMatches = matches;
      currentMatchIndex = 0;
      highlightCurrentMatch();
      scrollToCurrentMatch();
      
      // Show info with limit warning if applicable
      if (limitReached) {
        updateSearchInfo(matches.length, 1, `1/${matches.length} (limited to first ${SEARCH_MAX_MATCHES} for performance)`);
      } else {
        updateSearchInfo(matches.length, 1);
      }
    } else {
      // No matches found, re-display without highlights
      displayRawResponseWithoutSearch(rawContainer, originalText);
      updateSearchInfo(0, 0);
    }
    
  } catch (error) {
    console.error('Search error:', error);
    updateSearchInfo(0, 0);
  }
}

function applyCleanSearchHighlighting(container, originalText, matches) {
  // For very large texts, use a more efficient approach
  const isLargeText = originalText.length > 100000; // 100KB threshold
  
  if (isLargeText) {
    // For large texts, skip syntax highlighting and just add search highlights
    applyFastSearchHighlighting(container, originalText, matches);
    return;
  }
  
  // For smaller texts, use the full highlighting approach
  let textWithHighlights = originalText;
  
  // Sort matches by index in reverse order to avoid index shifting during replacement
  const sortedMatches = [...matches].sort((a, b) => b.index - a.index);
  
  // Insert search highlight markers using simpler, consistent markers
  sortedMatches.forEach((match, reverseIndex) => {
    const matchIndex = matches.length - 1 - reverseIndex;
    const beforeText = textWithHighlights.substring(0, match.index);
    const matchText = textWithHighlights.substring(match.index, match.index + match.length);
    const afterText = textWithHighlights.substring(match.index + match.length);
    
    // Use simpler markers without timestamp for better performance
    const startMarker = `§§SEARCH_START_${matchIndex}§§`;
    const endMarker = `§§SEARCH_END_${matchIndex}§§`;
    
    textWithHighlights = beforeText + startMarker + matchText + endMarker + afterText;
  });
  
  // Apply syntax highlighting to the text with markers
  const contentType = detectContentType(originalText);
  let syntaxHighlightedContent;
  
  if (contentType === 'json') {
    syntaxHighlightedContent = applyJsonSyntaxHighlighting(textWithHighlights);
  } else if (contentType === 'debug_log') {
    syntaxHighlightedContent = applyDebugLogHighlighting(textWithHighlights);
  } else {
    syntaxHighlightedContent = escapeHtml(textWithHighlights);
  }
  
  // Replace markers with actual search highlight spans - use faster replaceAll
  let finalContent = syntaxHighlightedContent;
  
  for (let i = 0; i < matches.length; i++) {
    const startMarker = `§§SEARCH_START_${i}§§`;
    const endMarker = `§§SEARCH_END_${i}§§`;
    const startSpan = `<span class="search-highlight" data-match-index="${i}">`;
    const endSpan = `</span>`;
    
    finalContent = finalContent.replace(startMarker, startSpan).replace(endMarker, endSpan);
  }
  
  // Fallback: Clean up any remaining markers
  finalContent = finalContent.replace(/§§SEARCH_(START|END)_\d+§§/g, '');
  
  // Update the container
  container.innerHTML = finalContent;
}

// Fast search highlighting for large texts (skips syntax highlighting)
function applyFastSearchHighlighting(container, originalText, matches) {
  // Escape HTML first
  let escapedText = escapeHtml(originalText);
  
  // Build an array of text segments with highlights
  const segments = [];
  let lastIndex = 0;
  
  // Sort matches by index
  const sortedMatches = [...matches].sort((a, b) => a.index - b.index);
  
  for (let i = 0; i < sortedMatches.length; i++) {
    const match = sortedMatches[i];
    
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push(originalText.substring(lastIndex, match.index));
    }
    
    // Add the highlighted match
    const matchText = originalText.substring(match.index, match.index + match.length);
    segments.push(`<span class="search-highlight" data-match-index="${i}">${escapeHtml(matchText)}</span>`);
    
    lastIndex = match.index + match.length;
  }
  
  // Add remaining text after last match
  if (lastIndex < originalText.length) {
    segments.push(originalText.substring(lastIndex));
  }
  
  // Join segments and update container
  container.innerHTML = segments.join('');
}

function displayRawResponseWithoutSearch(container, originalText) {
  // Display content without search highlights - just syntax highlighting
  const contentType = detectContentType(originalText);
  let highlightedContent;
  
  if (contentType === 'json') {
    highlightedContent = applyJsonSyntaxHighlighting(originalText);
  } else if (contentType === 'debug_log') {
    highlightedContent = applyDebugLogHighlighting(originalText);
  } else {
    highlightedContent = escapeHtml(originalText);
  }
  
  container.innerHTML = highlightedContent;
}

function highlightCurrentMatch() {
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach((highlight, index) => {
    highlight.classList.toggle('current', index === currentMatchIndex);
  });
}

function scrollToCurrentMatch() {
  const currentHighlight = document.querySelector('.search-highlight.current');
  if (currentHighlight) {
    currentHighlight.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}

function searchNext() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  highlightCurrentMatch();
  scrollToCurrentMatch();
  updateSearchInfo(searchMatches.length, currentMatchIndex + 1);
}

function searchPrevious() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
  highlightCurrentMatch();
  scrollToCurrentMatch();
  updateSearchInfo(searchMatches.length, currentMatchIndex + 1);
}

function clearSearch() {
  const { rawSearchInput, debugContent } = elements;
  if (rawSearchInput) {
    rawSearchInput.value = '';
  }
  
  searchTerm = '';
  searchMatches = [];
  currentMatchIndex = -1;
  
  updateSearchInfo(0, 0);
  
  // Re-display raw response without search highlights
  if (isRawView && currentRawResponse) {
    const rawContainer = debugContent?.querySelector('.raw-response-container');
    if (rawContainer) {
      displayRawResponseWithoutSearch(rawContainer, currentRawResponse);
    }
  }
}

function updateSearchInfo(totalMatches, currentMatch, customMessage = null) {
  const { searchResultsInfo, searchPrevBtn, searchNextBtn } = elements;
  
  if (searchResultsInfo) {
    if (customMessage) {
      searchResultsInfo.textContent = customMessage;
    } else if (totalMatches === 0) {
      searchResultsInfo.textContent = searchTerm ? 'No matches' : '0 matches';
    } else {
      searchResultsInfo.textContent = `${currentMatch}/${totalMatches}`;
    }
  }
  
  // Update button states
  const hasMatches = totalMatches > 0;
  if (searchPrevBtn) {
    searchPrevBtn.disabled = !hasMatches;
  }
  if (searchNextBtn) {
    searchNextBtn.disabled = !hasMatches;
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Copy raw response function
async function copyRawResponse() {
  if (!currentRawResponse) return;
  
  try {
    await navigator.clipboard.writeText(currentRawResponse);
    
    const { copyRawBtn } = elements;
    const originalText = copyRawBtn.innerHTML;
    copyRawBtn.innerHTML = '✓';
    copyRawBtn.disabled = true;
    
    setTimeout(() => {
      copyRawBtn.innerHTML = originalText;
      copyRawBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    // Fallback: show alert with the content
    alert('Raw Response:\n\n' + currentRawResponse);
  }
}