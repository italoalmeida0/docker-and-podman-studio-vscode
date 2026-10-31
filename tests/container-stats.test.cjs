const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const stats = loadModule('src/shared/containerStats.ts');
const { ContainerStatsMonitor } = loadModule('src/services/containerStatsMonitor.ts');

const podmanTick = [
  {
    id: '25810997cf1b',
    name: 'studio-stats-cpu',
    cpu_time: '6.773235s',
    cpu_percent: '100.01%',
    avg_cpu: '100.01%',
    mem_usage: '1.729MB / 8.197GB',
    mem_percent: '0.02%',
    net_io: '1.988kB / 628B',
    block_io: '1.565MB / 0B',
    pids: '1',
  },
  {
    id: '2e0a0fc2ed0a',
    name: 'studio-stats-mem',
    cpu_time: '1.448849s',
    cpu_percent: '23.38%',
    avg_cpu: '23.38%',
    mem_usage: '831.5kB / 8.197GB',
    mem_percent: '0.01%',
    net_io: '1.376kB / 628B',
    block_io: '0B / 0B',
    pids: '1',
  },
];

const dockerLine = {
  BlockIO: '0B / 0B',
  CPUPerc: '0.00%',
  Container: 'a1b2c3d4e5f6',
  ID: 'a1b2c3d4e5f6',
  MemPerc: '0.12%',
  MemUsage: '9.5MiB / 7.67GiB',
  Name: 'web',
  NetIO: '1.23kB / 648B',
  PIDs: '3',
};

test('size, percent and count parsers accept engine output and reject placeholders', () => {
  assert.equal(stats.parseStatsSize('1.729MB'), 1_729_000);
  assert.equal(stats.parseStatsSize('8.197GB'), 8_197_000_000);
  assert.equal(stats.parseStatsSize('831.5kB'), 831_500);
  assert.equal(stats.parseStatsSize('0B'), 0);
  assert.equal(stats.parseStatsSize('9.5MiB'), 9_961_472);
  assert.equal(stats.parseStatsSize('7.67GiB'), Math.round(7.67 * 1024 ** 3));
  assert.equal(stats.parseStatsSize('--'), null);
  assert.equal(stats.parseStatsSize('12 parsecs'), null);
  assert.equal(stats.parseStatsPercent('100.01%'), 100.01);
  assert.equal(stats.parseStatsPercent('--'), null);
  assert.equal(stats.parseStatsCount('3'), 3);
  assert.equal(stats.parseStatsCount('--'), null);
  assert.deepEqual(stats.parseStatsPair('1.988kB / 628B'), [1988, 628]);
  assert.deepEqual(stats.parseStatsPair('0B / 0B'), [0, 0]);
  assert.deepEqual(stats.parseStatsPair('--'), [null, null]);
});

test('Podman and Docker records normalize to the same shape', () => {
  const podman = stats.normalizePodmanStats(podmanTick[0]);
  assert.deepEqual(podman, {
    id: '25810997cf1b',
    name: 'studio-stats-cpu',
    cpuPercent: 100.01,
    memUsageBytes: 1_729_000,
    memLimitBytes: 8_197_000_000,
    memPercent: 0.02,
    netRxTotal: 1988,
    netTxTotal: 628,
    blockReadTotal: 1_565_000,
    blockWriteTotal: 0,
    pids: 1,
  });
  const docker = stats.normalizeDockerStats(dockerLine);
  assert.equal(docker.id, 'a1b2c3d4e5f6');
  assert.equal(docker.name, 'web');
  assert.equal(docker.cpuPercent, 0);
  assert.equal(docker.memUsageBytes, 9_961_472);
  assert.equal(docker.memLimitBytes, Math.round(7.67 * 1024 ** 3));
  assert.equal(docker.netRxTotal, 1230);
  assert.equal(docker.pids, 3);
  assert.equal(stats.normalizePodmanStats({ name: 'no id' }), null);
  assert.equal(stats.normalizeDockerStats(null), null);
});

test('the JSON array parser reads pretty-printed arrays split at every possible boundary', () => {
  const tricky = 'a]b[c "quoted" \\ slash';
  const text = `${JSON.stringify(podmanTick, null, 1)}\n${JSON.stringify([], null, 1)}\n${JSON.stringify([{ name: tricky, id: 'x{y}' }])}\n`;
  const expected = [podmanTick, [], [{ name: tricky, id: 'x{y}' }]];
  for (let cut = 1; cut < text.length; cut += 7) {
    const parser = stats.createJsonArrayStreamParser();
    const arrays = [...parser.push(text.slice(0, cut)), ...parser.push(text.slice(cut))];
    assert.deepEqual(arrays, expected, `split at ${cut}`);
  }
  const single = stats.createJsonArrayStreamParser();
  const values = [];
  for (const character of text) values.push(...single.push(character));
  assert.deepEqual(values, expected);
});

test('the JSON array parser ignores text between arrays and rejects malformed arrays', () => {
  const parser = stats.createJsonArrayStreamParser();
  assert.deepEqual(parser.push('warning: slow\n'), []);
  assert.deepEqual(parser.push('[{"id":"a"}]'), [[{ id: 'a' }]]);
  assert.throws(() => parser.push('[{"id":]}'), /could not be read/);
  assert.deepEqual(stats.createJsonArrayStreamParser().push('[1, 2'), [], 'an unfinished array waits for more output');
});

test('the JSON line parser joins lines split across chunks', () => {
  const parser = stats.createJsonLineParser();
  const first = parser.push(`${JSON.stringify(dockerLine)}\n{"ID":"b`);
  const second = parser.push('b", "Name": "api"}\r\n');
  assert.equal(first.length, 1);
  assert.deepEqual(second, [{ ID: 'bb', Name: 'api' }]);
  assert.deepEqual(parser.push('WARNING: the engine is busy\n\n'), [], 'text without an object is ignored');
  assert.throws(() => parser.push('{"ID": }\n'), /statistics line/, 'a broken object is still rejected');
});

test('docker frames with terminal control codes parse into the same objects', () => {
  const frame = (value) => `\u001b[H${JSON.stringify(value)}\u001b[K\n`;
  const parser = stats.createJsonLineParser();
  const first = parser.push(`${frame(dockerLine)}${frame({ ...dockerLine, ID: 'bbbbbbbbbbbb', Name: 'api' })}\u001b[J`);
  assert.deepEqual(first.map((item) => item.ID), ['a1b2c3d4e5f6', 'bbbbbbbbbbbb']);
  assert.deepEqual(parser.push('\u001b['), [], 'an escape sequence split across chunks waits for its end');
  const next = parser.push(`H${JSON.stringify(dockerLine)}\u001b[K\n`);
  assert.equal(next.length, 1);
  assert.equal(next[0].Name, 'web');
  assert.equal(stats.stripTerminalControl('\u001b[2J\u001b[?25lready\u001b[K'), 'ready');
});

test('rates come from consecutive cumulative counters and ignore restarts and gaps', () => {
  const tracker = new stats.ContainerRateTracker(15_000);
  const raw = (rx, tx, read, write) => ({
    id: 'c1', name: 'api', cpuPercent: 10, memUsageBytes: 1, memLimitBytes: 2, memPercent: 0.1,
    netRxTotal: rx, netTxTotal: tx, blockReadTotal: read, blockWriteTotal: write, pids: 2,
  });
  const first = tracker.observe([raw(1000, 500, 0, 0)], 0);
  assert.equal(first[0].netRxRate, null, 'the first sample has no baseline');
  const second = tracker.observe([raw(3000, 900, 4000, 0)], 1000);
  assert.equal(second[0].netRxRate, 2000);
  assert.equal(second[0].netTxRate, 400);
  assert.equal(second[0].blockReadRate, 4000);
  assert.equal(second[0].blockWriteRate, 0);
  const rounded = tracker.observe([raw(2990, 900, 4000, 0)], 2000);
  assert.equal(rounded[0].netRxRate, 0, 'a tiny decrease from display rounding is not a restart');
  const restarted = tracker.observe([raw(12, 0, 0, 0)], 3000);
  assert.equal(restarted[0].netRxRate, null, 'a large drop means the container restarted');
  const gap = tracker.observe([raw(20_000, 0, 0, 0)], 3000 + 60_000);
  assert.equal(gap[0].netRxRate, null, 'samples too far apart are not turned into rates');
  tracker.reset();
  assert.equal(tracker.observe([raw(1, 1, 1, 1)], 70_000)[0].netRxRate, null);
});

test('failures are classified without treating a missing container as an engine outage', () => {
  assert.equal(stats.classifyStatsFailure('Error: unable to connect to Podman. connection refused'), 'engineUnavailable');
  assert.equal(stats.classifyStatsFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'), 'engineUnavailable');
  assert.equal(stats.classifyStatsFailure('podman machine "podman-machine-default" is not running'), 'engineUnavailable');
  assert.equal(stats.classifyStatsFailure('Access is denied.'), 'permissionDenied');
  assert.equal(stats.classifyStatsFailure('something unexpected'), 'unknown');
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
  }

  kill() {
    this.killed = true;
  }

  exit(code, stderr = '') {
    // Emit synchronously so the monitor has read stderr before it handles the close event.
    if (stderr) this.stderr.emit('data', stderr);
    this.exitCode = code;
    this.emit('close', code);
  }
}

function createClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    schedule(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: current + delayMs, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        current = due[1].at;
        due[1].callback();
      }
      current = end;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function createMonitor(overrides = {}) {
  const clock = createClock();
  const children = [];
  const statuses = [];
  const samples = [];
  const monitor = new ContainerStatsMonitor({
    spawnStream: (engine) => {
      const child = new FakeChild();
      child.engine = engine;
      children.push(child);
      return child;
    },
    onSamples: (engine, at, batch) => samples.push({ engine, at, batch }),
    onStatus: (status) => statuses.push(status),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...overrides,
  });
  return { monitor, clock, children, statuses, samples };
}

test('a Podman stream connects, reports live samples and stops when inactive', async () => {
  const { monitor, children, statuses, samples, clock } = createMonitor();
  monitor.setActive('podman');
  monitor.setActive('podman');
  assert.equal(children.length, 1, 'the same engine keeps one stream');
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'connecting' });

  children[0].stdout.write(JSON.stringify(podmanTick, null, 1));
  children[0].stdout.write('\n');
  await settle();
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'live' });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].engine, 'podman');
  assert.equal(samples[0].batch[0].id, '25810997cf1b');
  assert.equal(samples[0].batch[0].cpuPercent, 100.01);
  assert.equal(samples[0].batch[0].netRxRate, null, 'the first sample has no rate yet');

  clock.advance(1000);
  children[0].stdout.write(JSON.stringify([{ ...podmanTick[0], net_io: '3.988kB / 2.628kB' }]));
  await settle();
  assert.equal(samples[1].batch[0].netRxRate, 2000);
  assert.equal(samples[1].batch[0].netTxRate, 2000);

  monitor.setActive(null);
  assert.equal(children[0].killed, true);
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'idle' });
});

test('switching engines replaces the stream and ignores late output from the old one', async () => {
  const { monitor, children, statuses, samples } = createMonitor();
  monitor.setActive('podman');
  monitor.setActive('docker');
  assert.equal(children.length, 2);
  assert.equal(children[0].killed, true);
  children[0].stdout.write(JSON.stringify(podmanTick));
  children[0].exit(1, 'unable to connect to Podman');
  await settle();
  assert.equal(samples.length, 0, 'output from the replaced stream is dropped');
  assert.equal(statuses.some((status) => status.state === 'retrying'), false, 'the replaced stream does not schedule retries');

  children[1].stdout.write(`${JSON.stringify(dockerLine)}\n`);
  await settle();
  assert.equal(samples[0].engine, 'docker');
  assert.equal(samples[0].batch[0].id, 'a1b2c3d4e5f6');
  assert.equal(samples[0].batch[0].pids, 3);
});

test('an empty Docker chunk does not claim that a sampling tick happened', async () => {
  const { monitor, children, samples } = createMonitor();
  monitor.setActive('docker');
  children[0].stdout.write('');
  children[0].stdout.write(JSON.stringify(dockerLine).slice(0, 20));
  await settle();
  assert.equal(samples.length, 0);
});

test('a silent stream is reported as stalled, then recovers when samples resume', async () => {
  const { monitor, children, statuses, clock, samples } = createMonitor({ stallAfterMs: 6_000, restartAfterMs: 20_000 });
  monitor.setActive('podman');
  clock.advance(7_000);
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'stalled' });
  children[0].stdout.write(JSON.stringify(podmanTick));
  await settle();
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'live' });
  assert.equal(samples.length, 1);
  assert.equal(children[0].killed, false);
});

test('a stream that stays silent is restarted with a no-data reason', () => {
  const { monitor, children, statuses, clock } = createMonitor({ stallAfterMs: 6_000, restartAfterMs: 20_000, initialRetryMs: 2_000 });
  monitor.setActive('podman');
  clock.advance(21_000);
  assert.equal(children[0].killed, true);
  const retry = statuses.at(-1);
  assert.equal(retry.state, 'retrying');
  assert.equal(retry.code, 'noData');
  assert.equal(retry.retryInMs, 2_000);
  clock.advance(2_000);
  assert.equal(children.length, 2, 'the stream starts again after the delay');
});

test('repeated failures back off exponentially and a successful sample resets the delay', async () => {
  const { monitor, children, statuses, clock } = createMonitor({ initialRetryMs: 2_000, maxRetryMs: 8_000 });
  monitor.setActive('podman');
  children[0].exit(1, 'Error: unable to connect to Podman: connection refused');
  assert.deepEqual(
    { state: statuses.at(-1).state, code: statuses.at(-1).code, retryInMs: statuses.at(-1).retryInMs },
    { state: 'retrying', code: 'engineUnavailable', retryInMs: 2_000 }
  );
  clock.advance(2_000);
  children[1].exit(1, 'connection refused');
  assert.equal(statuses.at(-1).retryInMs, 4_000);
  clock.advance(4_000);
  children[2].exit(1, 'connection refused');
  assert.equal(statuses.at(-1).retryInMs, 8_000);
  clock.advance(8_000);
  children[3].stdout.write(JSON.stringify(podmanTick));
  await settle();
  children[3].exit(1, 'connection refused');
  assert.equal(statuses.at(-1).retryInMs, 2_000, 'a live sample resets the backoff');
});

test('a missing executable is reported once and is not retried automatically', () => {
  const { monitor, children, statuses, clock } = createMonitor();
  monitor.setActive('podman');
  const error = Object.assign(new Error('spawn podman ENOENT'), { code: 'ENOENT' });
  children[0].emit('error', error);
  assert.deepEqual(statuses.at(-1), {
    engine: 'podman',
    state: 'unavailable',
    code: 'executableMissing',
    detail: 'spawn podman ENOENT',
  });
  clock.advance(120_000);
  assert.equal(children.length, 1);
});

test('malformed output restarts the stream instead of publishing guessed values', async () => {
  const { monitor, children, statuses, samples } = createMonitor();
  monitor.setActive('podman');
  children[0].stdout.write('[{"id": "a", "cpu_percent": }]');
  await settle();
  assert.equal(children[0].killed, true);
  assert.equal(statuses.at(-1).state, 'retrying');
  assert.equal(statuses.at(-1).code, 'unexpectedOutput');
  assert.equal(samples.length, 0);
});

test('a clean Podman stream end is retried as missing data', () => {
  const { monitor, children, statuses } = createMonitor();
  monitor.setActive('podman');
  children[0].exit(0);
  assert.equal(statuses.at(-1).state, 'retrying');
  assert.equal(statuses.at(-1).code, 'noData');
  assert.equal(children.length, 1, 'the retry waits for the delay');
});

test('docker frames with terminal control codes produce live samples without a retry', async () => {
  const { monitor, children, statuses, samples } = createMonitor({ dockerPublishIntervalMs: 0 });
  monitor.setActive('docker');
  children[0].stdout.write(`\u001b[H${JSON.stringify(dockerLine)}\u001b[K\n\u001b[J`);
  await settle();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].engine, 'docker');
  assert.equal(samples[0].batch[0].id, 'a1b2c3d4e5f6');
  assert.equal(statuses.at(-1).state, 'live');
  assert.equal(statuses.some((status) => status.state === 'retrying'), false);
});

test('docker frames are published at most once per interval with the latest reading', async () => {
  const { monitor, children, samples, clock } = createMonitor();
  monitor.setActive('docker');
  const frame = (cpu) => `\u001b[H${JSON.stringify({ ...dockerLine, CPUPerc: cpu })}\u001b[K\n\u001b[J`;
  children[0].stdout.write(frame('1.00%'));
  await settle();
  clock.advance(500);
  children[0].stdout.write(frame('2.00%'));
  await settle();
  clock.advance(500);
  children[0].stdout.write(frame('3.00%'));
  await settle();
  assert.equal(samples.length, 2, 'the frame half a second later is held back');
  assert.equal(samples[1].batch[0].cpuPercent, 3);
});

test('a docker stream that exits cleanly reconnects quietly while no containers run', () => {
  const { monitor, children, statuses, clock } = createMonitor();
  monitor.setActive('docker');
  const statusCount = statuses.length;
  children[0].exit(0);
  assert.equal(statuses.length, statusCount, 'no retry status is shown');
  clock.advance(2_999);
  assert.equal(children.length, 1, 'the next stream waits for the idle delay');
  clock.advance(1);
  assert.equal(children.length, 2, 'the next stream starts after the idle delay');
  assert.equal(statuses.some((status) => status.state === 'retrying'), false);
});

test('disposing the monitor stops the stream and cancels pending retries', () => {
  const { monitor, children, statuses, clock } = createMonitor();
  monitor.setActive('podman');
  children[0].exit(1, 'connection refused');
  monitor.dispose();
  clock.advance(60_000);
  assert.equal(children.length, 1, 'no retry starts after dispose');
  assert.deepEqual(statuses.at(-1), { engine: 'podman', state: 'idle' });
});
