const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  config,
  vscode,
  loadLogProvider,
  loadStatusProvider,
  loadNativeCommands,
  loadModule,
} = require('./podman-harness.cjs');

const LogProvider = loadLogProvider();
const StatusProvider = loadStatusProvider();

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function composeFiles(t, names = ['compose.yaml']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-status-'));
  const files = names.map((name) => path.join(dir, name));
  for (const file of files) fs.writeFileSync(file, 'services: {}\n');
  t.after(() => {
    for (const file of files) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  });
  return files;
}

test.beforeEach(() => {
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    confirmDeletions: true,
    language: 'en',
  });
});

test('buffers partial UTF-8 lines separately and flushes the final line', (t) => {
  const child = fakeChild();
  const provider = new LogProvider({ streamContainerLogs: () => child });
  t.after(() => provider.dispose());
  const messages = [];
  provider.onLogLine((entry) => messages.push(entry.message));
  provider.startContainerStreaming('example');
  const text = Buffer.from('one\ncafé\r\nlast');
  const accented = text.indexOf(Buffer.from('é'));
  child.stdout.emit('data', text.subarray(0, accented + 1));
  child.stderr.emit('data', Buffer.from('warning\n'));
  child.stdout.emit('data', text.subarray(accented + 1));
  child.emit('close', 0, null);
  assert.deepEqual(messages, ['one', 'warning', 'café', 'last']);
});

test('a replaced stream cannot remove or emit into its successor', (t) => {
  const first = fakeChild();
  const second = fakeChild();
  const children = [first, second];
  const provider = new LogProvider({ streamContainerLogs: () => children.shift() });
  t.after(() => provider.dispose());
  const messages = [];
  const errors = [];
  provider.onLogLine((entry) => messages.push(entry.message));
  provider.onError((error) => errors.push(error));
  provider.startContainerStreaming('example');
  provider.startContainerStreaming('example');
  assert.equal(first.killed, true);
  first.stdout.emit('data', Buffer.from('old\n'));
  first.emit('close', 1, null);
  second.stdout.emit('data', Buffer.from('new\n'));
  provider.stopStreaming('example');
  assert.equal(second.killed, true);
  assert.deepEqual(messages, ['new']);
  assert.deepEqual(errors, []);
});

test('cancelling a pending Compose stream terminates it when it starts', async (t) => {
  const pending = deferred();
  const child = fakeChild();
  const provider = new LogProvider({ streamComposeLogs: () => pending.promise });
  t.after(() => provider.dispose());
  const starting = provider.startComposeStreaming('compose.yaml', 'app');
  provider.stopStreaming('app');
  pending.resolve([{ process: child }]);
  await starting;
  assert.equal(child.killed, true);
});

test('Compose replica log streams close independently and stop together', async (t) => {
  const children = [fakeChild(), fakeChild(), fakeChild()];
  const provider = new LogProvider({
    streamComposeLogs: async () => children.map((process, index) => ({
      process, containerName: `app-${index + 1}`,
    })),
  });
  t.after(() => provider.dispose());
  const messages = [];
  const errors = [];
  provider.onLogLine((entry) => messages.push(entry.message));
  provider.onError((error) => errors.push(error));
  await provider.startComposeStreaming('compose.yaml', 'app');
  children[0].stdout.emit('data', Buffer.from('replica-one\n'));
  children[0].emit('close', 0, null);
  children[1].stdout.emit('data', Buffer.from('replica-two\n'));
  children[1].stderr.emit('data', Buffer.from('connection failed\n'));
  children[1].emit('close', 125, null);
  children[2].stdout.emit('data', Buffer.from('replica-three\n'));
  provider.stopStreaming('app');
  assert.equal(children[2].killed, true);
  children[2].emit('close', 1, 'SIGTERM');
  assert.deepEqual(messages, [
    '[app-1] replica-one', '[app-2] replica-two', '[app-2] connection failed', '[app-3] replica-three',
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /connection failed/);
});

test('cancelling pending replica logs terminates every process', async (t) => {
  const pending = deferred();
  const children = [fakeChild(), fakeChild()];
  const provider = new LogProvider({ streamComposeLogs: () => pending.promise });
  t.after(() => provider.dispose());
  const starting = provider.startComposeStreaming('compose.yaml', 'app');
  provider.stopStreaming('app');
  pending.resolve(children.map((process) => ({ process })));
  await starting;
  assert.ok(children.every((child) => child.killed));
});

test('reports unexpected log stream failures with stderr', (t) => {
  const child = fakeChild();
  const provider = new LogProvider({ streamContainerLogs: () => child });
  t.after(() => provider.dispose());
  const errors = [];
  provider.onError((error) => errors.push(error));
  provider.startContainerStreaming('example');
  child.stderr.emit('data', Buffer.from('connection failed\n'));
  child.emit('close', 125, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /example.*connection failed/i);
});

test('removes Compose ANSI colors before parsing log prefixes', (t) => {
  const provider = new LogProvider({});
  t.after(() => provider.dispose());
  const entry = provider.parseLine('app', '\u001b[1;32m[app] |\u001b[0m ready');
  assert.equal(entry.message, 'ready');
});

test('switching Compose files starts a new poll and ignores stale responses', async (t) => {
  const [oldFile, newFile] = composeFiles(t, ['old.yaml', 'new.yaml']);
  const first = deferred();
  const second = deferred();
  const calls = [];
  const podman = {
    composePs: (file) => {
      calls.push(file);
      return calls.length === 1 ? first.promise : second.promise;
    },
  };
  const provider = new StatusProvider(podman, { parse: () => ({}) });
  t.after(() => provider.dispose());
  provider.startPolling(oldFile, 60_000);
  provider.startPolling(newFile, 60_000);
  assert.deepEqual(calls, [oldFile, newFile]);
  second.resolve([{ service: 'new', status: 'running' }]);
  await tick();
  first.resolve([{ service: 'old', status: 'running' }]);
  await tick();
  assert.deepEqual(provider.getContainers(), [{ service: 'new', status: 'running' }]);
});

test('switching engines clears Compose statuses before the new poll completes', async (t) => {
  const [file] = composeFiles(t);
  const second = deferred();
  let calls = 0;
  const provider = new StatusProvider({
    composePs: () => ++calls === 1
      ? Promise.resolve([{ service: 'old', status: 'running' }])
      : second.promise,
  }, { parse: () => ({}) });
  t.after(() => provider.dispose());
  const events = [];
  provider.onStatusChange((statuses) => events.push(statuses));
  provider.startPolling(file, 60_000);
  await tick();
  assert.equal(provider.getContainers().length, 1);
  config.engine = 'docker';
  provider.startPolling(file, 60_000);
  assert.deepEqual(provider.getContainers(), []);
  assert.deepEqual(events.at(-1), []);
  second.resolve([]);
  await tick();
});

test('deduplicates polling errors until a successful refresh', async (t) => {
  const [file] = composeFiles(t);
  let failing = true;
  const provider = new StatusProvider({
    composePs: async () => {
      if (failing) throw new Error('Podman unavailable');
      return [];
    },
  }, { parse: () => ({}) });
  t.after(() => provider.dispose());
  const errors = [];
  provider.onError((message) => errors.push(message));
  provider.startPolling(file, 60_000);
  await tick();
  await provider.poll();
  assert.deepEqual(errors, ['Podman unavailable']);
  failing = false;
  await provider.poll();
  failing = true;
  await provider.poll();
  assert.deepEqual(errors, ['Podman unavailable', 'Podman unavailable']);
});

test('a removed Compose file clears stale status, reports the file and recovers', async (t) => {
  const [file] = composeFiles(t);
  const pending = deferred();
  let calls = 0;
  const provider = new StatusProvider({
    composePs: () => ++calls === 2
      ? pending.promise
      : Promise.resolve([{ service: 'app', status: 'running' }]),
  }, { parse: () => ({}) });
  t.after(() => provider.dispose());
  const errors = [];
  const events = [];
  provider.onError((message) => errors.push(message));
  provider.onStatusChange((statuses) => events.push(statuses));
  provider.startPolling(file, 60_000);
  await tick();
  assert.equal(provider.getContainers().length, 1);

  const polling = provider.poll();
  fs.unlinkSync(file);
  pending.resolve([{ service: 'stale', status: 'running' }]);
  await polling;
  assert.deepEqual(provider.getContainers(), []);
  assert.deepEqual(events.at(-1), []);
  assert.deepEqual(errors, [`Compose file is unavailable: ${file}`]);

  await provider.poll();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  fs.writeFileSync(file, 'services: {}\n');
  await provider.poll();
  assert.deepEqual(provider.getContainers(), [{ service: 'app', status: 'running' }]);
});

test('clearing the active Compose file invalidates an in-flight poll', async (t) => {
  const [file] = composeFiles(t);
  const pending = deferred();
  let calls = 0;
  const provider = new StatusProvider({
    composePs: () => ++calls === 1
      ? Promise.resolve([{ service: 'app', status: 'running' }])
      : pending.promise,
  }, { parse: () => ({}) });
  t.after(() => provider.dispose());
  provider.startPolling(file, 60_000);
  await tick();
  const polling = provider.poll();
  provider.clearActiveFile();
  assert.deepEqual(provider.getContainers(), []);
  pending.resolve([{ service: 'stale', status: 'running' }]);
  await polling;
  assert.deepEqual(provider.getContainers(), []);
});

test('native Compose down confirms deletion and marks a failed command as failed', async (t) => {
  const NativeCommandsManager = loadNativeCommands();
  const originalWarning = vscode.window.showWarningMessage;
  const originalItem = vscode.window.createStatusBarItem;
  const originalError = vscode.window.showErrorMessage;
  t.after(() => {
    vscode.window.showWarningMessage = originalWarning;
    vscode.window.createStatusBarItem = originalItem;
    vscode.window.showErrorMessage = originalError;
  });
  const statusItems = [];
  vscode.window.createStatusBarItem = () => {
    const item = { text: '', show() {}, hide() {}, dispose() {} };
    statusItems.push(item);
    return item;
  };
  let choice;
  vscode.window.showWarningMessage = async () => choice;
  const errors = [];
  vscode.window.showErrorMessage = async (message) => { errors.push(message); };
  let downCalls = 0;
  const manager = new NativeCommandsManager({
    composeDown: async () => {
      downCalls++;
      return { success: false, stdout: '', stderr: 'provider failed', exitCode: 1 };
    },
  }, { registerFile: async () => {} }, { startPolling() {} }, async () => {});

  await manager.handleComposeAction('down', { fsPath: 'compose.yaml' });
  assert.equal(downCalls, 0);
  choice = 'Yes';
  await manager.handleComposeAction('down', { fsPath: 'compose.yaml' });
  assert.equal(downCalls, 1);
  assert.match(errors[0], /provider failed/);
  assert.match(statusItems[1].text, /\$\(error\)/);
});

test('webview busy state tracks concurrent operations and repeated keys', () => {
  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { language: 'en' };
  }
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  store.beginOperation('start');
  store.beginOperation('start');
  store.beginOperation('stop');
  store.endOperation('start');
  assert.equal(useStudioStore.getState().operationsInProgress.start, 1);
  store.endOperation('start');
  assert.equal(useStudioStore.getState().operationInProgress, 'stop');
  store.endOperation('stop');
  assert.equal(useStudioStore.getState().operationInProgress, null);
});

test('Compose scaling requires an explicit, safe replica count', () => {
  const { parseDesiredReplicas } = loadModule(path.join('webview-ui', 'src', 'composeStatus.ts'));
  for (const value of ['', ' ', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.equal(parseDesiredReplicas(value), undefined, `Unexpectedly accepted ${JSON.stringify(value)}`);
  }
  assert.equal(parseDesiredReplicas('0'), 0);
  assert.equal(parseDesiredReplicas(' 2 '), 2);
  assert.equal(parseDesiredReplicas(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
});

test('Podman Compose summaries include every replica regardless of list order', () => {
  const { groupComposeContainers, summarizeComposeService } =
    loadModule(path.join('webview-ui', 'src', 'composeStatus.ts'));
  const running = { id: 'a', service: 'app', status: 'running' };
  const stopped = { id: 'b', service: 'app', status: 'exited' };
  const paused = { id: 'c', service: 'app', status: 'paused' };
  for (const items of [[running, stopped], [stopped, running]]) {
    const grouped = groupComposeContainers(items);
    const summary = summarizeComposeService(grouped.get('app'), true);
    assert.equal(summary.active, true);
    assert.equal(summary.status, 'unhealthy');
    assert.equal(summary.terminalContainer, running);
    assert.equal(summary.count, 2);
  }
  assert.equal(summarizeComposeService([running, paused], true).status, 'unhealthy');
  assert.equal(summarizeComposeService([paused], true).terminalContainer, undefined);
  assert.equal(summarizeComposeService([running, stopped], false).active, false);
  assert.equal(summarizeComposeService([paused], false).active, false);
  assert.equal(summarizeComposeService([paused], true).active, true);
});
