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
const RAW_RENDER_CHUNK_SIZE = 200 * 1024; // Characters rendered per step; bigger logs are rendered in steps
const RAW_PLAIN_SEARCH_THRESHOLD = 100000; // 100KB: above this, search results are shown without syntax colors
let rawRender = null; // The raw view render in progress (only the latest one continues)

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

      currentLogTruncated = parsedContent.truncated;
      const formattedErrors = formatErrorsForDisplay(parsedContent.errors, currentErrorFilters);
      errorContent.innerHTML = (currentLogTruncated ? truncatedLogBannerHtml() : '') + formattedErrors;

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

function displayRawResponse() {
  const { debugContent } = elements;
  if (!debugContent || !currentRawResponse) return;

  // Create raw response container (search and copy use currentRawResponse, not the page text)
  const rawContainer = document.createElement('div');
  rawContainer.className = 'raw-response-container';

  // Replace debug content
  debugContent.innerHTML = isTruncatedLog(currentRawResponse) ? truncatedLogBannerHtml() : '';
  debugContent.appendChild(rawContainer);

  try {
    // Detect content type and apply appropriate highlighting
    renderRawContent(rawContainer, currentRawResponse);
  } catch (error) {
    // Fallback to plain text if highlighting fails
    rawContainer.textContent = currentRawResponse;
  }
}

// Renders text into the raw view container. The first slice is rendered now and the rest in later tasks,
// so a 20 MB log does not freeze the page. Matches ({index, length}, sorted, not overlapping) become
// search highlight spans. The text is always HTML-escaped; only the highlight spans are markup.
function renderRawContent(container, text, matches = []) {
  if (rawRender) {
    clearTimeout(rawRender.timer);
  }

  // Large logs are shown without syntax colors while searching (faster)
  let highlight = escapeHtml;
  if (matches.length === 0 || text.length <= RAW_PLAIN_SEARCH_THRESHOLD) {
    const contentType = detectContentType(text);
    if (contentType === 'json') {
      highlight = applyJsonSyntaxHighlighting;
    } else if (contentType === 'debug_log') {
      highlight = applyDebugLogHighlighting;
    }
  }

  container.innerHTML = '';
  rawRender = { container, text, matches, highlight, offset: 0, nextMatch: 0, rendered: 0, timer: null };
  renderNextRawChunk(rawRender);
}

function renderNextRawChunk(state) {
  if (state !== rawRender || state.container.isConnected === false) return;

  const { text, matches } = state;
  let end = Math.min(state.offset + RAW_RENDER_CHUNK_SIZE, text.length);
  if (end < text.length) {
    // End the slice after a line break: highlighting works per line, and a match never spans lines
    const lineEnd = text.indexOf('\n', end);
    end = lineEnd === -1 ? text.length : lineEnd + 1;
  }

  // Wrap this slice's matches in search marks (marks that are already in the log become U+FFFD)
  const clean = (part) => part.replace(/[]/g, '�');
  let marked = '';
  let position = state.offset;
  while (state.nextMatch < matches.length && matches[state.nextMatch].index < end) {
    const match = matches[state.nextMatch++];
    marked += clean(text.slice(position, match.index)) + SEARCH_MARK_START +
      clean(text.slice(match.index, match.index + match.length)) + SEARCH_MARK_END;
    position = match.index + match.length;
  }
  marked += clean(text.slice(position, end));

  const html = state.highlight(marked)
    .replace(//g, () => `<span class="search-highlight" data-match-index="${state.rendered++}">`)
    .replace(//g, '</span>');
  state.container.insertAdjacentHTML('beforeend', html);
  state.offset = end;

  if (end < text.length) {
    state.timer = setTimeout(() => renderNextRawChunk(state), 0);
  }
}

// Renders the remaining slices right away until match `index` is on the page
function ensureRawMatchRendered(index) {
  const state = rawRender;
  while (state === rawRender && state && state.rendered <= index && state.offset < state.text.length &&
    state.container.isConnected !== false) {
    clearTimeout(state.timer);
    renderNextRawChunk(state);
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
  const originalText = currentRawResponse;

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

      // Continue after this match so matches never overlap
      startIndex = foundIndex + searchTerm.length;
      foundIndex = textToSearch.indexOf(searchTerm, startIndex);
    }

    if (matches.length > 0) {
      // Apply search highlighting
      renderRawContent(rawContainer, originalText, matches);
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

function displayRawResponseWithoutSearch(container, originalText) {
  // Display content without search highlights - just syntax highlighting
  renderRawContent(container, originalText);
}

function highlightCurrentMatch() {
  // The match may be in a part of a big log that is not rendered yet
  ensureRawMatchRendered(currentMatchIndex);
  const container = elements.debugContent?.querySelector('.raw-response-container');
  if (!container) return;
  container.querySelector('.search-highlight.current')?.classList.remove('current');
  container.querySelector(`.search-highlight[data-match-index="${currentMatchIndex}"]`)?.classList.add('current');
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

// Copy raw response function
async function copyRawResponse() {
  if (!currentRawResponse) return;

  try {
    await navigator.clipboard.writeText(currentRawResponse);

    const { copyRawBtn } = elements;
    const originalText = copyRawBtn.innerHTML;
    copyRawBtn.innerHTML = Icons.svg('check');
    copyRawBtn.disabled = true;

    setTimeout(() => {
      copyRawBtn.innerHTML = originalText;
      copyRawBtn.disabled = false;
    }, 2000);

  } catch (error) {
    // Fallback: show toast
    showToast('Failed to copy raw response. Content is available in the view panel.', 5000);
  }
}