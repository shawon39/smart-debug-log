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
    this.isReadOnly = false;
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
    if (!this.currentOrgId) return;
    const response = await ApexStorageService.loadApexCodes(this.currentOrgId);
    if (response.success) {
      this.apexCodes = response.data;
      this.filterApexCodes();
    } else {
      console.error('Failed to load Apex codes:', response.error);
    }
  }

  async saveApexCode(name, code) {
    if (!code || !this.currentOrgId || !name?.trim()) return null;
    const response = await ApexStorageService.saveApexCode(name.trim(), code.trim(), this.currentOrgId);
    if (response.success) {
      const saved = response.data || null;
      await this.loadApexCodes();
      return saved;
    }
    return null;
  }

  async updateApexCode(id, name, code) {
    if (!id || !code || !this.currentOrgId || !name?.trim()) return null;
    const response = await ApexStorageService.updateApexCode(id, name.trim(), code.trim(), this.currentOrgId);
    if (response.success) {
      const updated = response.data || null;
      await this.loadApexCodes();
      return updated;
    }
    return null;
  }

  async saveOrUpdateCurrentCode() {
    const code = this.getCurrentCode();
    if (!code?.trim()) return false;

    let success = false;
    if (this.currentSelectedCode?.id) {
      const title = this.getCurrentTitle() || this.currentSelectedCode.name;
      const updated = await this.updateApexCode(this.currentSelectedCode.id, title, code.trim());
      success = !!updated;
      if (success) {
        this.currentSelectedCode = updated;
        const ct = document.getElementById('apexCodeTitle');
        if (ct) ct.textContent = updated.name;
        this.selectApexCodeById(updated.id);
      }
    } else {
      const title = (this.isNewCodeBlock && this.newCodeBlockTitle) ? this.newCodeBlockTitle : this.inferNewCodeTitle();
      const saved = await this.saveApexCode(title, code.trim());
      success = !!saved;
      if (success) {
        this.isNewCodeBlock = false; this.newCodeBlockTitle = null;
        const ct = document.getElementById('apexCodeTitle');
        if (ct) ct.textContent = saved.name;
        this.selectApexCodeById(saved.id);
      }
    }

    if (success) { this.hasUnsavedChanges = false; this.updateUnsavedIndicator(); }
    return success;
  }

  getCurrentTitle() {
    return document.getElementById('apexCodeTitle')?.textContent.trim() || '';
  }

  inferNewCodeTitle() {
    const text = (this.newCodeBlockTitle || this.getCurrentTitle()).trim();
    return (!text || text === 'Select Apex Code') ? 'New Code Block' : text;
  }

  handleEditorContentChange() {
    const code = this.getCurrentCode();
    this.checkForUnsavedChanges();
    if (!code?.trim() && this.currentSelectedCode) {
      this.currentSelectedCode = null;
      const ct = document.getElementById('apexCodeTitle');
      if (ct) ct.textContent = 'Select Apex Code';
      document.querySelectorAll('.apex-code-item').forEach(i => i.classList.remove('selected'));
    }
  }

  checkForUnsavedChanges() {
    this.hasUnsavedChanges = this.getCurrentCode() !== (this.currentSelectedCode?.code || '');
    this.updateUnsavedIndicator();
  }

  async deleteApexCode(id) {
    const response = await ApexStorageService.deleteApexCode(id);
    if (response.success) { await this.loadApexCodes(); return true; }
    return false;
  }

  async executeApexCode(code, session) {
    if (!code || !session) return null;
    const response = await ApexStorageService.executeApexCode(code, session);
    if (response.success) return response.data;
    throw new Error(response.error || 'Failed to execute Apex code');
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
    if (ed) { ed.value = ''; this.updateLineNumbers(); }
    this.setEditorReadOnly(false);
    this.currentSelectedCode = null;
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
