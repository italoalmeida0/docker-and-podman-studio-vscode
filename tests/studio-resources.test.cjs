const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { config, loadModule, loadService, vscode } = require('./podman-harness.cjs');

const PodmanService = loadService();
const ok = (stdout = '') => ({ success: true, stdout, stderr: '', exitCode: 0 });
const failed = (stderr) => ({ success: false, stdout: '', stderr, exitCode: 1 });
const id = (character) => character.repeat(64);

test.beforeEach(() => {
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    dockerPath: 'docker',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'default',
  });
});

test('Podman volume usage includes named volumes and rejects failed or malformed queries', async () => {
  const service = new PodmanService();
  const volumes = [
    { Name: 'named-free', CreatedAt: '2026-01-01T00:00:00Z' },
    { Name: 'named-used', CreatedAt: '2026-01-02T00:00:00Z' },
  ];
  service.runEngineCommand = async (args) =>
    ok(JSON.stringify(args.includes('dangling=true') ? [volumes[0]] : volumes));
  const listed = await service.listVolumes();
  assert.deepEqual(listed.map((volume) => [volume.name, volume.usage]), [
    ['named-free', 'unused'], ['named-used', 'inUse'],
  ]);
  assert.equal(listed[0].created, volumes[0].CreatedAt);

  service.runEngineCommand = async (args) =>
    args.includes('dangling=true') ? failed('filter unavailable') : ok('[]');
  await assert.rejects(() => service.listVolumes(), /filter unavailable/);
  service.runEngineCommand = async (args) =>
    args.includes('dangling=true') ? ok('not-json') : ok('[]');
  await assert.rejects(() => service.listVolumes(), /invalid resource data/i);
});

test('Podman networks protect the configured default and reject missing configuration', async () => {
  const service = new PodmanService();
  const networks = [
    { name: 'custom-default', id: id('a') },
    { name: 'free', id: id('b') },
    { name: 'used', id: id('c') },
  ];
  service.runEngineCommand = async (args) => {
    if (args[0] === 'info') {
      return ok(JSON.stringify({ host: { networkBackendInfo: { defaultNetwork: 'custom-default' } } }));
    }
    return ok(JSON.stringify(args.includes('dangling=true') ? networks.slice(0, 2) : networks));
  };
  const listed = await service.listNetworks();
  assert.deepEqual(listed.map((network) => [network.name, network.usage, network.protected]), [
    ['custom-default', 'unused', true], ['free', 'unused', false], ['used', 'inUse', false],
  ]);
  assert.equal(listed[1].fullId, id('b'));
  service.runEngineCommand = async (args) => args[0] === 'info' ? ok('{}') : ok('[]');
  await assert.rejects(() => service.listNetworks(), /default network/i);
});

test('Docker volume identities come from inspect, not the truncated list', async () => {
  config.engine = 'docker';
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    if (args[1] === 'inspect') {
      return ok(JSON.stringify([{ Name: 'saved', Driver: 'local', CreatedAt: '2026-01-01T00:00:00Z' }]));
    }
    return ok(JSON.stringify({ Name: 'saved', Driver: 'local' }));
  };
  const [volume] = await service.listVolumes();
  assert.equal(volume.created, '2026-01-01T00:00:00Z');
  assert.equal(volume.usage, 'unused');
  assert.deepEqual(calls.at(-1).args, ['volume', 'inspect', '--', 'saved']);
  assert.ok(calls.every((call) => call.options.engineOverride === 'docker'));
  service.runEngineCommand = async (args) =>
    args[1] === 'inspect' ? failed('inspect denied') : ok('{"Name":"saved"}');
  await assert.rejects(() => service.listVolumes(), /inspect denied/);
});

test('Docker network usage checks stopped container references and active attachments', async () => {
  config.engine = 'docker';
  const service = new PodmanService();
  const listed = [
    { ID: id('a'), Name: 'stopped-ref', Driver: 'bridge', Scope: 'local' },
    { ID: id('b'), Name: 'attached', Driver: 'bridge', Scope: 'local' },
    { ID: id('c'), Name: 'free', Driver: 'bridge', Scope: 'local' },
    { ID: id('d'), Name: 'swarm', Driver: 'overlay', Scope: 'swarm' },
  ];
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    if (args[0] === 'ps') return ok('{"Names":"stopped","Networks":"stopped-ref"}');
    if (args[1] === 'inspect') return ok(JSON.stringify(listed.map((network) => ({
      Id: network.ID,
      Containers: network.Name === 'attached' ? { endpoint: {} } : {},
    }))));
    return ok(listed.map((network) => JSON.stringify(network)).join('\n'));
  };
  const networks = await service.listNetworks();
  assert.deepEqual(networks.map((network) => [network.name, network.usage, network.protected]), [
    ['stopped-ref', 'inUse', false],
    ['attached', 'inUse', false],
    ['free', 'unused', false],
    ['swarm', 'unused', true],
  ]);
  assert.ok(!calls.some((args) => args.includes('dangling=true')));
  assert.ok(calls.find((args) => args[1] === 'ls').includes('--no-trunc'));

  service.runEngineCommand = async (args) => {
    if (args[0] === 'ps') return ok('{"Names":"missing-networks"}');
    return ok(listed.map((network) => JSON.stringify(network)).join('\n'));
  };
  await assert.rejects(() => service.listNetworks(), /network references/i);
});

test('resource removal revalidates identity, protects in-use resources and reports partial failures', async () => {
  const service = new PodmanService();
  const calls = [];
  service.listVolumes = async () => [
    { name: 'first', created: 'one', usage: 'unused' },
    { name: 'second', created: 'two', usage: 'unused' },
    { name: 'used', created: 'three', usage: 'inUse' },
  ];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    if (args[1] === 'inspect') {
      return ok(JSON.stringify([{ Name: args.at(-1), CreatedAt: args.at(-1) === 'first' ? 'one' : 'two' }]));
    }
    return args.at(-1) === 'first' ? failed('driver refused') : ok('removed');
  };
  await assert.rejects(
    () => service.removeResourceSelection('volume', [{ name: 'used', identity: 'three' }], 'podman'),
    /in use/
  );
  await assert.rejects(
    () => service.removeResourceSelection('volume', [{ name: 'first', identity: 'recreated' }], 'podman'),
    /changed/
  );
  assert.equal(calls.length, 0);
  const results = await service.removeResourceSelection('volume', [
    { name: 'first', identity: 'one' }, { name: 'second', identity: 'two' },
  ], 'podman');
  assert.deepEqual(results.map((item) => item.result.success), [false, true]);
  assert.deepEqual(calls.map((call) => call.args), [
    ['volume', 'inspect', '--', 'first'], ['volume', 'rm', '--', 'first'],
    ['volume', 'inspect', '--', 'second'], ['volume', 'rm', '--', 'second'],
  ]);
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
});

test('resource removal stops after a timeout during recheck or deletion', async () => {
  for (const phase of ['inspect', 'rm']) {
    const service = new PodmanService();
    service.listVolumes = async () => [
      { name: 'first', created: 'one', usage: 'unused' },
      { name: 'second', created: 'two', usage: 'unused' },
    ];
    const calls = [];
    service.runEngineCommand = async (args) => {
      calls.push(args);
      if (args[1] === phase) {
        return { ...failed('Execution timed out (300s)'), errorCode: 'ETIMEDOUT' };
      }
      return ok(JSON.stringify([{ Name: 'first', CreatedAt: 'one' }]));
    };
    const results = await service.removeResourceSelection('volume', [
      { name: 'first', identity: 'one' }, { name: 'second', identity: 'two' },
    ], 'podman');
    assert.equal(results.length, 1);
    assert.equal(results[0].result.errorCode, 'ETIMEDOUT');
    assert.equal(calls.some((args) => args.at(-1) === 'second'), false);
  }
});

test('resource removal refuses a volume replaced after the initial check', async () => {
  const service = new PodmanService();
  service.listVolumes = async () => [{ name: 'replaced', created: 'old', usage: 'unused' }];
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return ok(JSON.stringify([{ Name: 'replaced', CreatedAt: 'new' }]));
  };
  const [result] = await service.removeResourceSelection(
    'volume', [{ name: 'replaced', identity: 'old' }], 'podman'
  );
  assert.equal(result.result.success, false);
  assert.match(result.result.stderr, /changed after confirmation/i);
  assert.deepEqual(calls, [['volume', 'inspect', '--', 'replaced']]);
});

test('resource removal refuses an image tag reassigned after the initial check', async () => {
  const service = new PodmanService();
  service.listImages = async () => [{
    repository: 'localhost/example', tag: 'latest', fullId: id('a'), dangling: false,
  }];
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return ok(JSON.stringify([{ Id: id('b') }]));
  };
  const [result] = await service.removeResourceSelection(
    'image', [{ name: 'localhost/example:latest', identity: id('a') }], 'podman'
  );
  assert.equal(result.result.success, false);
  assert.match(result.result.stderr, /changed after confirmation/i);
  assert.deepEqual(calls, [['image', 'inspect', '--', 'localhost/example:latest']]);
});

test('resource removal stops acting on subsequent targets if the engine changes mid-batch', async () => {
  const service = new PodmanService();
  service.listNetworks = async () => [
    { name: 'first', fullId: id('a'), usage: 'unused', protected: false },
    { name: 'second', fullId: id('b'), usage: 'unused', protected: false },
  ];
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    config.engine = 'docker';
    return ok();
  };
  const results = await service.removeResourceSelection('network', [
    { name: 'first', identity: id('a') }, { name: 'second', identity: id('b') },
  ], 'podman');
  assert.deepEqual(results.map((item) => item.result.success), [true, false]);
  assert.match(results[1].result.stderr, /engine or executable changed/i);
  assert.deepEqual(calls, [['network', 'rm', '--', id('a')]]);
});

test('resource removal refuses default networks, missing identities and engine changes', async () => {
  const service = new PodmanService();
  service.listNetworks = async () => [
    { name: 'default', fullId: id('a'), usage: 'unused', protected: true },
    { name: 'free', fullId: id('b'), usage: 'unused', protected: false },
  ];
  const calls = [];
  service.runEngineCommand = async (args) => { calls.push(args); return ok(); };
  await assert.rejects(
    () => service.removeResourceSelection('network', [{ name: 'default', identity: id('a') }], 'podman'),
    /protected/
  );
  await assert.rejects(
    () => service.removeResourceSelection('network', [{ name: 'free', identity: '' }], 'podman'),
    /invalid/i
  );
  service.listNetworks = async () => {
    config.podmanPath = 'changed';
    return [{ name: 'free', fullId: id('b'), usage: 'unused', protected: false }];
  };
  await assert.rejects(
    () => service.removeResourceSelection('network', [{ name: 'free', identity: id('b') }], 'podman'),
    /engine or executable changed/i
  );
  assert.deepEqual(calls, []);
});

test('Compose selected removal stops every selected replica without deleting other services', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-selected-'));
  const file = path.join(dir, 'compose.yaml');
  fs.writeFileSync(file, 'services:\n  app:\n    stop_grace_period: 2s\n  worker: {}\n  other: {}\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const service = new PodmanService();
  const app1 = { fullId: id('a'), name: 'app-1', service: 'app' };
  const app2 = { fullId: id('b'), name: 'app-2', service: 'app' };
  const worker = { fullId: id('c'), name: 'worker-1', service: 'worker' };
  const other = { fullId: id('d'), name: 'other-1', service: 'other' };
  let queries = 0;
  service.composePs = async () => ++queries === 1 ? [app1, app2, worker, other] : [other];
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    if (args[1] === 'inspect') return ok(args.slice(4).map((containerId) => `${containerId} []`).join('\n'));
    return ok();
  };
  const result = await service.composeRemoveServices(file, ['app', 'worker'], undefined, fs.readFileSync(file, 'utf8'));
  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.args), [
    ['container', 'inspect', '--format', '{{.Id}} {{json .Dependencies}}', app1.fullId, app2.fullId, worker.fullId],
    ['container', 'stop', '--time', '2', app1.fullId], ['container', 'rm', app1.fullId],
    ['container', 'stop', '--time', '2', app2.fullId], ['container', 'rm', app2.fullId],
    ['container', 'stop', worker.fullId], ['container', 'rm', worker.fullId],
  ]);
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
  assert.match(result.stdout, /app-1[\s\S]*app-2[\s\S]*worker-1/);
});

test('Compose selected removal reports partial failures and does not retry failed targets', async () => {
  const service = new PodmanService();
  const file = path.join(__dirname, 'fixtures', 'compose-project-name.yaml');
  const replicas = ['a', 'b', 'c'].map((character) => ({
    fullId: id(character), name: `app-${character}`, service: 'app',
  }));
  service.composePs = async () => replicas;
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    if (args[1] === 'inspect') return ok(args.slice(4).map((containerId) => `${containerId} []`).join('\n'));
    return args[1] === 'stop' && args.at(-1) === id('b') ? failed('stop denied') : ok();
  };
  const result = await service.composeRemoveServices(file, ['app']);
  assert.equal(result.success, false);
  assert.match(result.stdout, /app-a[\s\S]*app-c/);
  assert.match(result.stderr, /app-b: stop denied/);
  assert.equal(calls.filter((args) => args.at(-1) === id('b')).length, 1);
  assert.deepEqual([result.completed, result.total], [2, 3]);
});

test('Compose selected removal stops on timeout and reports unattempted targets', async () => {
  const service = new PodmanService();
  const file = path.join(__dirname, 'fixtures', 'compose-project-name.yaml');
  const replicas = ['a', 'b', 'c'].map((character) => ({
    fullId: id(character), name: `app-${character}`, service: 'app',
  }));
  service.composePs = async () => replicas;
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    if (args[1] === 'inspect') return ok(args.slice(4).map((containerId) => `${containerId} []`).join('\n'));
    if (args[1] === 'stop' && args.at(-1) === id('b')) {
      return { ...failed('Execution timed out (300s)'), errorCode: 'ETIMEDOUT' };
    }
    return ok();
  };
  const events = [];
  const result = await service.withCommandProgress((event) => events.push(event), () =>
    service.composeRemoveServices(file, ['app'])
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'ETIMEDOUT');
  assert.deepEqual([result.completed, result.total], [1, 3]);
  assert.match(result.stderr, /app-b: Execution timed out/);
  assert.equal(calls.some((args) => args[1] !== 'inspect' && args.at(-1) === id('c')), false);
  assert.deepEqual(events.filter((event) => event.type === 'step').at(-1), {
    type: 'step', completed: 2, total: 3, current: undefined,
  });
});

test('Compose selected removal removes dependent containers before their dependencies', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dependencies-'));
  const file = path.join(dir, 'compose.yaml');
  fs.writeFileSync(file, 'services:\n  app: {}\n  worker:\n    depends_on: [app]\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const service = new PodmanService();
  const app = { fullId: id('a'), name: 'app-1', service: 'app' };
  const worker = { fullId: id('b'), name: 'worker-1', service: 'worker' };
  const remaining = new Set([app.fullId, worker.fullId]);
  const removals = [];
  service.composePs = async () => [app, worker].filter((container) => remaining.has(container.fullId));
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  service.runEngineCommand = async (args) => {
    if (args[1] === 'inspect') {
      return ok(`${app.fullId} []\n${worker.fullId} ["${app.fullId}"]\n`);
    }
    if (args[1] === 'rm') {
      removals.push(args.at(-1));
      if (args.at(-1) === app.fullId && remaining.has(worker.fullId)) {
        return failed('has dependent containers');
      }
      remaining.delete(args.at(-1));
    }
    return ok();
  };
  const result = await service.composeRemoveServices(file, ['app', 'worker']);
  assert.equal(result.success, true, result.stderr);
  assert.deepEqual(removals, [worker.fullId, app.fullId]);
  assert.equal(remaining.size, 0);
});

test('Compose selected removal never deletes an unselected dependent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-unselected-dependency-'));
  const file = path.join(dir, 'compose.yaml');
  fs.writeFileSync(file, 'services:\n  app: {}\n  worker:\n    depends_on: [app]\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const service = new PodmanService();
  const app = { fullId: id('a'), name: 'app-1', service: 'app' };
  const worker = { fullId: id('b'), name: 'worker-1', service: 'worker' };
  service.composePs = async () => [app, worker];
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return args[1] === 'rm' ? failed('has dependent containers') : ok();
  };
  const result = await service.composeRemoveServices(file, ['app']);
  assert.equal(result.success, false);
  assert.match(result.stderr, /app-1: has dependent containers/);
  assert.deepEqual(calls, [
    ['container', 'stop', app.fullId], ['container', 'rm', app.fullId],
  ]);
});

test('Compose selected removal refuses missing, invalid, cyclic or failed dependency inspections', async () => {
  const file = path.join(__dirname, 'fixtures', 'compose-project-name.yaml');
  const containers = ['a', 'b'].map((character) => ({
    fullId: id(character), name: `app-${character}`, service: 'app',
  }));
  const attempts = [
    [failed('inspect denied'), /inspect denied/],
    [ok(`${id('a')} []`), /incomplete.*dependency data/i],
    [ok(`${id('a')} []\n${id('b')} ["not-an-id"]`), /invalid.*dependency data/i],
    [ok(`${id('a')} ["${id('b')}"]\n${id('b')} ["${id('a')}"]`), /cyclic dependencies/i],
  ];
  for (const [inspection, expectedError] of attempts) {
    const service = new PodmanService();
    service.composePs = async () => containers;
    service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
    const calls = [];
    service.runEngineCommand = async (args) => {
      calls.push(args);
      return inspection;
    };
    await assert.rejects(() => service.composeRemoveServices(file, ['app']), expectedError);
    assert.deepEqual(calls.map((args) => args[1]), ['inspect']);
  }
});

test('Compose dependency inspection uses bounded batches and rechecks settings before removal', async () => {
  const file = path.join(__dirname, 'fixtures', 'compose-project-name.yaml');
  const containers = Array.from({ length: 101 }, (_, index) => ({
    fullId: index.toString(16).padStart(64, '0'), name: `app-${index}`, service: 'app',
  }));
  const service = new PodmanService();
  let queries = 0;
  service.composePs = async () => ++queries === 1 ? containers : [];
  service.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const inspections = [];
  service.runEngineCommand = async (args) => {
    if (args[1] === 'inspect') {
      inspections.push(args.slice(4));
      return ok(args.slice(4).map((containerId) => `${containerId} []`).join('\n'));
    }
    return ok();
  };
  assert.equal((await service.composeRemoveServices(file, ['app'])).success, true);
  assert.deepEqual(inspections.map((batch) => batch.length), [100, 1]);

  const changed = new PodmanService();
  changed.composePs = async () => containers.slice(0, 2);
  changed.runComposeCommand = async () => ok(fs.readFileSync(file, 'utf8'));
  const calls = [];
  changed.runEngineCommand = async (args) => {
    calls.push(args);
    config.podmanPath = 'different-podman';
    return ok(args.slice(4).map((containerId) => `${containerId} []`).join('\n'));
  };
  await assert.rejects(() => changed.composeRemoveServices(file, ['app']), /settings or file changed/i);
  assert.deepEqual(calls.map((args) => args[1]), ['inspect']);
});

test('container tree groups pods and Compose projects, preserves empty pods and filters', () => {
  const { buildContainerTree, containerFilterForEngine } =
    loadModule(path.join('webview-ui', 'src', 'containerTree.ts'));
  const pod = { id: 'pod-short', fullId: 'pod-full', name: 'group-a', networks: [], state: 'running' };
  const empty = { id: 'empty-short', fullId: 'empty-full', name: 'empty', networks: [], state: 'stopped' };
  const container = (name, overrides = {}) => ({
    id: name, fullId: name, name, image: 'image', state: 'running',
    podId: '', podName: '', isCompose: false, composeProject: '', ...overrides,
  });
  const items = [
    container('pod-member', { podId: pod.id, podName: pod.name, isCompose: true, composeProject: 'project' }),
    container('compose-member', { isCompose: true, composeProject: 'project' }),
    container('standalone'),
  ];
  const tree = buildContainerTree(items, [pod, empty], 'podman', 'all', '');
  assert.deepEqual(tree.podGroups.map((group) => [group.pod.name, group.containers.length]), [
    ['group-a', 1], ['empty', 0],
  ]);
  assert.deepEqual(tree.composeGroups.map((group) => [group.project, group.containers.length]), [['project', 1]]);
  assert.deepEqual(tree.standalone.map((item) => item.name), ['standalone']);
  assert.deepEqual(
    buildContainerTree(items, [pod, empty], 'podman', 'stopped', '').podGroups.map((group) => group.pod.name),
    ['empty']
  );
  assert.deepEqual(
    buildContainerTree(items, [pod, empty], 'podman', 'all', 'group-a').filtered.map((item) => item.name),
    ['pod-member']
  );
  assert.equal(buildContainerTree(items, [pod, empty], 'docker', 'all', '').podGroups.length, 0);
  assert.equal(containerFilterForEngine('pod', 'docker'), 'all');
  assert.equal(containerFilterForEngine('pod', 'podman'), 'pod');
  assert.equal(containerFilterForEngine('compose', 'docker'), 'compose');
});

test('progress tokens, engine changes and error banners remain consistent', () => {
  if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  store.beginOperation('refresh', 'First', '1');
  store.beginOperation('refresh', 'Second', '2');
  store.endOperation('refresh', 'unknown');
  assert.equal(useStudioStore.getState().operationsInProgress.refresh, 2);
  store.endOperation('refresh', '1');
  assert.equal(useStudioStore.getState().operationsInProgress.refresh, 1);
  store.endOperation('refresh', '2');
  assert.equal(useStudioStore.getState().operationInProgress, null);

  store.setImages([{ fullId: 'old' }]);
  store.setVolumes([{ name: 'old' }]);
  store.setComposeContainers([{ name: 'old' }]);
  store.setEnginePreference('podman');
  assert.deepEqual(useStudioStore.getState().images, []);
  assert.deepEqual(useStudioStore.getState().volumes, []);
  assert.deepEqual(useStudioStore.getState().composeContainers, []);
  store.showBanner('error', 'failure');
  store.showBanner('success', 'later success');
  const banners = useStudioStore.getState().banners;
  assert.deepEqual(banners.map((banner) => banner.message), ['failure', 'later success']);
  store.dismissBanner(banners[1].id);
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message), ['failure']);
});

test('engine messages wait for settings and ignore stale responses from another engine', () => {
  const { createEngineMessageGate } = loadModule(path.join('webview-ui', 'src', 'vscode.ts'));
  const gate = createEngineMessageGate();
  const old = { command: 'images:update', engine: 'podman', payload: ['old'] };
  const latest = { command: 'images:update', engine: 'podman', payload: ['latest'] };
  const other = { command: 'volumes:update', engine: 'docker', payload: ['other'] };
  assert.equal(gate.shouldHandle(old, 'docker', false), false);
  assert.equal(gate.shouldHandle(latest, 'docker', false), false);
  assert.equal(gate.shouldHandle(other, 'docker', false), false);
  assert.deepEqual(gate.drain('podman'), [latest]);
  assert.deepEqual(gate.drain('podman'), []);
  assert.equal(gate.shouldHandle(other, 'podman', true), false);
  assert.equal(gate.shouldHandle(latest, 'podman', true), true);
  assert.equal(gate.shouldHandle({ command: 'error' }, 'podman', false), true);
});

test('closing the Studio panel notifies listeners before it is reopened', (t) => {
  const previousUri = vscode.Uri;
  const previousColumn = vscode.ViewColumn;
  const previousCreate = vscode.window.createWebviewPanel;
  t.after(() => {
    vscode.Uri = previousUri;
    vscode.ViewColumn = previousColumn;
    vscode.window.createWebviewPanel = previousCreate;
  });
  const makeUri = (fsPath) => ({ fsPath, toString: () => fsPath });
  vscode.Uri = {
    file: makeUri,
    joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
  };
  vscode.ViewColumn = { Active: 1 };
  const panels = [];
  vscode.window.createWebviewPanel = () => {
    const listeners = [];
    const panel = {
      webview: {
        asWebviewUri: (uri) => uri,
        cspSource: 'vscode-resource:',
        onDidReceiveMessage: () => ({ dispose() {} }),
      },
      onDidDispose: (listener) => {
        listeners.push(listener);
        return { dispose() {} };
      },
      dispose: () => listeners.forEach((listener) => listener()),
    };
    panels.push(panel);
    return panel;
  };
  const { StudioWebviewPanel } = loadModule(path.join('src', 'ui', 'webviewProvider.ts'));
  const provider = new StudioWebviewPanel(makeUri(path.resolve(__dirname, '..')));
  let closed = 0;
  provider.onDidClose(() => closed++);
  provider.createOrShowPanel();
  panels[0].dispose();
  assert.equal(closed, 1);
  assert.equal(provider.isVisible(), false);
  provider.createOrShowPanel();
  assert.equal(provider.isVisible(), true);
  provider.dispose();
  assert.equal(closed, 2);
});

test('registry requests handle timeouts, interrupted responses and cancellation', async (t) => {
  const { httpGetJson } = loadModule(path.join('src', 'extension.ts'));
  const originalGet = https.get;
  t.after(() => { https.get = originalGet; });

  https.get = (_url, options) => {
    assert.equal(options.timeout, 20_000);
    const request = new EventEmitter();
    request.destroy = (error) => { request.emit('error', error); };
    queueMicrotask(() => request.emit('timeout'));
    return request;
  };
  await assert.rejects(() => httpGetJson('https://registry.invalid'), /timed out/i);

  https.get = () => {
    const request = new EventEmitter();
    request.destroy = (error) => { request.emit('error', error); };
    return request;
  };
  await assert.rejects(() => httpGetJson('https://registry.invalid', {}, undefined, 25), /timed out/i);

  https.get = (_url, _options, callback) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('aborted');
    });
    return request;
  };
  await assert.rejects(() => httpGetJson('https://registry.invalid'), /interrupted/i);

  https.get = (_url, _options, callback) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', 'private response content');
      response.emit('end');
    });
    return request;
  };
  await assert.rejects(() => httpGetJson('https://registry.invalid'), (error) =>
    /invalid JSON/i.test(error.message) && !error.message.includes('private response content')
  );

  const controller = new AbortController();
  https.get = (_url, options) => {
    assert.equal(options.signal, controller.signal);
    const request = new EventEmitter();
    options.signal.addEventListener('abort', () => {
      request.emit('error', Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    return request;
  };
  const request = httpGetJson('https://registry.invalid', {}, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('registry searches use the selected provider instead of an unrelated configured URL', () => {
  const { resolveRegistrySearch } = loadModule(path.join('src', 'extension.ts'));
  const configured = { registryProvider: 'custom', registryUrl: 'registry.example.test' };
  assert.deepEqual(resolveRegistrySearch('configured', '', configured), {
    provider: 'custom', registryUrl: 'registry.example.test',
  });
  assert.deepEqual(resolveRegistrySearch('quay', '', configured), {
    provider: 'quay', registryUrl: '',
  });
  assert.deepEqual(resolveRegistrySearch('dockerhub', '', configured), {
    provider: 'dockerhub', registryUrl: '',
  });
  assert.deepEqual(resolveRegistrySearch('custom', '', configured), {
    provider: 'custom', registryUrl: '',
  });
});
