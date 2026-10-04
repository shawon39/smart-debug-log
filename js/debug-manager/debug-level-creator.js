// Debug Level Creator
// Handles creation of custom Debug Levels via Tooling API

class DebugLevelCreator {
  constructor(managerUI) {
    this.managerUI = managerUI;
    this.picklistValues = null;
    
    // Field mappings for picklist population
    this.fieldMappings = {
      'ApexCode': 'apexCodeLevel',
      'ApexProfiling': 'apexProfilingLevel',
      'Database': 'databaseLevel',
      'System': 'systemLevel',
      'Workflow': 'workflowLevel',
      'Validation': 'validationLevel',
      'Callout': 'calloutLevel',
      'Visualforce': 'visualforceLevel',
      'DataAccess': 'dataAccessLevel',
      'Nba': 'nbaLevel',
      'Wave': 'waveLevel'
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
      const select = document.getElementById(elementId);
      if (!select) return;

      // A category this org does not offer is hidden and left out of the new debug level
      const available = !!(field && field.picklistValues);
      select.disabled = !available;
      select.closest('.form-field')?.classList.toggle('hidden', !available);
      if (!available) return;

      // Clear loading message
      select.innerHTML = '';

      // Define the desired order (least verbose to most verbose)
      const logLevelOrder = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST', 'INTERNAL'];
      
      // Sort picklist values by the defined order
      const sortedPicklistValues = field.picklistValues
        .filter(pv => pv.active)
        .sort((a, b) => {
          const indexA = logLevelOrder.indexOf(a.value);
          const indexB = logLevelOrder.indexOf(b.value);
          // If value not in order array, put it at the end
          const posA = indexA === -1 ? 999 : indexA;
          const posB = indexB === -1 ? 999 : indexB;
          return posA - posB;
        });

      // Add sorted options
      sortedPicklistValues.forEach(picklistValue => {
        const option = document.createElement('option');
        option.value = picklistValue.value;
        option.textContent = picklistValue.label;
        select.appendChild(option);
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
      'Visualforce': 'INFO',
      'DataAccess': 'INFO',
      'Nba': 'INFO',
      'Wave': 'INFO'
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

    // Spaces and other characters become one underscore; no underscore at the start or end
    let apiName = label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    // Ensure it starts with a letter
    if (apiName && !/^[A-Za-z]/.test(apiName)) {
      apiName = 'Debug_' + apiName;
    }

    // Salesforce allows 40 characters
    return apiName.substring(0, 40).replace(/_+$/, '');
  }

  // Salesforce DeveloperName rules: starts with a letter, only letters, numbers and single
  // underscores, does not end with an underscore, at most 40 characters
  isValidApiName(apiName) {
    return typeof apiName === 'string' && apiName.length <= 40 && /^[A-Za-z](?:_?[A-Za-z0-9])*$/.test(apiName);
  }

  // Validate API name
  validateApiName(apiName) {
    const apiNameInput = document.getElementById('debugLevelApiName');
    if (!apiNameInput) return false;

    const isValid = this.isValidApiName(apiName);

    if (!isValid && apiName.length > 0) {
      apiNameInput.setCustomValidity('API Name must start with a letter, use only letters, numbers and single underscores, and not end with an underscore');
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
      errors.push('API Name must start with a letter, use only letters, numbers and single underscores, and not end with an underscore');
    }

    // Check if all picklists have values (categories this org does not offer are disabled)
    const missingFields = [];
    Object.entries(this.fieldMappings).forEach(([fieldName, elementId]) => {
      const select = document.getElementById(elementId);
      if (!select || (!select.disabled && !select.value)) {
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
      DeveloperName: apiName
    };
    Object.entries(this.fieldMappings).forEach(([fieldName, elementId]) => {
      const select = document.getElementById(elementId);
      if (select && !select.disabled) debugLevelData[fieldName] = select.value;
    });

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
      
      // Show the reason Salesforce gave
      const message = error.message.includes('DUPLICATE')
        ? `Debug Level "${apiName}" already exists`
        : `Failed to create debug level: ${this.managerUI.errorText(error)}`;
      
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

