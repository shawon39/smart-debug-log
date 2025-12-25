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
};

ApexCodeManager.prototype.setEditorReadOnly = function (readOnly) {
    const codeEditor = document.getElementById('apexCodeEditor');
    if (codeEditor) {
        codeEditor.readOnly = readOnly;
        codeEditor.classList.toggle('read-only', readOnly);
    }
    this.isReadOnly = readOnly;
};

ApexCodeManager.prototype.renderApexCodeList = function () {
    const listContainer = document.getElementById('apexCodeList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (this.apexCodes.length === 0) {
        listContainer.innerHTML = '<div class="empty-apex-state"><div class="empty-icon">📝</div><h4>No Apex Code Saved</h4><p>Click "Add Code Block" to create your first code snippet</p></div>';
        return;
    }

    if (this.filteredCodes.length === 0 && this.searchTerm.trim()) {
        listContainer.innerHTML = '<div class="empty-apex-state"><div class="empty-icon">🔍</div><h4>No Results Found</h4><p>No code blocks match your search term</p></div>';
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
        <div class="apex-code-name">${escapeHtml(apexCode.name)}</div>
        <div class="apex-code-actions"><button class="apex-action-btn delete-btn" data-id="${escapeHtml(apexCode.id)}" title="Delete">Delete</button></div>
      </div>
      <div class="apex-code-meta">
        <span class="apex-code-date">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</span>
        <span class="apex-code-size">${apexCode.code.split('\n').length} lines</span>
      </div>`;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn')) {
                this.handleDeleteClick(e.target.dataset.id);
            } else {
                this.selectApexCode(apexCode);
            }
        });
        listContainer.appendChild(item);
    });
};

ApexCodeManager.prototype.selectApexCode = function (apexCode) {
    document.querySelectorAll('.apex-code-item').forEach(item => item.classList.remove('selected'));
    const selectedItem = document.querySelector(`[data-id="${apexCode.id}"]`);
    if (selectedItem) selectedItem.classList.add('selected');
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
    this.setEditorReadOnly(false);
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
                if (updated) { this.currentSelectedCode = updated; this.selectApexCodeById(updated.id); }
                else codeTitle.textContent = original;
            } catch (e) { codeTitle.textContent = original; }
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
            highlightOverlay.innerHTML = `<pre><code>${this.escapeHtml(code)}</code></pre>`;
            codeEditor.style.color = 'inherit';
        }
    } else {
        highlightOverlay.innerHTML = `<pre><code>${this.escapeHtml(code)}</code></pre>`;
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
    this.setEditorReadOnly(false); this.isNewCodeBlock = true; this.newCodeBlockTitle = 'New Code Block';
};

ApexCodeManager.prototype.openModal = function () {
    const modal = document.getElementById('apexManagerModal');
    if (modal) {
        modal.style.display = 'flex';
        if (!this.isInitialized && this.currentOrgId) { this.loadApexCodes(); this.isInitialized = true; }
        setTimeout(() => {
            this.setupSyntaxHighlighting(); this.setupSearchEventListeners();
            const editBtn = document.getElementById('editApexTitleBtn');
            if (editBtn && !editBtn.dataset.bound) { editBtn.dataset.bound = '1'; editBtn.addEventListener('click', () => this.beginInlineTitleEdit()); }
        }, 100);
    }
};

ApexCodeManager.prototype.closeModal = function () {
    const modal = document.getElementById('apexManagerModal');
    if (modal) modal.style.display = 'none';
};

ApexCodeManager.prototype.setupModalEventListeners = function () {
    document.getElementById('closeApexManagerBtn')?.addEventListener('click', () => this.closeModal());
    const modal = document.getElementById('apexManagerModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal?.style.display === 'flex') this.closeModal(); });
};

