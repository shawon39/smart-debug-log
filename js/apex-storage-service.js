// Apex Storage Service
// Handles all Chrome storage operations for Apex code management

class ApexStorageService {


  /**
   * Load Apex codes from storage for a specific org
   * @param {string} orgId - Organization ID
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  static async loadApexCodes(orgId) {
    if (!orgId) {
      return { success: false, error: 'Organization ID is required' };
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_APEX_CODES',
        orgId: orgId
      });
      
      return response;
    } catch (error) {
      console.error('Failed to load Apex codes:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save new Apex code to storage
   * @param {string} name - Code name
   * @param {string} code - Apex code content
   * @param {string} orgId - Organization ID
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  static async saveApexCode(name, code, orgId) {
    if (!code || !orgId) {
      return { success: false, error: 'Code and organization ID are required' };
    }
    
    if (!name || !name.trim()) {
      return { success: false, error: 'Code name is required' };
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_APEX_CODE',
        name: name.trim(),
        code: this.sanitizeApexCode(code.trim()),
        orgId: orgId
      });
      
      return response;
    } catch (error) {
      console.error('Failed to save Apex code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update existing Apex code in storage
   * @param {string} id - Code ID
   * @param {string} name - Code name
   * @param {string} code - Apex code content
   * @param {string} orgId - Organization ID
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  static async updateApexCode(id, name, code, orgId) {
    if (!id || !code || !orgId) {
      return { success: false, error: 'ID, code, and organization ID are required' };
    }
    
    if (!name || !name.trim()) {
      return { success: false, error: 'Code name is required' };
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_APEX_CODE',
        id: id,
        name: name.trim(),
        code: this.sanitizeApexCode(code.trim()),
        orgId: orgId
      });
      
      return response;
    } catch (error) {
      console.error('Failed to update Apex code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete Apex code from storage
   * @param {string} id - Code ID
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  static async deleteApexCode(id) {
    if (!id) {
      return { success: false, error: 'Code ID is required' };
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_APEX_CODE',
        id: id
      });
      
      return response;
    } catch (error) {
      console.error('Failed to delete Apex code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute Apex code via anonymous execution
   * @param {string} code - Apex code to execute
   * @param {object} session - Salesforce session
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  static async executeApexCode(code, session) {
    if (!code || !session) {
      return { success: false, error: 'Code and session are required' };
    }
    
    try {
      // Get sfHost from URL for org-aware token selection
      const sfHost = typeof getHostFromUrl === 'function' ? getHostFromUrl() : null;
      
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_ANONYMOUS',
        code: code,
        session: session,
        sfHost: sfHost
      });
      
      return response;
    } catch (error) {
      console.error('Failed to execute Apex code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sanitize Apex code for storage
   * @param {string} code - Raw code
   * @returns {string} Sanitized code
   */
  static sanitizeApexCode(code) {
    // Only do minimal sanitization to preserve the original code structure
    return code
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\r/g, '\n')    // Normalize line endings
      .trim();                 // Remove leading/trailing whitespace
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApexStorageService;
}

// Make available globally for browser usage
window.ApexStorageService = ApexStorageService;