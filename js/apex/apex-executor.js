// Apex Code Executor
// Handles execution of Apex code and result display

class ApexExecutor {
  constructor() {
    this.isExecuting = false;
  }

  async executeApexCode(code) {
    if (this.isExecuting) {
      throw new Error('Another execution is in progress');
    }
    
    if (!code || !code.trim()) {
      throw new Error('No Apex code provided');
    }

    this.isExecuting = true;
    this.showExecutionProgress();

    try {
      // Trim only the end: removing leading blank lines would shift the line numbers in errors.
      const result = await window.apexCodeManager.executeApexCode(code.trimEnd());
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
      runBtn.innerHTML = `${Icons.svg('loader')}Running...`;
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
      runBtn.innerHTML = `${Icons.svg('play')}Execute`;
    }
  }

  displayExecutionResult(result) {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;

    let content = '';
    // Salesforce sends line/column -1 when there is no position.
    const line = result.line > 0 ? result.line : null;
    const column = result.column > 0 ? result.column : null;
    
    if (result.success) {
      content = `
        <div class="execution-success">
          <div class="result-header success">
            <div class="result-icon">${Icons.svg('circleCheck', 18)}</div>
            <div class="result-title">Execution Successful</div>
          </div>
          <div class="result-details">
            <div class="result-section">
              <div class="result-value success">Compiled and ran without errors</div>
            </div>
          </div>
        </div>
      `;
    } else if (!result.compiled) {
      const position = line ? ` at line ${line}${column ? `, column ${column}` : ''}` : '';
      content = `
        <div class="execution-error">
          <div class="result-header error">
            <div class="result-icon">${Icons.svg('circleX', 18)}</div>
            <div class="result-title">Compile error${position}</div>
          </div>
          <div class="result-details">
            <div class="result-section">
              <h4>Problem</h4>
              <div class="result-value error">${this.escapeHtml(result.compileProblem || 'Unknown compile error')}</div>
            </div>
          </div>
        </div>
      `;
    } else {
      content = `
        <div class="execution-error">
          <div class="result-header error">
            <div class="result-icon">${Icons.svg('circleX', 18)}</div>
            <div class="result-title">Runtime exception</div>
          </div>
          <div class="result-details">
            <div class="result-section">
              <h4>Exception</h4>
              <div class="result-value error">${this.escapeHtml(result.exceptionMessage || 'Unknown error')}</div>
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
    if (!result.success && !result.compiled && line) window.apexCodeManager?.highlightEditorLine(line);
  }

  displayExecutionError(error) {
    const resultsContent = document.getElementById('resultsContent');
    if (!resultsContent) return;

    resultsContent.innerHTML = `
      <div class="execution-error">
        <div class="result-header error">
          <div class="result-icon">${Icons.svg('circleX', 18)}</div>
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
    // Delegate to the shared escapeHtml() in basic-utilities.js (single source of truth)
    return window.escapeHtml(text);
  }
}

// Global instance
window.apexExecutor = new ApexExecutor();
