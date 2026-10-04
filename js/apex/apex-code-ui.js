/**
 * Apex Code UI Methods
 * Extends ApexCodeManager prototype with UI interaction methods.
 */

ApexCodeManager.prototype.filterApexCodes = function () {
    if (!this.searchTerm || !this.searchTerm.trim()) {
        this.filteredCodes = [...this.apexCodes];
    } else {
        const searchLower = this.searchTerm.toLowerCase();
        this.filteredCodes = this.apexCodes.filter(apexCode => {
            return apexCode.name.toLowerCase().includes(searchLower) || apexCode.code.toLowerCase().includes(searchLower);
        });
    }
    this.renderApexCodeList();
};

ApexCodeManager.prototype.handleSearch = function (searchTerm) {
    this.searchTerm = searchTerm;
    this.filterApexCodes();
};

ApexCodeManager.prototype.setupSearchEventListeners = function () {
    const searchInput = document.getElementById('apexSearchInput');
    if (!searchInput) return;

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => this.handleSearch(e.target.value), 300);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            this.handleSearch('');
        }
    });
};

ApexCodeManager.prototype.updateUnsavedIndicator = function () {
    const indicator = document.getElementById('unsavedIndicator');
    if (indicator) indicator.classList.toggle('hidden', !this.hasUnsavedChanges);

    // Ask before the tab is closed or reloaded, but only while there are unsaved changes.
    if (this.hasUnsavedChanges && !this.beforeUnloadGuard) {
        this.beforeUnloadGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', this.beforeUnloadGuard);
    } else if (!this.hasUnsavedChanges && this.beforeUnloadGuard) {
        window.removeEventListener('beforeunload', this.beforeUnloadGuard);
        this.beforeUnloadGuard = null;
    }
};

ApexCodeManager.prototype.renderApexCodeList = function () {
    const listContainer = document.getElementById('apexCodeList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!this.currentOrgId) {
        listContainer.innerHTML = `<div class="empty-apex-state"><div class="empty-icon">${Icons.svg('fileCode', 20)}</div><h4>Org not found</h4><p>Open the dashboard from a Salesforce tab</p></div>`;
        return;
    }

    if (this.apexCodes.length === 0) {
        listContainer.innerHTML = `<div class="empty-apex-state"><div class="empty-icon">${Icons.svg('fileCode', 20)}</div><h4>No saved snippets</h4><p>Click New to add one</p></div>`;
        return;
    }

    if (this.filteredCodes.length === 0 && this.searchTerm.trim()) {
        listContainer.innerHTML = `<div class="empty-apex-state"><div class="empty-icon">${Icons.svg('search', 20)}</div><h4>No results</h4><p>No snippets match your search</p></div>`;
        return;
    }

    this.filteredCodes.forEach(apexCode => {
        const item = document.createElement('div');
        item.className = 'apex-code-item';
        item.dataset.id = apexCode.id;
        if (this.currentSelectedCode && this.currentSelectedCode.id === apexCode.id) item.classList.add('selected');

        const date = new Date(apexCode.timestamp);
        item.innerHTML = `
      <div class="apex-code-header">
        <div class="apex-code-name"></div>
        <div class="apex-code-actions"><button class="apex-action-btn delete-btn" title="Delete snippet" aria-label="Delete snippet">${Icons.svg('trash', 13)}</button></div>
      </div>
      <div class="apex-code-meta">
        <span class="apex-code-date">${formatDateTimeNice(date)}</span>
        <span class="apex-code-size">${apexCode.code.split('\n').length} lines</span>
      </div>`;
        item.querySelector('.apex-code-name').textContent = apexCode.name;

        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn')) {
                this.handleDeleteClick(apexCode.id);
            } else if (this.confirmDiscardChanges()) {
                this.selectApexCode(apexCode);
            }
        });
        listContainer.appendChild(item);
    });
};

ApexCodeManager.prototype.selectApexCode = function (apexCode) {
    document.querySelectorAll('.apex-code-item').forEach(item => item.classList.toggle('selected', item.dataset.id === apexCode.id));
    this.displayApexCode(apexCode);
};

ApexCodeManager.prototype.displayApexCode = function (apexCode) {
    const codeEditor = document.getElementById('apexCodeEditor');
    const codeTitle = document.getElementById('apexCodeTitle');
    if (codeTitle) codeTitle.textContent = apexCode.name;
    if (codeEditor) {
        codeEditor.value = apexCode.code;
        this.updateSyntaxHighlighting();
        codeEditor.focus();
        codeEditor.setSelectionRange(codeEditor.value.length, codeEditor.value.length);
    }
    this.currentSelectedCode = apexCode;
    this.hasUnsavedChanges = false;
    this.updateUnsavedIndicator();
};

ApexCodeManager.prototype.beginInlineTitleEdit = function () {
    const codeTitle = document.getElementById('apexCodeTitle');
    if (!codeTitle || codeTitle.querySelector('input')) return;

    const hasSelection = !!(this.currentSelectedCode && this.currentSelectedCode.id);
    const currentTitle = codeTitle.textContent.trim();
    const original = hasSelection ? (this.currentSelectedCode.name || 'New Code Block') : (currentTitle === 'Select Apex Code' ? (this.newCodeBlockTitle || 'New Code Block') : currentTitle);

    codeTitle.textContent = '';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'new-code-title-input';
    input.value = original; input.placeholder = 'Enter code name...';
    codeTitle.appendChild(input);
    input.focus(); input.select();

    let handled = false;
    const applyRename = async () => {
        if (handled) return; handled = true;
        const newName = input.value.trim() || original;
        codeTitle.textContent = newName;
        if (hasSelection) {
            try {
                const updated = await this.updateApexCode(this.currentSelectedCode.id, newName, this.getCurrentCode());
                this.currentSelectedCode = updated; this.selectApexCodeById(updated.id);
            } catch (e) {
                codeTitle.textContent = original;
                alert('Could not rename: ' + e.message);
            }
        } else {
            this.isNewCodeBlock = true; this.newCodeBlockTitle = newName;
        }
    };
    const cancelRename = () => { if (!handled) { handled = true; codeTitle.textContent = original; } };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyRename(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    input.addEventListener('blur', applyRename);
};

ApexCodeManager.prototype.updateSyntaxHighlighting = function () {
    const codeEditor = document.getElementById('apexCodeEditor'), highlightOverlay = document.getElementById('syntaxHighlightOverlay');
    if (!codeEditor || !highlightOverlay) return;
    const code = codeEditor.value;
    if (!code.trim()) { highlightOverlay.innerHTML = ''; codeEditor.style.color = 'inherit'; this.updateLineNumbers(); return; }

    if (window.hljs) {
        try {
            const highlightedCode = window.hljs.highlight(code, { language: 'java' }).value;
            highlightOverlay.innerHTML = `<pre><code class="hljs java">${highlightedCode}</code></pre>`;
            codeEditor.style.color = 'transparent';
        } catch (error) {
            highlightOverlay.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
            codeEditor.style.color = 'inherit';
        }
    } else {
        highlightOverlay.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
    this.updateLineNumbers();
    requestAnimationFrame(() => {
        highlightOverlay.scrollTop = codeEditor.scrollTop;
        highlightOverlay.scrollLeft = codeEditor.scrollLeft;
        this.syncLineNumberScroll();
    });
};

ApexCodeManager.prototype.updateLineNumbers = function () {
    const codeEditor = document.getElementById('apexCodeEditor'), lineNumbers = document.getElementById('lineNumbers');
    if (!codeEditor || !lineNumbers) return;
    const lineCount = codeEditor.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= lineCount; i++) html += `<div class="line-number">${i}</div>`;
    lineNumbers.innerHTML = html;
};

ApexCodeManager.prototype.syncLineNumberScroll = function () {
    const ed = document.getElementById('apexCodeEditor'), ln = document.getElementById('lineNumbers');
    if (ed && ln) ln.scrollTop = ed.scrollTop;
};

ApexCodeManager.prototype.setupSyntaxHighlighting = function () {
    const ed = document.getElementById('apexCodeEditor'), ho = document.getElementById('syntaxHighlightOverlay');
    if (!ed || !ho) return;
    let inputTimeout;
    ed.addEventListener('input', () => {
        this.handleEditorContentChange();
        if (ed.value.length < 500) this.updateSyntaxHighlighting();
        else { clearTimeout(inputTimeout); inputTimeout = setTimeout(() => this.updateSyntaxHighlighting(), 50); }
    });
    // Add keydown listener to handle Enter key specifically
    ed.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // When Enter is pressed, we want to ensure the next line starts from the left
            // especially if we were scrolled to the right on a long line
            requestAnimationFrame(() => {
                ed.scrollLeft = 0;
                ho.scrollLeft = 0;
                this.updateSyntaxHighlighting();
            });
        }
    });
    ed.addEventListener('scroll', () => {
        ho.scrollTop = ed.scrollTop; ho.scrollLeft = ed.scrollLeft;
        this.syncLineNumberScroll();
    }, { passive: true });
    ed.addEventListener('focus', () => this.updateSyntaxHighlighting());
};

ApexCodeManager.prototype.addNewCodeBlock = function () {
    if (!this.confirmDiscardChanges()) return;
    this.currentSelectedCode = null;
    const ed = document.getElementById('apexCodeEditor'), ct = document.getElementById('apexCodeTitle');
    if (ed) { ed.value = ''; this.updateSyntaxHighlighting(); }
    if (ct) {
        ct.textContent = '';
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'new-code-title-input';
        input.value = 'New Code Block'; input.placeholder = 'Enter code name...';
        ct.appendChild(input); input.focus(); input.select();

        let saved = false;
        const save = () => {
            if (saved) return; saved = true;
            const val = input.value.trim() || 'New Code Block';
            ct.textContent = val; this.newCodeBlockTitle = val;
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); ed?.focus(); } else if (e.key === 'Escape') { e.preventDefault(); ct.textContent = 'New Code Block'; this.newCodeBlockTitle = 'New Code Block'; saved = true; ed?.focus(); } });
        input.addEventListener('blur', save);
    }
    document.querySelectorAll('.apex-code-item').forEach(i => i.classList.remove('selected'));
    this.hasUnsavedChanges = false; this.updateUnsavedIndicator();
    this.isNewCodeBlock = true; this.newCodeBlockTitle = 'New Code Block';
};

ApexCodeManager.prototype.exportApexCodes = function () {
    if (!this.apexCodes || this.apexCodes.length === 0) {
        alert('No saved code blocks to export.');
        return;
    }
    const payload = {
        type: 'salesforce-debug-log-beautifier/apex-snippets',
        version: 1,
        exportedAt: new Date().toISOString(),
        snippets: this.apexCodes.map(c => ({ name: c.name, code: c.code }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-snippets-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

ApexCodeManager.prototype.importApexCodes = async function (file) {
    if (!file) return;
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    const MAX_CODE_CHARS = 100000;
    try {
        if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 2 MB');
        const data = JSON.parse(await file.text());
        // Accept either a bare array of snippets or the { snippets: [...] } export shape.
        const snippets = Array.isArray(data) ? data : (Array.isArray(data?.snippets) ? data.snippets : null);
        if (!snippets) throw new Error('Unrecognized file format');

        // Skip empty snippets, very large ones, and ones already saved (same name and code).
        const seen = new Set(this.apexCodes.map(c => `${c.name}\n${c.code}`));
        const items = [];
        let skipped = 0, tooLarge = 0;
        for (const s of snippets) {
            const code = (s && typeof s.code === 'string') ? ApexStorageService.sanitizeApexCode(s.code) : '';
            if (!code) { skipped++; continue; }
            if (code.length > MAX_CODE_CHARS) { tooLarge++; continue; }
            const name = (s && typeof s.name === 'string' && s.name.trim()) ? s.name.trim() : 'Imported Snippet';
            const key = `${name}\n${code}`;
            if (seen.has(key)) { skipped++; continue; }
            seen.add(key);
            items.push({ name, code });
        }
        // One storage write for the whole file; new ids are assigned, so existing snippets are never replaced.
        if (items.length) await this.saveApexCodes(items);

        let message = `Imported ${items.length} code block(s).`;
        if (skipped) message += ` Skipped ${skipped} empty or already saved.`;
        if (tooLarge) message += ` Skipped ${tooLarge} larger than ${MAX_CODE_CHARS.toLocaleString('en-US')} characters.`;
        alert(message);
    } catch (e) {
        alert('Import failed: ' + (e.message || 'invalid file'));
    }
};

ApexCodeManager.prototype.openModal = function () {
    const modal = document.getElementById('apexManagerModal');
    if (modal) {
        this._lastFocused = document.activeElement;
        modal.style.display = 'flex';
        document.getElementById('closeApexManagerBtn')?.focus();
        if (!this.isInitialized && this.currentOrgId) { this.loadApexCodes(); this.isInitialized = true; }
        // Bind the editor, search and rename listeners once (binding on every open stacked duplicate handlers).
        if (!this.listenersBound) {
            this.listenersBound = true;
            this.setupSyntaxHighlighting(); this.setupSearchEventListeners();
            document.getElementById('editApexTitleBtn')?.addEventListener('click', () => this.beginInlineTitleEdit());
            const titleEl = document.getElementById('apexCodeTitle');
            if (titleEl) { titleEl.title = 'Double-click to rename'; titleEl.addEventListener('dblclick', () => this.beginInlineTitleEdit()); }
        }
    }
};

// Selects and scrolls to a line in the editor and marks its line number (used for compile errors).
ApexCodeManager.prototype.highlightEditorLine = function (line) {
    const ed = document.getElementById('apexCodeEditor');
    if (!ed || !(line > 0)) return;
    const lines = ed.value.split('\n');
    if (line > lines.length) return;
    const start = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0);
    ed.focus();
    ed.setSelectionRange(start, start + lines[line - 1].length);
    ed.scrollTop = Math.max(0, (line - 3) * (parseFloat(getComputedStyle(ed).lineHeight) || 22));
    document.querySelectorAll('#lineNumbers .line-number').forEach((el, i) => el.classList.toggle('error-line', i === line - 1));
};

ApexCodeManager.prototype.closeModal = function () {
    const modal = document.getElementById('apexManagerModal');
    if (modal) modal.style.display = 'none';
    this._lastFocused?.focus?.();
};

ApexCodeManager.prototype.setupModalEventListeners = function () {
    document.getElementById('closeApexManagerBtn')?.addEventListener('click', () => this.closeModal());
    const modal = document.getElementById('apexManagerModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal?.style.display === 'flex') this.closeModal(); });
};

