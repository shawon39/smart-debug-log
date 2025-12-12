// Debug Level Creator
// Handles creation of custom Debug Levels via Tooling API

class DebugLevelCreator {
  constructor(managerUI) {
    this.managerUI = managerUI;
    this.picklistValues = null;
    this.isFormOpen = false;
    
    // Field mappings for picklist population
    this.fieldMappings = {
      'ApexCode': 'apexCodeLevel',
      'ApexProfiling': 'apexProfilingLevel',
      'Database': 'databaseLevel',
      'System': 'systemLevel',
      'Workflow': 'workflowLevel',
      'Validation': 'validationLevel',
      'Callout': 'calloutLevel',
      'Visualforce': 'visualforceLevel'
    };
  }

  // Initialize event listeners
  setupEventListeners() {
    const createBtn = document.getElementById('createDebugLevelBtn');
    const closeFormBtn = document.getElementById('closeCreateFormBtn');
    const cancelBtn = document.getElementById('cancelCreateDebugLevelBtn');
    const submitBtn = document.getElementById('submitCreateDebugLevelBtn');
    const labelInput = document.getElementById('debugLevelLabel');
    const apiNameInput = document.getElementById('debugLevelApiName');

    if (createBtn) {
      createBtn.addEventListener('click', () => this.openForm());
    }

    if (closeFormBtn) {
      closeFormBtn.addEventListener('click', () => this.closeForm());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeForm());
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    if (labelInput) {
      labelInput.addEventListener('input', (e) => this.handleLabelInput(e.target.value));
    }

    if (apiNameInput) {
      apiNameInput.addEventListener('input', (e) => this.validateApiName(e.target.value));
    }
  }

  // Open the create form
  async openForm() {
    const form = document.getElementById('createDebugLevelForm');
    if (!form) return;

    this.isFormOpen = true;
    form.classList.remove('hidden');

    // Reset form
    this.resetForm();

    // Fetch picklist values
    await this.fetchPicklistValues();
  }

  // Close the form
  closeForm() {
    const form = document.getElementById('createDebugLevelForm');
    if (!form) return;

    this.isFormOpen = false;
    form.classList.add('hidden');
    this.resetForm();
  }

  // Reset form to initial state
  resetForm() {
    const labelInput = document.getElementById('debugLevelLabel');
    const apiNameInput = document.getElementById('debugLevelApiName');

    if (labelInput) labelInput.value = '';
    if (apiNameInput) apiNameInput.value = '';

    // Reset all dropdowns
    Object.values(this.fieldMappings).forEach(elementId => {
      const select = document.getElementById(elementId);
      if (select) {
        select.innerHTML = '<option value="">Loading...</option>';
      }
    });

    // Clear validation messages
    this.clearValidationErrors();
  }

  // Fetch picklist values from Salesforce
  async fetchPicklistValues() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TOOLING_DESCRIBE',
        sobjectType: 'DebugLevel',
        sfHost: this.managerUI.sfHost
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to fetch picklist values');
      }

      this.picklistValues = response.data;
      this.populatePicklists();

    } catch (error) {
      console.error('Failed to fetch picklist values:', error);
      this.managerUI.showNotification('Failed to load form options: ' + error.message, 'error');
      this.closeForm();
    }
  }

  // Populate all picklist dropdowns
  populatePicklists() {
    if (!this.picklistValues || !this.picklistValues.fields) {
      return;
    }

    Object.entries(this.fieldMappings).forEach(([fieldName, elementId]) => {
      const field = this.picklistValues.fields.find(f => f.name === fieldName);
      if (!field || !field.picklistValues) {
        return;
      }

      const select = document.getElementById(elementId);
      if (!select) return;

      // Clear loading message
      select.innerHTML = '';

      // Add options
      field.picklistValues.forEach(picklistValue => {
        if (picklistValue.active) {
          const option = document.createElement('option');
          option.value = picklistValue.value;
          option.textContent = picklistValue.label;
          select.appendChild(option);
        }
      });

      // Set default values based on common debug settings
      this.setDefaultValue(elementId, fieldName);
    });
  }

  // Set default values for each field
  setDefaultValue(elementId, fieldName) {
    const select = document.getElementById(elementId);
    if (!select) return;

    // Default values for common debug level settings
    const defaults = {
      'ApexCode': 'DEBUG',
      'ApexProfiling': 'INFO',
      'Database': 'INFO',
      'System': 'DEBUG',
      'Workflow': 'INFO',
      'Validation': 'INFO',
      'Callout': 'INFO',
      'Visualforce': 'INFO'
    };

    const defaultValue = defaults[fieldName];
    if (defaultValue) {
      // Try to set the default value
      const option = Array.from(select.options).find(opt => opt.value === defaultValue);
      if (option) {
        select.value = defaultValue;
      }
    }
  }

  // Handle label input - auto-generate API name
  handleLabelInput(label) {
    const apiNameInput = document.getElementById('debugLevelApiName');
    if (!apiNameInput) return;

    // Auto-generate API name from label
    const apiName = this.generateApiName(label);
    apiNameInput.value = apiName;

    // Validate the generated API name
    this.validateApiName(apiName);
  }

  // Generate API name from label
  generateApiName(label) {
    if (!label) return '';

    // Replace spaces with underscores
    let apiName = label.replace(/\s+/g, '_');

    // Remove special characters (keep only letters, numbers, underscores)
    apiName = apiName.replace(/[^A-Za-z0-9_]/g, '');

    // Ensure it starts with a letter
    if (apiName && !/^[A-Za-z]/.test(apiName)) {
      apiName = 'Debug_' + apiName;
    }

    return apiName;
  }

  // Validate API name
  validateApiName(apiName) {
    const apiNameInput = document.getElementById('debugLevelApiName');
    if (!apiNameInput) return false;

    const isValid = /^[A-Za-z][A-Za-z0-9_]*$/.test(apiName);

    if (!isValid && apiName.length > 0) {
      apiNameInput.setCustomValidity('API Name must start with a letter and contain only letters, numbers, and underscores');
      apiNameInput.classList.add('invalid');
    } else {
      apiNameInput.setCustomValidity('');
      apiNameInput.classList.remove('invalid');
    }

    return isValid;
  }

  // Validate entire form
  validateForm() {
    const label = document.getElementById('debugLevelLabel')?.value?.trim();
    const apiName = document.getElementById('debugLevelApiName')?.value?.trim();

    const errors = [];

    if (!label) {
      errors.push('Label is required');
    }

    if (!apiName) {
      errors.push('API Name is required');
    } else if (!this.validateApiName(apiName)) {
      errors.push('API Name is invalid');
    }

    // Check if all picklists have values
    const missingFields = [];
    Object.entries(this.fieldMappings).forEach(([fieldName, elementId]) => {
      const select = document.getElementById(elementId);
      if (!select || !select.value) {
        missingFields.push(fieldName);
      }
    });

    if (missingFields.length > 0) {
      errors.push('Please select values for all log level fields');
    }

    return { valid: errors.length === 0, errors };
  }

  // Clear validation errors
  clearValidationErrors() {
    const apiNameInput = document.getElementById('debugLevelApiName');
    if (apiNameInput) {
      apiNameInput.setCustomValidity('');
      apiNameInput.classList.remove('invalid');
    }
  }

  // Handle form submission
  async handleSubmit() {
    const submitBtn = document.getElementById('submitCreateDebugLevelBtn');
    const originalText = submitBtn?.textContent;

    // Validate form
    const validation = this.validateForm();
    if (!validation.valid) {
      this.managerUI.showNotification(validation.errors[0], 'error');
      return;
    }

    // Get form values
    const label = document.getElementById('debugLevelLabel').value.trim();
    const apiName = document.getElementById('debugLevelApiName').value.trim();

    const debugLevelData = {
      MasterLabel: label,
      DeveloperName: apiName,
      ApexCode: document.getElementById('apexCodeLevel').value,
      ApexProfiling: document.getElementById('apexProfilingLevel').value,
      Database: document.getElementById('databaseLevel').value,
      System: document.getElementById('systemLevel').value,
      Workflow: document.getElementById('workflowLevel').value,
      Validation: document.getElementById('validationLevel').value,
      Callout: document.getElementById('calloutLevel').value,
      Visualforce: document.getElementById('visualforceLevel').value
    };

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
      }

      // Check for duplicate
      const duplicate = await this.checkDuplicate(apiName);
      if (duplicate) {
        this.managerUI.showNotification(`Debug Level "${apiName}" already exists`, 'error');
        return;
      }

      // Create the debug level
      const response = await this.managerUI.toolingCreate('DebugLevel', debugLevelData);

      if (response && response.id) {
        this.managerUI.showNotification(`Debug Level "${label}" created successfully`, 'success');
        
        // Refresh debug levels list
        await this.managerUI.listDebugLevels();
        this.managerUI.renderDebugLevels();
        
        // Select the newly created debug level
        const select = document.getElementById('debugLevelSelect');
        if (select) {
          select.value = response.id;
        }
        
        // Close form
        this.closeForm();
      }

    } catch (error) {
      console.error('Failed to create debug level:', error);
      
      let message = 'Failed to create debug level.';
      if (error.message.includes('DUPLICATE')) {
        message = `Debug Level "${apiName}" already exists`;
      } else if (error.message.includes('Access token required')) {
        message = 'Please generate an access token first.';
      }
      
      this.managerUI.showNotification(message, 'error');
      
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  // Check if debug level with this API name already exists
  async checkDuplicate(apiName) {
    try {
      const query = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${apiName}' LIMIT 1`;
      const result = await this.managerUI.toolingQuery(query);
      
      return result.records && result.records.length > 0;
    } catch (error) {
      console.error('Failed to check for duplicate:', error);
      // If check fails, let the create operation handle the error
      return false;
    }
  }
}

// Export for use in debug-log-manager-ui.js
window.DebugLevelCreator = DebugLevelCreator;

