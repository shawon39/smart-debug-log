// Puts the mock dashboard into the state a screenshot needs, then sets
// document.documentElement.dataset.sceneReady = "1".
//   ?log=<ApexLog Id>             open a log (also behind the dialogs)
//   ?scene=trace                  Manage Debug Logs dialog
//   ?scene=apex                   Execute Anonymous Apex dialog with a snippet and a result
//   ?theme=dark                   (read by chrome-shim.js)
(function () {
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene');

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = check();
      if (value) return value;
      await sleep(50);
    }
    throw new Error('Scene timed out');
  }

  async function run() {
    if (location.pathname.endsWith('/popup.html')) {
      await waitFor(() => document.getElementById('statusCard')?.style.display !== 'none' && document.getElementById('loggingCountdown')?.textContent);
    } else {
      await waitFor(() => document.querySelector('.log-item'));
    }

    if (params.get('log')) {
      const item = await waitFor(() => document.querySelector(`.log-item[data-log-id="${params.get('log')}"]`));
      item.click();
      await waitFor(() => document.querySelector('#debugContent')?.textContent.trim());
      const scroll = Number(params.get('scroll')) || 0;
      if (scroll) document.querySelector('#debugContentPanel')?.scrollBy(0, scroll);
    }

    if (scene === 'trace') {
      document.getElementById('debugLogManagerBtn').click();
      await waitFor(() => document.querySelectorAll('#debugLogManagerModal .traceflag-item, #debugLogManagerModal [data-traceflag-id]').length
        || document.querySelector('#debugLogManagerModal')?.textContent.includes('Integration User'));
      const select = document.getElementById('debugLevelSelect');
      const option = [...select.options].find(o => /DevConsole/.test(o.textContent));
      if (option) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    if (scene === 'apex') {
      document.getElementById('openApexManagerBtn').click();
      const first = await waitFor(() => document.querySelector('#apexCodeList .apex-code-item'));
      first.click();
      await waitFor(() => document.getElementById('apexCodeEditor')?.value);
      window.apexExecutor.displayExecutionResult({ success: true, compiled: true, line: -1, column: -1 });
      const editor = document.getElementById('apexCodeEditor');
      editor.setSelectionRange(0, 0);
      editor.scrollTop = 0;
      editor.dispatchEvent(new Event('scroll'));
    }

    // No focus rings or carets in the pictures
    document.activeElement?.blur?.();
    await sleep(400);
    document.documentElement.dataset.sceneReady = '1';
  }

  window.addEventListener('load', () => {
    run().catch(error => {
      console.error('[scene]', error);
      document.documentElement.dataset.sceneReady = 'error';
    });
  });
})();
