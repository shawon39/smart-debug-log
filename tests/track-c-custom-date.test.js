'use strict';
// L1: the custom date/time form must default to the user's local date and time.
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody } = require('./track-c-dom');

const MANAGER_FILES = ['js/icons.js', 'js/basic-utilities.js', 'js/debug-level-creator.js', 'js/debug-log-manager-ui.js',
  'js/debug-log-ui-api.js', 'js/debug-log-ui-traceflags.js', 'js/debug-log-ui-rendering.js'];

function withTimeZone(tz, fn) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

const cases = [
  // 03:00 in Dhaka (UTC+6): UTC is still the day before
  { tz: 'Asia/Dhaka', now: Date.UTC(2026, 9, 3, 21, 0), start: ['2026-10-04', '03:00'], end: ['2026-10-04', '03:30'] },
  // 18:00 in Los Angeles (UTC-7): UTC is already the next day
  { tz: 'America/Los_Angeles', now: Date.UTC(2026, 9, 4, 1, 0), start: ['2026-10-03', '18:00'], end: ['2026-10-03', '18:30'] },
  // 23:45 in Los Angeles: the end time is on the next local day
  { tz: 'America/Los_Angeles', now: Date.UTC(2026, 9, 4, 6, 45), start: ['2026-10-03', '23:45'], end: ['2026-10-04', '00:15'] }
];

for (const { tz, now, start, end } of cases) {
  test(`L1: custom start/end default to local date and time (${tz}, ${start.join(' ')})`, () => withTimeZone(tz, () => {
    const env = loadScripts(MANAGER_FILES, { html: dashboardBody(), now });
    const ui = env.ctx.debugLogManagerUI;
    const field = id => env.document.getElementById(id);

    ui.initializeCustomDateTime();

    assert.deepStrictEqual([field('customStartDate').value, field('customStartTime').value], start);
    assert.deepStrictEqual([field('customEndDate').value, field('customEndTime').value], end);
    assert.strictEqual(field('customStartDate').min, start[0]);
    assert.strictEqual(field('customEndDate').min, start[0]);

    // The prefilled range is now..now+30min (it used to be 24 hours off, or rejected as past)
    const range = ui.getCustomDateTimeRange();
    assert.strictEqual(range.startDate.getTime(), now);
    assert.strictEqual(range.endDate.getTime(), now + 30 * 60 * 1000);
  }));
}
