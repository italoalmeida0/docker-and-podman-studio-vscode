const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { config, loadModule, loadService } = require('./podman-harness.cjs');

const PodmanService = loadService();
const { OperationProgress } = loadModule(path.join('src', 'services', 'operationProgress.ts'));
const { appendOutputTail, classifyFailure, MAX_OPERATION_OUTPUT } =
  loadModule(path.join('src', 'shared', 'operationFeedback.ts'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, message, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  assert.fail(message);
}

test('failure summaries distinguish common problems without exposing the full log', () => {
  const cases = [
    ['execution timed out (300s)', undefined, 'timeout'],
    ['spawn podman ENOENT', 'ENOENT', 'missingExecutable'],
    ['no space left on device', undefined, 'diskSpace'],
    ['bind: address already in use', undefined, 'portInUse'],
    ['Registry HTTP 401', undefined, 'registryAuth'],
    ['permission denied', undefined, 'permission'],
    ['manifest unknown', undefined, 'imageNotFound'],
    ['unable to connect to Podman', undefined, 'engineConnection'],
    ['Registry request timed out after 20 seconds.', undefined, 'network'],
    ['unexpected provider response', undefined, 'generic'],
  ];
  for (const [message, code, expected] of cases) {
    assert.equal(classifyFailure(message, code), expected, message);
  }
  const { summarizeFailure } = loadModule(path.join('src', 'ui', 'messageUtil.ts'));
  const summary = summarizeFailure('first log line\nno space left on device\nprivate details', undefined, 'Build');
  assert.match(summary, /disk space/i);
  assert.doesNotMatch(summary, /private details/);
  const partial = summarizeFailure('provider details', 'ETIMEDOUT', 'Remove containers', {
    completed: 1, total: 3,
  });
  assert.match(partial, /1 of 3 items succeeded/i);
  assert.match(partial, /may still be running/i);
  assert.doesNotMatch(partial, /provider details/);
});

test('progress snapshots flush pending output once and retain bounded tails', async () => {
  const sent = [];
  const written = [];
  const progress = new OperationProgress(
    (command, payload) => sent.push({ command, payload }),
    (text) => written.push(text)
  );
  const first = progress.start('build', 'Build one');
  const second = progress.start('pulling', 'Download two');
  progress.report(first, { type: 'output', text: '\u001b[31mfirst\u001b[0m\r\n' });
  progress.report(second, { type: 'output', text: 'second\n' });
  progress.report(first, { type: 'step', completed: 1, total: 3, current: 'item' });
  const large = 'x'.repeat(MAX_OPERATION_OUTPUT + 100) + 'TAIL';
  progress.report(first, { type: 'output', text: large });

  const snapshot = progress.snapshot();
  const one = snapshot.find((item) => item.id === first);
  const two = snapshot.find((item) => item.id === second);
  assert.equal(one.output.length, MAX_OPERATION_OUTPUT);
  assert.equal(one.outputTruncated, true);
  assert.ok(one.output.endsWith('TAIL'));
  assert.deepEqual([one.completed, one.total, one.current], [1, 3, 'item']);
  assert.equal(two.output, 'second\n');
  assert.ok(written.join('').includes('first\n'));
  assert.ok(written.join('').includes(large));
  assert.equal(written.filter((text) => text.includes(`#${first} Build one`)).length, 2);
  assert.doesNotMatch(written.join(''), /\u001b/);
  const flushed = sent.filter((event) => event.command === 'operation:output');
  assert.deepEqual(flushed.map((event) => event.payload.id), [first, second]);
  assert.equal(flushed[0].payload.outputTruncated, true);
  await sleep(200);
  assert.equal(sent.filter((event) => event.command === 'operation:output').length, 2);

  progress.end(first);
  progress.end(second);
  progress.report(first, { type: 'output', text: 'ignored' });
  assert.deepEqual(progress.snapshot(), []);
  assert.equal(sent.filter((event) => event.command === 'operation:end').length, 2);
  assert.deepEqual(appendOutputTail('abc', 'def', 4), { text: 'cdef', truncated: true });
});

test('command output arrives before completion and preserves split UTF-8 bytes', async () => {
  const service = new PodmanService();
  const events = [];
  let finished = false;
  const script = [
    "process.stdout.write('begin\\n')",
    'process.stdout.write(Buffer.from([0xe2, 0x82]))',
    "setTimeout(() => process.stdout.write(Buffer.from([0xac])), 100)",
    "setTimeout(() => process.stderr.write('end\\n'), 350)",
    'setTimeout(() => process.exit(0), 650)',
  ].join(';');
  const running = service.withCommandProgress((event) => events.push(event), () =>
    service.spawnProcess(process.execPath, ['-e', script], {
      timeoutMs: 10_000, engine: 'podman', reportProgress: true,
    })
  ).then((result) => { finished = true; return result; });

  await waitFor(() => events.some((event) => event.text?.includes('begin')), 'No live output received');
  assert.equal(finished, false);
  const result = await running;
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'begin\n€');
  assert.equal(result.stderr, 'end\n');
  assert.equal(events.map((event) => event.text).join(''), 'begin\n€end\n');
  assert.doesNotMatch(events.map((event) => event.text).join(''), /�/);
});

test('concurrent command streams remain isolated and sensitive queries are not observed', async () => {
  const service = new PodmanService();
  const streams = { A: [], B: [] };
  const execute = (label) => service.withCommandProgress(
    (event) => streams[label].push(event.text),
    () => service.spawnProcess(process.execPath, ['-e',
      `process.stdout.write('${label}1\\n'); setTimeout(() => process.stdout.write('${label}2\\n'), 100);`,
    ], { timeoutMs: 10_000, engine: 'podman', reportProgress: true })
  );
  const results = await Promise.all([execute('A'), execute('B')]);
  assert.ok(results.every((result) => result.success));
  assert.equal(streams.A.join(''), 'A1\nA2\n');
  assert.equal(streams.B.join(''), 'B1\nB2\n');

  const sensitive = [];
  const result = await service.withCommandProgress((event) => sensitive.push(event), () =>
    service.spawnProcess(process.execPath, ['-e', "process.stdout.write('registry-secret')"], {
      timeoutMs: 10_000, engine: 'podman', reportProgress: false,
    })
  );
  assert.equal(result.stdout, 'registry-secret');
  assert.deepEqual(sensitive, []);

  const invocations = [];
  service.spawnProcess = async (_bin, args, options) => {
    invocations.push({ args, options });
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  };
  await service.runEngineCommand(['login', 'example.test'], { stdin: 'secret' });
  await service.runEngineCommand(['ps', '--format', 'json']);
  await service.runEngineCommand(['pull', 'example.test/image']);
  await service.runComposeCommand(path.resolve('compose.yaml'), ['config'], 20_000);
  await service.runComposeCommand(path.resolve('compose.yaml'), ['up', '-d'], 20_000);
  assert.deepEqual(invocations.map(({ options }) => options.reportProgress), [false, false, true, false, true]);
});

test('timeouts request a stop, report uncertainty, and never retry a Compose action', async (t) => {
  const service = new PodmanService();
  const events = [];
  const running = service.withCommandProgress((event) => events.push(event), () =>
    service.spawnProcess(process.execPath, ['-e',
      "process.stdout.write('working\\n'); setTimeout(() => {}, 5000)",
    ], { timeoutMs: 1000, engine: 'podman', reportProgress: true })
  );
  await waitFor(() => events.some((event) => event.text?.includes('working')), 'No output before timeout');
  const result = await running;
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'ETIMEDOUT');
  assert.match(result.stderr, /requested the command to stop/i);

  const previous = { engine: config.engine, composeCommandStyle: config.composeCommandStyle, composePath: config.composePath };
  t.after(() => Object.assign(config, previous));
  Object.assign(config, { engine: 'podman', composeCommandStyle: 'auto', composePath: '' });
  let calls = 0;
  service.spawnProcess = async () => {
    calls++;
    return { success: false, stdout: '', stderr: 'Execution timed out (300s)', exitCode: -1, errorCode: 'ETIMEDOUT' };
  };
  await service.runComposeCommand(path.resolve('compose.yaml'), ['up', '-d'], 1);
  assert.equal(calls, 1);
});

test('long command capture is bounded while its live output remains complete', async () => {
  const service = new PodmanService();
  let bytes = 0;
  const result = await service.withCommandProgress((event) => { bytes += event.text.length; }, () =>
    service.spawnProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(2100000) + 'TAIL')"], {
      timeoutMs: 15_000, engine: 'podman', reportProgress: true,
    })
  );
  assert.equal(result.success, true);
  assert.equal(bytes, 2_100_004);
  assert.ok(result.stdout.length < 2_001_000);
  assert.match(result.stdout, /^\[Earlier output truncated/);
  assert.ok(result.stdout.endsWith('TAIL'));
});

test('configured timeout covers mutations and validates its exact range', async (t) => {
  const previous = config.longOperationTimeoutMinutes;
  t.after(() => {
    if (previous === undefined) delete config.longOperationTimeoutMinutes;
    else config.longOperationTimeoutMinutes = previous;
  });
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  };
  service.runComposeCommand = async (_file, args, timeoutMs) => {
    calls.push({ args, options: { timeoutMs } });
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  };
  config.longOperationTimeoutMinutes = 42;
  await service.pullImage('image');
  await service.stopContainer('container');
  await service.pruneDanglingImages();
  await service.pushImage('source', 'target');
  await service.composeUp(path.resolve('compose.yaml'));
  assert.ok(calls.every(({ options }) => options.timeoutMs === 42 * 60_000));
  for (const invalid of [4, 721, 5.5, '30', NaN]) {
    config.longOperationTimeoutMinutes = invalid;
    await assert.rejects(() => service.pullImage('image'), /whole number between 5 and 720/i);
  }
  for (const valid of [5, 720]) {
    config.longOperationTimeoutMinutes = valid;
    await service.pullImage('image');
    assert.equal(calls.at(-1).options.timeoutMs, valid * 60_000);
  }
});

test('batch progress reports the actual item count even after a failure', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64)];
  service.listAllContainers = async () => ids.map((fullId, index) => ({
    fullId, name: `container-${index}`, isInfra: false,
  }));
  service.runEngineCommand = async (args) => ({
    success: args.at(-1) === ids[0], stdout: '', stderr: '', exitCode: 0,
  });
  const events = [];
  const results = await service.withCommandProgress((event) => events.push(event), () =>
    service.runPodmanBatch('container', 'start', ids)
  );
  assert.deepEqual(results.map((item) => item.result.success), [true, false]);
  assert.deepEqual(events.filter((event) => event.type === 'step').map(({ completed, total, current }) =>
    [completed, total, current]), [
    [0, 2, 'container-0'], [1, 2, undefined], [1, 2, 'container-1'], [2, 2, undefined],
  ]);
});

test('a timed-out batch stops before attempting later targets', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  service.listAllContainers = async () => ids.map((fullId, index) => ({
    fullId, name: `container-${index}`, isInfra: false,
  }));
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args.at(-1));
    return args.at(-1) === ids[1]
      ? { success: false, stdout: '', stderr: 'Execution timed out (300s)', exitCode: -1, errorCode: 'ETIMEDOUT' }
      : { success: true, stdout: '', stderr: '', exitCode: 0 };
  };
  const events = [];
  const results = await service.withCommandProgress((event) => events.push(event), () =>
    service.runPodmanBatch('container', 'start', ids)
  );
  assert.deepEqual(calls, ids.slice(0, 2));
  assert.deepEqual(results.map((item) => item.result.success), [true, false]);
  assert.equal(results[1].result.errorCode, 'ETIMEDOUT');
  assert.deepEqual(events.filter((event) => event.type === 'step').at(-1), {
    type: 'step', completed: 2, total: 3, current: undefined,
  });
});

test('settings refresh keeps unsaved fields while adopting other changes', () => {
  const { reconcileSettingsDraft } =
    loadModule(path.join('webview-ui', 'src', 'settingsDraft.ts'));
  const saved = { engine: 'podman', language: 'en', podmanPath: 'podman', pollingInterval: 2500 };
  const draft = { ...saved, podmanPath: 'custom-podman', pollingInterval: 5000 };
  const dirty = new Set(['podmanPath', 'pollingInterval']);
  const refreshed = reconcileSettingsDraft({ ...saved, language: 'pt-BR' }, draft, dirty);
  assert.deepEqual(refreshed.form, { ...draft, language: 'pt-BR' });
  assert.deepEqual([...refreshed.dirty], ['podmanPath', 'pollingInterval']);
  assert.deepEqual([...dirty], ['podmanPath', 'pollingInterval']);

  const partiallySaved = reconcileSettingsDraft(
    { ...saved, podmanPath: 'custom-podman' }, refreshed.form, refreshed.dirty
  );
  assert.deepEqual([...partiallySaved.dirty], ['pollingInterval']);
  assert.equal(partiallySaved.form.pollingInterval, 5000);
  assert.equal(partiallySaved.form.podmanPath, 'custom-podman');
});

test('concurrent notifications retain errors and share expanded-detail pauses', () => {
  if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  store.dismissBanner();
  store.showBanner('error', 'First failure', 'technical details');
  store.showBanner('error', 'First failure', 'technical details');
  store.showBanner('error', 'Second failure', 'other details');
  store.showBanner('success', 'Completed');
  const banners = useStudioStore.getState().banners;
  assert.deepEqual(banners.map((banner) => banner.message), ['First failure', 'Second failure', 'Completed']);
  store.pauseBanner(banners[2].id);
  store.pauseBanner(banners[2].id);
  assert.equal(useStudioStore.getState().pausedBanners[banners[2].id], 2);
  store.resumeBanner(banners[2].id);
  assert.equal(useStudioStore.getState().pausedBanners[banners[2].id], 1);
  store.dismissBanner(banners[2].id);
  assert.equal(useStudioStore.getState().pausedBanners[banners[2].id], undefined);
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message), ['First failure', 'Second failure']);
  store.dismissBanner();
});
