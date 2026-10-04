// Test helper (classic script, loaded into the vm by track-c-execute.test.js): stand-ins for the
// log list globals of log-display.js / log-loader.js / dashboard-monitoring.js used by dashboard-init.js.
let debugLogs = [];
const __logState = { serverLogs: [], pending: [], selected: null, loads: 0, cleared: 0 };

async function loadDebugLogs() {
  __logState.loads++;
  __logState.pending = __logState.pending.filter(p => {
    if (p.afterLoads >= __logState.loads) return true;
    __logState.serverLogs.push(p.log);
    return false;
  });
  const filter = document.getElementById('logTypeFilter').value;
  debugLogs = __logState.serverLogs.filter(log => log.Location === filter);
}

function selectDebugLog(logId) { __logState.selected = logId; }

async function savePreferences() {}

const logLoader = { clearCache() { __logState.cleared++; } };
