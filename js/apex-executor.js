// Apex Code Executor
// Handles execution of Apex code and result display

class ApexExecutor {
  constructor() {
    this.isExecuting = false;
  }

  async executeApexCode(code, session) {
    if (this.isExecuting) {
      throw new Error('Another execution is in progress');
    }
    
    if (!code || !code.trim()) {
      throw new Error('No Apex code provided');
    }
    
    if (!session) {
      throw new Error('No session available');
    }

    this.isExecuting = true;
    this.showExecutionProgress();

    try {
      const result = await window.apexCodeManager.executeApexCode(code.trim(), session);
      this.displayExecutionResult(result);
      return result;
    } catch (error) {
      this.displayExecutionError(error);
      throw error;
    } finally {
      this.isExecuting = false;
      this.hideExecutionProgress();
    }
  }

  showExecutionProgress() {
    const runBtn = document.getElementById('runApexBtn');
    const resultsContent = document.getElementById('resultsContent');
    
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerHTML = 'Running...';
    }
    
    if (resultsContent) {
      resultsContent.innerHTML = `
        <div class="execution-progress">
          <div class="spinner"></div>
          <span>Executing Apex code...</span>
        </div>
      `;
    }
  }

  hideExecutionProgress() {
    const runBtn = document.getElementById('runApexBtn');
    
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.innerHTML = 'Execute';
    }
  }

  displayExecutionResult(result) {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;

    let content = '';
    
    if (result.success) {
      const compileProblemEsc = result.compileProblem ? this.escapeHtml(result.compileProblem) : '';
      const exceptionMessageEsc = result.exceptionMessage ? this.escapeHtml(result.exceptionMessage) : '';
      const stackEsc = result.exceptionStackTrace ? this.escapeHtml(result.exceptionStackTrace) : '';
      content = `
        <div class="execution-success">
          <div class="result-header success">
            <div class="result-icon">✅</div>
            <div class="result-title">Execution Successful</div>
          </div>
          <div class="result-details">
            <div class="result-section">
              <h4>Compilation Status</h4>
              <div class="result-value ${result.compiled ? 'success' : 'error'}">
                ${result.compiled ? 'Compiled Successfully' : 'Compilation Failed'}
              </div>
            </div>
            ${compileProblemEsc ? `
              <div class="result-section">
                <h4>Compilation Problem</h4>
                <div class="result-value error">${compileProblemEsc}</div>
              </div>
            ` : ''}
            ${exceptionMessageEsc ? `
              <div class="result-section">
                <h4>Exception Message</h4>
                <div class="result-value error">${exceptionMessageEsc}</div>
              </div>
            ` : ''}
            ${stackEsc ? `
              <div class="result-section">
                <h4>Stack Trace</h4>
                <div class="result-value error stack-trace">${stackEsc}</div>
              </div>
            ` : ''}
            <div class="result-section">
              <h4>Line/Column</h4>
              <div class="result-value">
                Line: ${result.line || 'N/A'}, Column: ${result.column || 'N/A'}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const errorDetailsEsc = this.escapeHtml(result.compileProblem || result.exceptionMessage || 'Unknown error');
      content = `
        <div class="execution-error">
          <div class="result-header error">
            <div class="result-icon">❌</div>
            <div class="result-title">Execution Failed</div>
          </div>
          <div class="result-details">
            <div class="result-section">
              <h4>Error Details</h4>
              <div class="result-value error">${errorDetailsEsc}</div>
            </div>
            ${result.exceptionStackTrace ? `
              <div class="result-section">
                <h4>Stack Trace</h4>
                <div class="result-value error stack-trace">${this.escapeHtml(result.exceptionStackTrace)}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    resultsContent.innerHTML = content;
  }

  displayExecutionError(error) {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;

    resultsContent.innerHTML = `
      <div class="execution-error">
        <div class="result-header error">
          <div class="result-icon">❌</div>
          <div class="result-title">Execution Error</div>
        </div>
        <div class="result-details">
          <div class="result-section">
            <h4>Error Message</h4>
            <div class="result-value error">${this.escapeHtml(error.message)}</div>
          </div>
        </div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  clearResults() {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;

    resultsContent.innerHTML = `
      <div class="welcome-state">
        <div class="welcome-icon">⚡</div>
        <h4>Ready to Execute</h4>
        <p>Select Apex code and click Run to see results</p>
      </div>
    `;
  }
}

// Global instance
window.apexExecutor = new ApexExecutor();
