# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension (Manifest V3) called "Salesforce Debug Log Beautifier" that enhances Salesforce debug logs with syntax highlighting, JSON formatting, and error analysis. The project uses vanilla JavaScript without build tools.

## Development Commands

This project does not use npm/yarn or build tools. For development:

- **Load extension**: Use Chrome Developer Mode → "Load unpacked" and select the project directory
- **Testing**: Manual testing requires active Salesforce org sessions
- **Debugging**: Use Chrome extension developer tools and browser console
- **Reload**: Use Chrome extension reload button or Ctrl+R on extension management page

## Architecture Overview

### Core Components

**Background Layer (`background/`)**:
- `service-worker.js`: Main message router, coordinates all extension functionality
- `session-manager.js`: Handles Salesforce authentication, session management, and domain mapping
- `debug-log-manager.js`: Manages log downloading, Tooling API queries, and log caching

**Content Layer (`content/`)**:
- `api-handler.js`: Core message handler, injected into Salesforce pages
- `api-operations.js`: Extends handler with Tooling API operations (query, create, log retrieval)
- `session-extraction.js`: Extracts session info from Salesforce pages

**UI Layer**:
- `dashboard.html` + Dashboard modules: Main dashboard for log viewing and management controls
  - `js/dashboard-init.js`: Initialization and event setup
  - `js/dashboard-actions.js`: Session actions and deploy functionality
  - `js/dashboard-connection.js`: Salesforce connection management
  - `js/dashboard-monitoring.js`: Preference management and UI controls
- `popup/popup.html` + `popup/popup.js`: Extension popup interface

### Log Processing Pipeline (`js/`):
- `log-loader.js`: LogLoader class for fetching and caching debug logs
- `log-renderer.js`: LogRenderer class for displaying logs in UI
- `log-display.js`: Coordinates log display modules
- `log-cache.js`: LogCache class for caching debug/error status
- `log-parsing.js`: Parses debug log content and extracts limits
- `basic-parsing.js`: Parses Salesforce object notation and simple structures
- `complex-parsing.js`: Handles nested collections and complex object parsing
- `error-extraction.js`: Extracts and categorizes error messages from debug logs
- `formatting-utilities.js`: Utilities for display formatting
- `syntax-highlighting.js`: Debug log and JSON syntax highlighting
- `raw-view.js`: Raw response view and search functionality

### Apex Execution (`js/`):
- `apex-code-manager.js`: Manages saved Apex code snippets
- `apex-storage-service.js`: Chrome storage operations for Apex code
- `apex-executor.js`: Handles Apex code execution and results

## Key Architecture Patterns

### Message Passing
The extension uses Chrome's message passing API extensively. All communication flows through the service worker:

```javascript
// Background service worker handles these message types:
- GET_SALESFORCE_HOST: Detect Salesforce org from URL
- GET_SESSION: Retrieve session info for org
- GET_LOG_CONTENT: Fetch specific log content
- EXECUTE_TOOLING_QUERY: Run Salesforce Tooling API queries
- TOOLING_CREATE: Create records via Tooling API
- SAVE_APEX_CODE / UPDATE_APEX_CODE / DELETE_APEX_CODE: Apex code storage
- EXECUTE_ANONYMOUS: Execute anonymous Apex
```

### Session Management
Salesforce sessions are managed per org and tab. The session manager handles domain mapping between different Salesforce URL patterns (lightning.force.com → my.salesforce.com for API access).

## Salesforce Integration

The extension works with multiple Salesforce URL patterns:
- `*.salesforce.com`, `*.force.com`, `*.lightning.force.com`
- `*.my.salesforce.com` (for API access)
- Sandbox and development instances
- International domains (.mil, .cn)

API interactions use the Salesforce Tooling API v62.0 for:
- Querying ApexLog objects
- Creating TraceFlag records for monitoring
- Retrieving log body content

## File Organization

```
background/          # Service worker and background logic
  service-worker.js  # Main message router
  session-manager.js # Session and domain management
  debug-log-manager.js # Log management and API operations
content/             # Content scripts for Salesforce pages
  api-handler.js     # Core message handler
  api-operations.js  # API operations (query, create, etc.)
  session-extraction.js # Session extraction methods
js/                  # Core functionality modules
  dashboard-*.js     # Dashboard initialization and controls
  log-*.js           # Log loading, rendering, caching
  apex-*.js          # Apex code management and execution
  *-parsing.js       # Salesforce object parsing
  *-utilities.js     # Utility functions
css/                 # Styling
  theme-variables.css # CSS variables for theming
  dashboard-*.css    # Dashboard styles
  popup-*.css        # Popup styles
popup/               # Extension popup UI
icons/               # Extension icons (16, 32, 48, 128px)
manifest.json        # Extension configuration
dashboard.html       # Main dashboard page
```

## Development Notes

- All JavaScript modules use ES6 classes and async/await patterns
- No external dependencies - pure vanilla JavaScript
- Extension uses Chrome's declarative permissions model
- Storage uses Chrome's storage API for persistence
- Dark mode support is implemented throughout the UI


## Follow this always:
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Finally, add a review section to the todo.md file with a summary of the changes you made and any other relevant information.
8. DO NOT BE LAZY. NEVER BE LAZY. IF THERE IS A BUG FIND THE ROOT CAUSE AND FIX IT. NO TEMPORARY FIXES. YOU ARE A SENIOR DEVELOPER. NEVER BE LAZY
9. MAKE ALL FIXES AND CODE CHANGES AS SIMPLE AS HUMANLY POSSIBLE. THEY SHOULD ONLY IMPACT NECESSARY CODE RELEVANT TO THE TASK AND NOTHING ELSE. IT SHOULD IMPACT AS LITTLE CODE AS POSSIBLE. YOUR GOAL IS TO NOT INTRODUCE ANY BUGS. IT'S ALL ABOUT SIMPLICITY
10. Do not exceed 500 lines in any file. If you find one, break it down into smaller files.