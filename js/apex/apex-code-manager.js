/**
 * Apex Code Manager
 * Handles storage and management of saved Apex code snippets.
 * Core class definition and storage logic.
 */

class ApexCodeManager {
  constructor() {
    this.apexCodes = [];
    this.currentOrgId = null;
    this.isInitialized = false;
    this.hasUnsavedChanges = false;
    this.searchTerm = '';
    this.filteredCodes = [];
    this.currentSelectedCode = null;
    this.isNewCodeBlock = false;
    this.newCodeBlockTitle = null;
  }

  async initialize(orgId) {
    this.currentOrgId = orgId;
    await this.loadApexCodes();
  }

  async loadApexCodes() {
    if (!this.currentOrgId) { this.renderApexCodeList(); return; }
    const response = await ApexStorageService.loadApexCodes(this.currentOrgId);
    if (response.success) {
      this.apexCodes = response.data;
      this.filterApexCodes();
    } else {
      console.error('Failed to load Apex codes:', response.error);
    }
  }

  // Throws with the reason when a snippet cannot be saved, so the UI can show it.
  checkCanSave(name, code) {
    if (!this.currentOrgId) throw new Error('Salesforce org not found. Reopen the dashboard from a Salesforce tab.');
    if (!code?.trim()) throw new Error('No Apex code to save');
    if (!name?.trim()) throw new Error('Code name is required');
  }

  // Storage errors come from chrome.storage; make the quota error readable.
  storageErrorText(message) {
    if (/quota/i.test(message || '')) return 'Extension storage is full. Export and delete some snippets, then try again.';
    return message || 'Unknown error';
  }

  async saveApexCode(name, code) {
    this.checkCanSave(name, code);
    const response = await ApexStorageService.saveApexCode(name.trim(), code.trim(), this.currentOrgId);
    if (!response?.success) throw new Error(this.storageErrorText(response?.error));
    await this.loadApexCodes();
    return response.data;
  }

  // Saves imported snippets ([{ name, code }]) with one storage write
  async saveApexCodes(items) {
    if (!this.currentOrgId) throw new Error('Salesforce org not found. Reopen the dashboard from a Salesforce tab.');
    const response = await ApexStorageService.saveApexCodes(items, this.currentOrgId);
    if (!response?.success) throw new Error(this.storageErrorText(response?.error));
    await this.loadApexCodes();
    return response.data || [];
  }

  async updateApexCode(id, name, code) {
    this.checkCanSave(name, code);
    const response = await ApexStorageService.updateApexCode(id, name.trim(), code.trim(), this.currentOrgId);
    if (!response?.success) throw new Error(this.storageErrorText(response?.error));
    await this.loadApexCodes();
    return response.data;
  }

  // Saves the editor content (update when a snippet is selected, else a new snippet). Throws on failure.
  async saveOrUpdateCurrentCode() {
    const code = this.getCurrentCode();

    if (this.currentSelectedCode?.id) {
      const title = this.getCurrentTitle() || this.currentSelectedCode.name;
      const updated = await this.updateApexCode(this.currentSelectedCode.id, title, code);
      this.currentSelectedCode = updated;
      const ct = document.getElementById('apexCodeTitle');
      if (ct) ct.textContent = updated.name;
      this.selectApexCodeById(updated.id);
    } else {
      const title = (this.isNewCodeBlock && this.newCodeBlockTitle) ? this.newCodeBlockTitle : this.inferNewCodeTitle();
      const saved = await this.saveApexCode(title, code);
      this.isNewCodeBlock = false; this.newCodeBlockTitle = null;
      const ct = document.getElementById('apexCodeTitle');
      if (ct) ct.textContent = saved.name;
      this.selectApexCodeById(saved.id);
    }

    this.hasUnsavedChanges = false; this.updateUnsavedIndicator();
    return true;
  }

  getCurrentTitle() {
    return document.getElementById('apexCodeTitle')?.textContent.trim() || '';
  }

  inferNewCodeTitle() {
    const text = (this.newCodeBlockTitle || this.getCurrentTitle()).trim();
    return (!text || text === 'Select Apex Code') ? 'New Code Block' : text;
  }

  // The selected snippet stays selected even when the editor is emptied,
  // so Save updates it instead of creating a duplicate.
  handleEditorContentChange() {
    this.checkForUnsavedChanges();
  }

  checkForUnsavedChanges() {
    this.hasUnsavedChanges = this.getCurrentCode() !== (this.currentSelectedCode?.code || '');
    this.updateUnsavedIndicator();
  }

  // Asks before unsaved editor changes are thrown away. Returns true when it is OK to continue.
  confirmDiscardChanges() {
    return !this.hasUnsavedChanges || confirm('You have unsaved changes in the editor. Discard them?');
  }

  async deleteApexCode(id) {
    const response = await ApexStorageService.deleteApexCode(id, this.currentOrgId);
    if (response.success) { await this.loadApexCodes(); return true; }
    return false;
  }

  async executeApexCode(code) {
    if (!code) return null;
    const response = await ApexStorageService.executeApexCode(code);
    if (response?.success) return response.data;
    throw new Error(response?.error || 'Failed to execute Apex code');
  }

  async handleDeleteClick(id) {
    if (confirm('Are you sure you want to delete this Apex code?')) {
      if (await this.deleteApexCode(id)) {
        if (this.currentSelectedCode?.id === id) this.clearEditor();
      }
    }
  }

  clearEditor() {
    const ed = document.getElementById('apexCodeEditor'), ct = document.getElementById('apexCodeTitle');
    if (ct) ct.textContent = 'Select Apex Code';
    if (ed) { ed.value = ''; this.updateSyntaxHighlighting(); }
    this.currentSelectedCode = null;
    this.hasUnsavedChanges = false;
    this.updateUnsavedIndicator();
  }

  getCurrentCode() {
    return document.getElementById('apexCodeEditor')?.value || '';
  }

  selectApexCodeById(id) {
    const found = this.apexCodes.find(c => c.id === id);
    if (found) this.selectApexCode(found);
  }
}

// Global instance
window.apexCodeManager = new ApexCodeManager();
