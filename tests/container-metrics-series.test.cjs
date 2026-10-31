const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const series = loadModule('webview-ui/src/statsSeries.ts');
const { useContainerMetrics } = loadModule('webview-ui/src/statsStore.ts');

function sample(overrides = {}) {
  return {
    id: 'abc123def456',
    name: 'api',
    cpuPercent: 12.5,
    memUsageBytes: 50_000_000,
    memLimitBytes: 8_000_000_000,
    memPercent: 0.6,
    netRxRate: 1000,
    netTxRate: 500,
    blockReadRate: 0,
    blockWriteRate: 2000,
    pids: 4,
    ...overrides,
  };
}

test('a series keeps only the retained window of points and ignores unknown values as zero', () => {
  let target;
  for (let index = 0; index < series.METRIC_RETENTION_POINTS + 100; index += 1) {
    target = series.appendContainerSample(target, sample({ cpuPercent: index % 7 === 0 ? null : index }), index * 1000);
  }
  assert.equal(target.t.length, series.METRIC_RETENTION_POINTS);
  assert.equal(target.t[0], 100_000, 'the oldest points are discarded first');
  assert.equal(target.cpu.length, target.t.length);
  assert.equal(target.cpu.at(-1), series.METRIC_RETENTION_POINTS + 99);
  assert.equal(target.latest.cpuPercent, series.METRIC_RETENTION_POINTS + 99);
});

test('totals sum only the containers that reported a value at that tick', () => {
  const totals = series.emptyTotals();
  series.appendTotals(totals, [sample({ netRxRate: 1000 }), sample({ id: 'other', netRxRate: null, cpuPercent: 3 })], 1000);
  series.appendTotals(totals, [sample({ netRxRate: null, cpuPercent: null })], 2000);
  assert.equal(totals.cpu[0], 15.5);
  assert.equal(totals.rx[0], 1000, 'a missing rate is not counted as zero');
  assert.equal(totals.cpu[1], null, 'a tick with no known CPU value stays unknown');
  assert.equal(totals.rx[1], null);
  assert.deepEqual(totals.t, [1000, 2000]);
});

test('window slicing and summaries respect the requested start and unknown gaps', () => {
  const times = [1000, 2000, 3000, 4000, 5000];
  assert.equal(series.firstIndexAtOrAfter(times, 0), 0);
  assert.equal(series.firstIndexAtOrAfter(times, 3000), 2);
  assert.equal(series.firstIndexAtOrAfter(times, 3500), 3);
  assert.equal(series.firstIndexAtOrAfter(times, 9000), 5);
  assert.deepEqual(series.windowSlice(times, ['a', 'b', 'c', 'd', 'e'], 4000), ['d', 'e']);
  assert.deepEqual(series.summarizeValues([null, 2, 4, null]), { current: 4, average: 3, peak: 4 });
  assert.deepEqual(series.summarizeValues([]), { current: null, average: null, peak: null });
});

test('byte, rate, percentage and count formatting follow the engine conventions', () => {
  assert.equal(series.formatBytes(0), '0 B');
  assert.equal(series.formatBytes(831_500), '832 kB');
  assert.equal(series.formatBytes(1_729_000), '1.73 MB');
  assert.equal(series.formatBytes(8_197_000_000), '8.20 GB');
  assert.equal(series.formatBytes(null), '—');
  assert.equal(series.formatRate(2000), '2.00 kB/s');
  assert.equal(series.formatRate(undefined), '—');
  assert.equal(series.formatPercent(100.01), '100%');
  assert.equal(series.formatPercent(5.25), '5.3%');
  assert.equal(series.formatPercent(null), '—');
  assert.equal(series.formatCount(3), '3');
  assert.equal(series.formatCount(NaN), '—');
  assert.ok(series.formatClock(Date.UTC(2026, 9, 30, 12, 0, 0)).length > 0);
});

test('sparklines start at the minimum scale and break at unknown values', () => {
  assert.deepEqual(series.sparklinePaths([], 240, 40), { line: '', area: '' });
  assert.deepEqual(series.sparklinePaths([null, null], 240, 40), { line: '', area: '' });

  const rising = series.sparklinePaths([0, 50, 100], 240, 40, 100);
  assert.match(rising.line, /^M0\.00 40\.00 L120\.00 20\.00 L240\.00 0\.00$/);
  assert.match(rising.area, / Z$/);

  const gapped = series.sparklinePaths([1, null, 2], 240, 40, 1);
  assert.equal((gapped.line.match(/M/g) || []).length, 2, 'an unknown value starts a new segment');
  assert.equal(gapped.area, '', 'single points do not create an area');

  const quiet = series.sparklinePaths([1, 2], 240, 40, 100);
  assert.equal(quiet.line, 'M0.00 39.60 L240.00 39.20', 'a quiet series stays near the baseline instead of filling the height');
});

test('the metrics store isolates engines, ignores malformed samples and reports status', () => {
  const store = useContainerMetrics;
  store.getState().reset(null);
  store.getState().applySamples('podman', 1000, [sample(), sample({ id: '' }), null]);
  assert.equal(store.getState().engine, 'podman');
  assert.deepEqual(Object.keys(store.getState().series), ['abc123def456']);
  assert.equal(store.getState().lastSampleAt, 1000);

  store.getState().applySamples('docker', 2000, [sample({ id: 'd1' })]);
  assert.equal(store.getState().engine, 'docker', 'a new engine replaces the previous one');
  assert.deepEqual(Object.keys(store.getState().series), ['d1'], 'podman history is not mixed into docker');

  store.getState().applySamples('docker', Number.NaN, [sample({ id: 'd2' })]);
  assert.deepEqual(Object.keys(store.getState().series), ['d1'], 'a sample without a valid time is ignored');

  store.getState().applyStatus('docker', { state: 'retrying', code: 'engineUnavailable', retryInMs: 4000, detail: 'connection refused' });
  assert.deepEqual(store.getState().connection, {
    state: 'retrying',
    code: 'engineUnavailable',
    retryInMs: 4000,
    detail: 'connection refused',
  });

  store.getState().applyStatus('docker', { state: 'live' });
  assert.deepEqual(store.getState().connection, { state: 'live' });

  store.getState().applyStatus('podman', { state: 'unavailable', code: 'executableMissing' });
  assert.equal(store.getState().engine, 'podman');
  assert.deepEqual(store.getState().connection, { state: 'unavailable', code: 'executableMissing', detail: undefined });
  assert.deepEqual(store.getState().series, {}, 'switching engines clears the previous history');

  store.getState().applyStatus('podman', { state: 'bogus' });
  assert.deepEqual(store.getState().connection, { state: 'idle' });
});

test('stale containers are dropped after twenty minutes without samples', () => {
  const store = useContainerMetrics;
  store.getState().reset(null);
  store.getState().applySamples('podman', 0, [sample({ id: 'old' })]);
  store.getState().applySamples('podman', 25 * 60_000, [sample({ id: 'fresh' })]);
  assert.deepEqual(Object.keys(store.getState().series), ['fresh']);
});
