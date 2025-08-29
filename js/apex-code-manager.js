// Apex Code Manager
// Handles storage and management of saved Apex code snippets

class ApexCodeManager {
  constructor() {
    this.apexCodes = [];
    this.currentOrgId = null;
    this.isInitialized = false;
    this.hasUnsavedChanges = false;
    this.isReadOnly = false;
    this.searchTerm = '';
    this.filteredCodes = [];
  }

  async initialize(orgId) {
    this.currentOrgId = orgId;
    await this.loadApexCodes();
  }




  async loadApexCodes() {
    if (!this.currentOrgId) return;
    
    const response = await ApexStorageService.loadApexCodes(this.currentOrgId);
    if (response.success) {
      this.apexCodes = response.data;
      this.filterApexCodes();
    } else {
      console.error('Failed to load Apex codes:', response.error);
    }
  }

  filterApexCodes() {
    if (!this.searchTerm || !this.searchTerm.trim()) {
      // No search term, show all codes
      this.filteredCodes = [...this.apexCodes];
    } else {
      // Filter codes by search term (case-insensitive search in both name and code)
      const searchLower = this.searchTerm.toLowerCase();
      this.filteredCodes = this.apexCodes.filter(apexCode => {
        const nameMatch = apexCode.name.toLowerCase().includes(searchLower);
        const codeMatch = apexCode.code.toLowerCase().includes(searchLower);
        return nameMatch || codeMatch;
      });
    }
    this.renderApexCodeList();
  }

  handleSearch(searchTerm) {
    this.searchTerm = searchTerm;
    this.filterApexCodes();
  }

  setupSearchEventListeners() {
    const searchInput = document.getElementById('apexSearchInput');
    if (!searchInput) return;

    // Debounce search for better performance
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.handleSearch(e.target.value);
      }, 300);
    });

    // Clear search on Escape key
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        this.handleSearch('');
      }
    });
  }

  async saveApexCode(name, code) {
    if (!code || !this.currentOrgId) return false;
    
    // Require a name to be provided
    if (!name || !name.trim()) {
      return false;
    }
    
    const response = await ApexStorageService.saveApexCode(name.trim(), code.trim(), this.currentOrgId);
    if (response.success) {
      await this.loadApexCodes();
      return true;
    } else {
      console.error('Failed to save Apex code:', response.error);
      return false;
    }
  }

  async updateApexCode(id, name, code) {
    if (!id || !code || !this.currentOrgId) return false;
    
    // Require a name to be provided
    if (!name || !name.trim()) {
      return false;
    }
    
    const response = await ApexStorageService.updateApexCode(id, name.trim(), code.trim(), this.currentOrgId);
    if (response.success) {
      await this.loadApexCodes();
      return true;
    } else {
      console.error('Failed to update Apex code:', response.error);
      return false;
    }
  }

  async saveOrUpdateCurrentCode() {
    const code = this.getCurrentCode();
    if (!code || !code.trim()) {
      return false;
    }

    let success = false;
    // Check if we're editing an existing code
    if (this.currentSelectedCode && this.currentSelectedCode.id) {
      // Update existing code
      success = await this.updateApexCode(
        this.currentSelectedCode.id,
        this.currentSelectedCode.name, // Keep existing name
        code.trim()
      );
      if (success) {
        // Update the current selected code with new content
        this.currentSelectedCode.code = code.trim();
      }
    } else {
      // Create new code - use custom title if set
      const titleToUse = this.isNewCodeBlock && this.newCodeBlockTitle ? this.newCodeBlockTitle : null;
      success = await this.saveApexCode(titleToUse, code.trim());
      
      if (success) {
        // Reset new code block flags
        this.isNewCodeBlock = false;
        this.newCodeBlockTitle = null;
        
        // Update title display
        const codeTitle = document.getElementById('apexCodeTitle');
      if (codeTitle && titleToUse) {
        // Avoid unsafe HTML injection
        codeTitle.textContent = titleToUse;
      }
      }
    }

    if (success) {
      // Clear unsaved changes indicator
      this.hasUnsavedChanges = false;
      this.updateUnsavedIndicator();
    }

    return success;
  }

  // Clear current selection when editor is manually cleared
  handleEditorContentChange() {
    const code = this.getCurrentCode();
    
    // Track unsaved changes
    this.checkForUnsavedChanges();
    
    // If editor is empty and we had a selected code, clear the selection
    // This allows the next save to create a new entry instead of trying to update
    if ((!code || !code.trim()) && this.currentSelectedCode) {
      this.currentSelectedCode = null;
      
      // Update title to reflect that no code is selected
      const codeTitle = document.getElementById('apexCodeTitle');
      if (codeTitle) {
        codeTitle.textContent = 'Select Apex Code';
      }
      
      // Clear selected state from list items
      const items = document.querySelectorAll('.apex-code-item');
      items.forEach(item => item.classList.remove('selected'));
    }
  }

  // Check for unsaved changes
  checkForUnsavedChanges() {
    const currentCode = this.getCurrentCode();
    const originalCode = this.currentSelectedCode?.code || '';
    
    this.hasUnsavedChanges = currentCode !== originalCode;
    this.updateUnsavedIndicator();
  }

  // Update unsaved changes indicator
  updateUnsavedIndicator() {
    const indicator = document.getElementById('unsavedIndicator');
    if (indicator) {
      if (this.hasUnsavedChanges) {
        indicator.classList.remove('hidden');
      } else {
        indicator.classList.add('hidden');
      }
    }
  }

  // Set editor read-only state
  setEditorReadOnly(readOnly) {
    const codeEditor = document.getElementById('apexCodeEditor');
    
    if (codeEditor) {
      if (readOnly) {
        codeEditor.readOnly = true;
        codeEditor.classList.add('read-only');
      } else {
        codeEditor.readOnly = false;
        codeEditor.classList.remove('read-only');
      }
    }
    
    this.isReadOnly = readOnly;
  }




  formatApexCode(code) {
    // Keep the original formatting method for optional use
    // This method is now only used when explicitly requested, not for saving
    
    // Normalize line endings first
    let formatted = code
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    
    // Protect string literals and comments from processing
    const protectedStrings = [];
    const protectedComments = [];
    
    // Protect single and double quoted strings
    formatted = formatted.replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, (match) => {
      const index = protectedStrings.length;
      protectedStrings.push(match);
      return `__STRING_${index}__`;
    });
    
    // Protect comments
    formatted = formatted.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, (match) => {
      const index = protectedComments.length;
      protectedComments.push(match);
      return `__COMMENT_${index}__`;
    });
    
    // Add line breaks after semicolons (except in for-loop declarations)
    formatted = formatted.replace(/;(?!\s*[)}\]])/g, ';\n');
    
    // Format braces with proper K&R style
    formatted = formatted
      // Opening brace stays on same line with space before
      .replace(/\s*\{\s*/g, ' {\n')
      // Closing brace on new line
      .replace(/\s*\}\s*/g, '\n}\n')
      // Fix } else { pattern
      .replace(/\}\s*\n\s*else\s*\{/g, '} else {')
      // Fix } catch { and } finally { patterns
      .replace(/\}\s*\n\s*(catch|finally)\s*\{/g, '} $1 {');
    
    // Add proper spacing around operators
    formatted = formatted
      .replace(/([=+\-*/<>!])=/g, ' $1= ')
      .replace(/([^=!<>])=([^=])/g, '$1 = $2')
      .replace(/([^=!<>])(==|!=|<=|>=)([^=])/g, '$1 $2 $3')
      // Add spacing after commas
      .replace(/,([^\s\n])/g, ', $1');
    
    // Split into lines and apply indentation
    const lines = formatted.split('\n');
    let indentLevel = 0;
    const indentSize = 4;
    
    const formattedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      
      // Decrease indent for closing braces, else, catch, finally
      if (trimmed.startsWith('}') || trimmed.match(/^\s*(else|catch|finally)\b/)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      
      const indentedLine = ' '.repeat(indentLevel * indentSize) + trimmed;
      
      // Increase indent after opening braces or control structures
      if (trimmed.endsWith('{') || trimmed.match(/\b(if|else|for|while|do|try|catch|finally)\b.*\{$/)) {
        indentLevel++;
      }
      
      // Handle else without braces
      if (trimmed.match(/^\s*else\s*$/) || trimmed.match(/\b(if|for|while)\s*\([^)]*\)\s*$/)) {
        indentLevel++;
      }
      
      return indentedLine;
    });
    
    // Restore protected strings and comments
    let result = formattedLines.join('\n');
    
    protectedComments.forEach((comment, index) => {
      result = result.replace(`__COMMENT_${index}__`, comment);
    });
    
    protectedStrings.forEach((str, index) => {
      result = result.replace(`__STRING_${index}__`, str);
    });
    
    // Clean up extra blank lines (max 2 consecutive)
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result.trim();
  }

  async deleteApexCode(id) {
    const response = await ApexStorageService.deleteApexCode(id);
    if (response.success) {
      await this.loadApexCodes();
      return true;
    } else {
      console.error('Failed to delete Apex code:', response.error);
      return false;
    }
  }

  async executeApexCode(code, session) {
    if (!code || !session) return null;
    
    const response = await ApexStorageService.executeApexCode(code, session);
    if (response.success) {
      return response.data;
    } else {
      const error = new Error(response.error || 'Failed to execute Apex code');
      console.error('Failed to execute Apex code:', error);
      throw error;
    }
  }

  renderApexCodeList() {
    const listContainer = document.getElementById('apexCodeList');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    // Handle different empty states
    if (this.apexCodes.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-apex-state">
          <div class="empty-icon">📝</div>
          <h4>No Apex Code Saved</h4>
          <p>Click "Add Code Block" to create your first code snippet</p>
        </div>
      `;
      return;
    }
    
    if (this.filteredCodes.length === 0 && this.searchTerm.trim()) {
      listContainer.innerHTML = `
        <div class="empty-apex-state">
          <div class="empty-icon">🔍</div>
          <h4>No Results Found</h4>
          <p>No code blocks match your search term</p>
        </div>
      `;
      return;
    }
    
    this.filteredCodes.forEach(apexCode => {
      const item = document.createElement('div');
      item.className = 'apex-code-item';
      item.dataset.id = apexCode.id;
      
      const date = new Date(apexCode.timestamp);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      
      // Build DOM nodes with textContent to prevent XSS
      const header = document.createElement('div');
      header.className = 'apex-code-header';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'apex-code-name';
      nameDiv.textContent = apexCode.name;
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'apex-code-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'apex-action-btn delete-btn';
      delBtn.dataset.id = apexCode.id;
      delBtn.title = 'Delete';
      delBtn.textContent = 'Delete';
      actionsDiv.appendChild(delBtn);
      header.appendChild(nameDiv);
      header.appendChild(actionsDiv);

      const meta = document.createElement('div');
      meta.className = 'apex-code-meta';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'apex-code-date';
      dateSpan.textContent = `${dateStr} ${timeStr}`;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'apex-code-size';
      sizeSpan.textContent = `${apexCode.code.split('\n').length} lines`;
      meta.appendChild(dateSpan);
      meta.appendChild(sizeSpan);

      item.appendChild(header);
      item.appendChild(meta);
      
      // Add click handler to select the code
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) {
          this.handleDeleteClick(e.target.dataset.id);
          return;
        }
        
        this.selectApexCode(apexCode);
      });


      
      listContainer.appendChild(item);
    });


  }

  selectApexCode(apexCode) {
    // Update selected state
    const items = document.querySelectorAll('.apex-code-item');
    items.forEach(item => item.classList.remove('selected'));
    
    const selectedItem = document.querySelector(`[data-id="${apexCode.id}"]`);
    if (selectedItem) {
      selectedItem.classList.add('selected');
    }
    
    // Show the code in the editor
    this.displayApexCode(apexCode);
  }

  displayApexCode(apexCode) {
    const codeEditor = document.getElementById('apexCodeEditor');
    const codeTitle = document.getElementById('apexCodeTitle');
    
    if (codeTitle) {
      codeTitle.textContent = apexCode.name;
    }
    
    if (codeEditor) {
      // Display formatted code
      codeEditor.value = apexCode.code;
      
      // Apply syntax highlighting
      this.updateSyntaxHighlighting();
      
      // Auto-focus and position cursor at the end
      codeEditor.focus();
      codeEditor.setSelectionRange(codeEditor.value.length, codeEditor.value.length);
    }
    
    // Store current code for execution
    this.currentSelectedCode = apexCode;
    
    // Reset unsaved changes when selecting new code
    this.hasUnsavedChanges = false;
    this.updateUnsavedIndicator();
    
    // Set editor to edit mode when selecting code
    this.setEditorReadOnly(false);
  }

  updateSyntaxHighlighting() {
    const codeEditor = document.getElementById('apexCodeEditor');
    const highlightOverlay = document.getElementById('syntaxHighlightOverlay');
    
    if (!codeEditor || !highlightOverlay) return;
    
    const code = codeEditor.value;
    
    // Show syntax highlighting only when there's content
    if (!code.trim()) {
      highlightOverlay.innerHTML = '';
      codeEditor.style.opacity = '1';
      this.updateLineNumbers();
      return;
    }
    
    // Use local highlight.js for Apex/Java syntax highlighting
    if (window.hljs) {
      try {
        // Create a pre > code element structure that highlight.js expects
        const highlightedCode = window.hljs.highlight(code, { language: 'java' }).value;
        highlightOverlay.innerHTML = `<pre><code class="hljs java">${highlightedCode}</code></pre>`;
        
        // Make editor transparent when highlighting is active
        codeEditor.style.color = 'transparent';
        codeEditor.style.opacity = '1';
      } catch (error) {
        console.warn('Highlight.js error, falling back to plain text:', error);
        highlightOverlay.innerHTML = `<pre><code>${this.escapeHtml(code)}</code></pre>`;
        codeEditor.style.color = 'var(--text-primary)';
        codeEditor.style.opacity = '0.8';
      }
    } else {
      // Fallback to plain text if highlight.js is not available
      highlightOverlay.innerHTML = `<pre><code>${this.escapeHtml(code)}</code></pre>`;
      codeEditor.style.color = 'var(--text-primary)';
      codeEditor.style.opacity = '0.8';
    }
    
    // Update line numbers
    this.updateLineNumbers();
    
    // Sync scroll position after DOM update
    requestAnimationFrame(() => {
      highlightOverlay.scrollTop = codeEditor.scrollTop;
      highlightOverlay.scrollLeft = codeEditor.scrollLeft;
      this.syncLineNumberScroll();
    });
  }

  updateLineNumbers() {
    const codeEditor = document.getElementById('apexCodeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    
    if (!codeEditor || !lineNumbers) return;
    
    const code = codeEditor.value;
    const lines = code.split('\n');
    const lineCount = lines.length;
    
    // Generate line numbers
    let lineNumbersHTML = '';
    for (let i = 1; i <= lineCount; i++) {
      lineNumbersHTML += `<div class="line-number">${i}</div>`;
    }
    
    lineNumbers.innerHTML = lineNumbersHTML;
  }

  syncLineNumberScroll() {
    const codeEditor = document.getElementById('apexCodeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    
    if (!codeEditor || !lineNumbers) return;
    
    lineNumbers.scrollTop = codeEditor.scrollTop;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  setupSyntaxHighlighting() {
    const codeEditor = document.getElementById('apexCodeEditor');
    const highlightOverlay = document.getElementById('syntaxHighlightOverlay');
    
    if (!codeEditor || !highlightOverlay) return;
    
    // Create optimized debounced version with minimal delay for smooth typing
    let inputTimeout;
    const debouncedUpdate = () => {
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        this.updateSyntaxHighlighting();
      }, 50); // Reduced to 50ms for smoother typing experience
    };
    
    // Use more efficient event handling with immediate feedback
    codeEditor.addEventListener('input', () => {
      // Handle content changes immediately for unsaved indicator
      this.handleEditorContentChange();
      
      // For very short content, update highlighting immediately for better responsiveness
      const code = codeEditor.value;
      if (code.length < 500) {
        // Small content - update immediately for smooth experience
        this.updateSyntaxHighlighting();
      } else {
        // Larger content - use debouncing for performance
        debouncedUpdate();
      }
    });
    
    // Sync scroll immediately with passive listener for better performance
    codeEditor.addEventListener('scroll', () => {
      highlightOverlay.scrollTop = codeEditor.scrollTop;
      highlightOverlay.scrollLeft = codeEditor.scrollLeft;
      this.syncLineNumberScroll();
    }, { passive: true });
    
    // Update highlighting immediately on focus
    codeEditor.addEventListener('focus', () => {
      this.updateSyntaxHighlighting();
    });
    
    // Store timeout reference for cleanup if needed
    this.highlightingTimeout = inputTimeout;
  }

  async handleDeleteClick(id) {
    if (confirm('Are you sure you want to delete this Apex code?')) {
      const success = await this.deleteApexCode(id);
      if (success) {
        // Clear editor if this was the selected code
        if (this.currentSelectedCode && this.currentSelectedCode.id === id) {
          this.clearEditor();
        }
      }
    }
  }

  clearEditor() {
    const codeEditor = document.getElementById('apexCodeEditor');
    const codeTitle = document.getElementById('apexCodeTitle');
    
    if (codeTitle) {
      codeTitle.textContent = 'Select Apex Code';
    }
    
    if (codeEditor) {
      codeEditor.value = '';
      this.updateLineNumbers();
    }
    
    // Set editor to edit mode when clearing
    this.setEditorReadOnly(false);
    
    this.currentSelectedCode = null;
  }

  getCurrentCode() {
    const codeEditor = document.getElementById('apexCodeEditor');
    return codeEditor ? codeEditor.value : '';
  }

  getCurrentSelectedCode() {
    return this.currentSelectedCode;
  }



  // Add new code block
  addNewCodeBlock() {
    // Clear any current selection
    this.currentSelectedCode = null;
    
    // Clear the editor
    const codeEditor = document.getElementById('apexCodeEditor');
    const codeTitle = document.getElementById('apexCodeTitle');
    
    if (codeEditor) {
      codeEditor.value = '';
      // Immediately update syntax highlighting to clear any old content
      this.updateSyntaxHighlighting();
    }
    
      if (codeTitle) {
        // Make the title editable for new code blocks (build safely)
        codeTitle.textContent = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'new-code-title-input';
        input.value = 'New Code Block';
        input.placeholder = 'Enter code name...';
        codeTitle.appendChild(input);
      
      // Add event handlers for the title input
        const titleInput = codeTitle.querySelector('.new-code-title-input');
      if (titleInput) {
        titleInput.focus();
        titleInput.select();
        
        // Save title on Enter or blur - with safety checks
        let titleSaved = false;
        const saveTitle = () => {
          if (titleSaved) return; // Prevent double execution
          titleSaved = true;
          
          try {
            const currentValue = titleInput.value.trim() || 'New Code Block';
            // Check if titleInput is still in the DOM before using it
            if (titleInput.parentNode) {
              codeTitle.textContent = '';
              const span = document.createElement('span');
              span.textContent = currentValue;
              codeTitle.appendChild(span);
              this.newCodeBlockTitle = currentValue;
            }
          } catch (error) {
            console.warn('Error saving title:', error);
            codeTitle.textContent = '';
            const span = document.createElement('span');
            span.textContent = 'New Code Block';
            codeTitle.appendChild(span);
            this.newCodeBlockTitle = 'New Code Block';
          }
        };
        
        const cancelTitle = () => {
          if (titleSaved) return;
          titleSaved = true;
          
          try {
            codeTitle.textContent = '';
            const span = document.createElement('span');
            span.textContent = 'New Code Block';
            codeTitle.appendChild(span);
            this.newCodeBlockTitle = 'New Code Block';
            codeEditor?.focus();
          } catch (error) {
            console.warn('Error canceling title edit:', error);
          }
        };
        
        titleInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveTitle();
            codeEditor?.focus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelTitle();
          }
        });
        
        titleInput.addEventListener('blur', saveTitle);
      }
    }
    
    // Clear selected state from list items
    const items = document.querySelectorAll('.apex-code-item');
    items.forEach(item => item.classList.remove('selected'));
    
    // Reset unsaved changes
    this.hasUnsavedChanges = false;
    this.updateUnsavedIndicator();
    
    // Set editor to edit mode for new code
    this.setEditorReadOnly(false);
    
    // Store that this is a new code block
    this.isNewCodeBlock = true;
    this.newCodeBlockTitle = 'New Code Block';
  }

  // Modal functionality
  openModal() {
    const modal = document.getElementById('apexManagerModal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Initialize if not already done
      if (!this.isInitialized && this.currentOrgId) {
        this.loadApexCodes();
        this.isInitialized = true;
      }
      
      // Setup syntax highlighting and search
      setTimeout(() => {
        this.setupSyntaxHighlighting();
        this.setupSearchEventListeners();
      }, 100);
    }
  }

  closeModal() {
    const modal = document.getElementById('apexManagerModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  setupModalEventListeners() {
    // Open modal button
    const openBtn = document.getElementById('openApexManagerBtn');
    if (openBtn) {
      openBtn.addEventListener('click', () => this.openModal());
    }

    // Close modal button
    const closeBtn = document.getElementById('closeApexManagerBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Close modal when clicking outside
    const modal = document.getElementById('apexManagerModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal();
        }
      });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('apexManagerModal');
        if (modal && modal.style.display === 'flex') {
          this.closeModal();
        }
      }
    });
  }
}

// Global instance
window.apexCodeManager = new ApexCodeManager();