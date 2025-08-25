// Raw Response View and Search Functionality
// This file handles raw response display, view toggling, and search functionality

// View state management
let isRawView = false;
let searchMatches = [];
let currentMatchIndex = -1;
let searchTerm = '';

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
  const { debugContent, toggleViewBtn, copyRawBtn, rawSearchContainer } = elements;
  
  // Update button state and text
  toggleViewBtn.textContent = 'Show Debug Messages';
  toggleViewBtn.classList.remove('primary');
  toggleViewBtn.classList.add('secondary');
  toggleViewBtn.title = 'Switch back to debug messages view';
  
  // Show copy button and search container
  copyRawBtn?.classList.remove('hidden');
  rawSearchContainer?.classList.remove('hidden');
  
  // Display raw response with syntax highlighting
  displayRawResponse();
  
  // Set up search event listeners
  setupSearchListeners();
}

function showDebugMessages() {
  const { debugContent, toggleViewBtn, copyRawBtn, rawSearchContainer } = elements;
  
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
  
  // Re-display debug messages (trigger original parsing)
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
  if (query !== searchTerm) {
    searchTerm = query;
    performSearch(query);
  }
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
    
    // Find all occurrences of the exact search term
    let startIndex = 0;
    let foundIndex = textToSearch.indexOf(searchTerm, startIndex);
    
    while (foundIndex !== -1) {
      matches.push({
        index: foundIndex,
        length: query.length,
        text: originalText.substring(foundIndex, foundIndex + query.length)
      });
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
    } else {
      // No matches found, re-display without highlights
      displayRawResponseWithoutSearch(rawContainer, originalText);
    }
    
    updateSearchInfo(matches.length, matches.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('Search error:', error);
    updateSearchInfo(0, 0);
  }
}

function applyCleanSearchHighlighting(container, originalText, matches) {
  // Simple approach: Build text with search highlights first, then apply syntax highlighting
  let textWithHighlights = originalText;
  
  // Sort matches by index in reverse order to avoid index shifting during replacement
  const sortedMatches = [...matches].sort((a, b) => b.index - a.index);
  
  // Insert search highlight markers (we'll use placeholder tokens that won't interfere with syntax highlighting)
  sortedMatches.forEach((match, reverseIndex) => {
    const matchIndex = matches.length - 1 - reverseIndex;
    const beforeText = textWithHighlights.substring(0, match.index);
    const matchText = textWithHighlights.substring(match.index, match.index + match.length);
    const afterText = textWithHighlights.substring(match.index + match.length);
    
    // Use unique markers that won't conflict with any possible debug content
    const startMarker = `SEARCH_HIGHLIGHT_START_${matchIndex}_${Date.now()}_MARKER`;
    const endMarker = `SEARCH_HIGHLIGHT_END_${matchIndex}_${Date.now()}_MARKER`;
    
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
  
  // Replace markers with actual search highlight spans
  let finalContent = syntaxHighlightedContent;
  
  // Replace markers dynamically by extracting timestamp from each marker
  for (let i = 0; i < matches.length; i++) {
    // Find the actual markers in the content (they may have different timestamps)
    const startMarkerRegex = new RegExp(`SEARCH_HIGHLIGHT_START_${i}_(\\d+)_MARKER`);
    const endMarkerRegex = new RegExp(`SEARCH_HIGHLIGHT_END_${i}_(\\d+)_MARKER`);
    
    const startMatch = finalContent.match(startMarkerRegex);
    const endMatch = finalContent.match(endMarkerRegex);
    
    if (startMatch && endMatch) {
      const startMarker = startMatch[0];
      const endMarker = endMatch[0];
      const startSpan = `<span class="search-highlight" data-match-index="${i}">`;
      const endSpan = `</span>`;
      
      finalContent = finalContent.replace(startMarker, startSpan).replace(endMarker, endSpan);
    }
  }
  
  // Fallback: Clean up any remaining search markers that weren't replaced
  finalContent = finalContent.replace(/SEARCH_HIGHLIGHT_START_\d+_\d+_MARKER/g, '');
  finalContent = finalContent.replace(/SEARCH_HIGHLIGHT_END_\d+_\d+_MARKER/g, '');
  
  // Update the container
  container.innerHTML = finalContent;
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

function updateSearchInfo(totalMatches, currentMatch) {
  const { searchResultsInfo, searchPrevBtn, searchNextBtn } = elements;
  
  if (searchResultsInfo) {
    if (totalMatches === 0) {
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