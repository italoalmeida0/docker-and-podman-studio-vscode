const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { config, loadService, vscode } = require('./podman-harness.cjs');

const PodmanService = loadService();
const composeFixture = path.join(__dirname, 'fixtures', 'compose-project-name.yaml');
const ok = (stdout = '') => ({ success: true, stdout, stderr: '', exitCode: 0 });
const failed = (stderr, errorCode) => ({
  success: false,
  stdout: '',
  stderr,
  exitCode: -1,
  errorCode,
});

test.beforeEach(() => {
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'default',
  });
});

test('distinguishes restarting from starting', () => {
  const service = new PodmanService();
  assert.equal(service.parseStatus('restarting'), 'restarting');
  assert.equal(service.parseStatus('running', 'Up (health: starting)'), 'starting');
  assert.equal(service.parseStatus('running', 'Up (unhealthy)'), 'unhealthy');
  config.engine = 'docker';
  assert.equal(service.parseStatus('paused', '', 'podman'), 'paused');
});

test('does not present an exposed-only port as a published host port', () => {
  const service = new PodmanService();
  const { mappings, display } = service.parsePodmanPorts([
    { container_port: 8080, host_port: 0, protocol: 'tcp' },
  ]);
  assert.equal(mappings[0].host, '');
  assert.equal(display, '8080/tcp');
});

test('does not start a machine after its stop failed', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return args[1] === 'stop' ? failed('stop failed') : ok();
  };
  const result = await service.restartMachine('test-machine');
  assert.equal(result.success, false);
  assert.deepEqual(calls, [['machine', 'stop', 'test-machine']]);
});

test('preserves quoted container command arguments', async () => {
  const service = new PodmanService();
  let actual;
  service.runEngineCommand = async (args) => {
    actual = args;
    return ok();
  };
  await service.createContainer({
    image: 'example/image:latest',
    command: `sh -c 'printf "%s" "hello world"'`,
  });
  assert.deepEqual(actual.slice(-4), [
    'example/image:latest',
    'sh',
    '-c',
    'printf "%s" "hello world"',
  ]);
});

test('rejects an unterminated quoted container command', async () => {
  const service = new PodmanService();
  service.runEngineCommand = async () => {
    throw new Error('invalid commands must not be executed');
  };
  await assert.rejects(
    () => service.createContainer({ image: 'example/image:latest', command: `sh -c 'unterminated` }),
    /quot/i
  );
});

test('uses a custom Compose executable path containing spaces intact', () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'custom';
  config.composePath = path.join('C:', 'Program Files', 'Compose', 'podman-compose.exe');
  const invocation = service.buildComposeInvocation(path.resolve('compose.yaml'), ['ps']);
  assert.equal(invocation.bin, config.composePath);
});

test('preserves Docker custom Compose command arguments', () => {
  const service = new PodmanService();
  config.engine = 'docker';
  config.composeCommandStyle = 'custom';
  config.composePath = 'docker-compose --ansi never';
  const invocation = service.buildComposeInvocation(composeFixture, ['ps']);
  assert.equal(invocation.bin, 'docker-compose');
  assert.deepEqual(invocation.args.slice(0, 2), ['--ansi', 'never']);
});

test('passes the configured Podman executable to standalone podman-compose', () => {
  const service = new PodmanService();
  config.podmanPath = path.join('C:', 'Program Files', 'Podman', 'podman.exe');
  const invocation = service.buildComposeInvocation(path.resolve('compose.yaml'), ['ps']);
  const index = invocation.args.indexOf('--podman-path');
  assert.notEqual(index, -1);
  assert.equal(invocation.args[index + 1], config.podmanPath);
});

test('Windows PowerShell scripts receive literal Podman arguments without a command shell', {
  skip: process.platform !== 'win32',
}, async () => {
  const service = new PodmanService();
  const script = path.join(__dirname, 'fixtures', 'windows-argv.ps1');
  const args = ['two words', 'a&echo INJECTED', '%PATH%', 'quote" & echo INJECTED', 'tail\\', '', 'caf\u00e9'];
  const result = await service.spawnProcess(script, args, { timeoutMs: 15_000, engine: 'podman' });
  assert.equal(result.success, true, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);

  const stdinScript = path.join(__dirname, 'fixtures', 'windows-stdin.ps1');
  const input = 'secret %PATH% & "quoted"';
  const stdinResult = await service.spawnProcess(stdinScript, [], {
    timeoutMs: 15_000, engine: 'podman', stdin: input,
  });
  assert.equal(stdinResult.success, true, stdinResult.stderr);
  assert.equal(stdinResult.stdout, input);

  const stream = await service.spawnComposeLogProcess({ bin: script, args, cwd: __dirname }, 'podman');
  let output = '';
  stream.stdout.on('data', (chunk) => { output += chunk.toString(); });
  const code = await new Promise((resolve) => stream.on('close', resolve));
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output), args);
});

test('preserves UTF-8 output split across process chunks', async () => {
  const service = new PodmanService();
  const source = [
    "const bytes = Buffer.from('\\u20ac');",
    'process.stdout.write(bytes.subarray(0, 2));',
    'process.stderr.write(bytes.subarray(0, 2));',
    'setTimeout(() => {',
    '  process.stdout.write(bytes.subarray(2));',
    '  process.stderr.write(bytes.subarray(2));',
    '}, 30);',
  ].join(' ');
  const result = await service.spawnProcess(process.execPath, ['-e', source], {
    timeoutMs: 15_000, engine: 'podman',
  });
  assert.equal(result.success, true, result.stderr);
  assert.equal(result.stdout, '\u20ac');
  assert.equal(result.stderr, '\u20ac');
});

test('Windows batch wrappers are rejected for Podman commands and terminals', {
  skip: process.platform !== 'win32',
}, async () => {
  const service = new PodmanService();
  const script = path.join(__dirname, 'fixtures', 'windows-argv.cmd');
  const result = await service.spawnProcess(script, ['literal & echo INJECTED'], {
    timeoutMs: 15_000,
    engine: 'podman',
  });
  assert.equal(result.success, false);
  assert.match(result.stderr, /batch wrappers.*not supported/i);
  await assert.rejects(
    () => service.spawnComposeLogProcess({ bin: script, args: [], cwd: __dirname }, 'podman'),
    /batch wrappers.*not supported/i
  );
  config.podmanPath = script;
  assert.throws(() => service.openContainerTerminal('a'.repeat(64)), /batch wrappers.*not supported/i);
  assert.throws(() => service.streamContainerLogs('a'.repeat(64)), /batch wrappers.*not supported/i);
});

test('does not retry a timed-out Compose action using a second provider', async () => {
  const service = new PodmanService();
  const calls = [];
  service.spawnProcess = async (...args) => {
    calls.push(args);
    return failed('timed out', 'ETIMEDOUT');
  };
  const result = await service.runComposeCommand(path.resolve('compose.yaml'), ['up', '-d']);
  assert.equal(result.success, false);
  assert.equal(calls.length, 1);
});

test('falls back to podman compose only when podman-compose is missing', async () => {
  const service = new PodmanService();
  const calls = [];
  service.spawnProcess = async (bin, args) => {
    calls.push({ bin, args });
    return calls.length === 1 ? failed('not found', 'ENOENT') : ok();
  };
  const result = await service.runComposeCommand(path.resolve('compose.yaml'), ['up', '-d']);
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].bin, 'podman');
  assert.equal(calls[1].args[0], 'compose');
});

test('does not force-remove Podman volumes, networks or images by default', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return ok();
  };
  await service.removeVolume('studio-test');
  await service.removeNetwork('studio-test');
  await service.removeImage('studio-test');
  for (const args of calls) {
    assert.equal(args.includes('-f'), false, args.join(' '));
  }
});

test('uses a supported Podman build-cache prune command', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return args.includes('--help') ? ok('--build-cache') : ok();
  };
  await service.pruneBuilderCache();
  assert.deepEqual(calls.at(-1), ['image', 'prune', '--build-cache', '-f']);
});

test('surfaces a failed container query rather than reporting an empty list', async () => {
  const service = new PodmanService();
  service.runEngineCommand = async () => failed('cannot connect to Podman');
  await assert.rejects(() => service.listAllContainers(), /cannot connect to Podman/);
});

test('surfaces failed or empty Podman dashboard queries', async () => {
  const service = new PodmanService();
  service.getComposeVersionString = async () => '';
  service.runEngineCommand = async (args) => {
    if (args[0] === 'version') return failed('version unavailable');
    return ok(args[0] === 'pod' ? '[]' : '{}');
  };
  await assert.rejects(() => service.getSystemInfo(), /version unavailable/);
  service.runEngineCommand = async (args) => {
    if (args[0] === 'info') return ok('');
    if (args[0] === 'version') return ok('{"Client":{"Version":"6.1"}}');
    return ok('[]');
  };
  await assert.rejects(() => service.getSystemInfo(), /empty system information/i);
});

test('reports the configured Podman Compose provider rather than an unrelated executable', async () => {
  const service = new PodmanService();
  const calls = [];
  service.spawnProcess = async (bin) => {
    calls.push(bin);
    return failed('missing', 'ENOENT');
  };
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return ok('plugin version');
  };
  config.composeCommandStyle = 'plugin';
  config.composePath = 'ignored-compose';
  assert.equal(await service.getComposeVersionString('podman'), 'plugin version');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['compose', 'version']);

  calls.length = 0;
  config.composeCommandStyle = 'auto';
  config.composePath = '';
  assert.equal(await service.getComposeVersionString('podman'), 'plugin version');
  assert.equal(calls[0], 'podman-compose');
  assert.equal(calls.length, 2);

  calls.length = 0;
  config.composePath = 'explicit-compose';
  assert.equal(await service.getComposeVersionString('podman'), '');
  assert.deepEqual(calls, ['explicit-compose']);
});

test('Podman-specific commands retain the Podman engine when settings change', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return ok();
  };
  config.engine = 'docker';
  await service.runPodmanCommand(['info']);
  assert.equal(calls[0].options.engineOverride, 'podman');

  config.engine = 'podman';
  service.composePs = async () => {
    config.engine = 'docker';
    return [{ service: 'app', fullId: 'a'.repeat(64) }];
  };
  await service.composeRemoveServices(path.resolve('compose.yaml'), ['app']);
  assert.equal(calls[1].options.engineOverride, 'podman');
});

test('does not match Compose containers from another file in the same directory', async () => {
  const service = new PodmanService();
  const directory = path.resolve('fixtures');
  const common = {
    id: '123456789abc',
    fullId: '123456789abcdef',
    name: 'other-app',
    image: 'example:latest',
    state: 'running',
    portMappings: [],
    status: 'running',
    podId: '',
    podName: '',
    isInfra: false,
    composeService: 'app',
    composeProject: 'different-project',
  };
  service.listAllContainers = async () => [
    { ...common, composeFile: path.join(directory, 'other.yaml') },
  ];
  service.runComposeCommand = async () => ok(`${common.id}\n`);
  const statuses = await service.composePs(
    path.join(directory, 'compose.yaml'),
    { name: 'target-project', services: { app: {} } }
  );
  assert.deepEqual(statuses, []);
});

test('only matches Compose containers belonging to the selected project', async () => {
  const service = new PodmanService();
  const composeFile = path.resolve('fixtures', 'compose.yaml');
  service.listAllContainers = async () => [{
    id: '123456789abc',
    fullId: '123456789abcdef0',
    name: 'other-app',
    image: 'example:latest',
    state: 'running',
    portMappings: [],
    status: 'running',
    podId: '',
    podName: '',
    isInfra: false,
    composeService: 'app',
    composeProject: 'other-project',
    composeFile,
  }];
  service.runComposeCommand = async () => ok('abcdef0123456789\n');
  assert.deepEqual(
    await service.composePs(composeFile, { name: 'target-project', services: { app: {} } }),
    []
  );
});

test('requests stopped Compose containers when the provider supports --all', async () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'plugin';
  const composeFile = path.resolve('fixtures', 'compose.yaml');
  const id = 'a'.repeat(64);
  service.listAllContainers = async () => [{
    id: id.slice(0, 12),
    fullId: id,
    name: 'project-app-1',
    image: 'example:latest',
    state: 'exited',
    portMappings: [],
    status: 'Exited',
    isInfra: false,
    composeService: 'app',
    composeProject: 'project',
    composeFile,
  }];
  const calls = [];
  service.runComposeCommand = async (_file, args, _timeout, projectName) => {
    calls.push({ args, projectName });
    return ok(`${id.slice(0, 12)}\n`);
  };
  const statuses = await service.composePs(composeFile, undefined, 'project');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, 'exited');
  assert.deepEqual(calls, [{ args: ['ps', '--all', '-q'], projectName: 'project' }]);
});

test('uses podman-compose ps without --all only after identifying the provider', async () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'plugin';
  const composeFile = path.resolve('fixtures', 'compose.yaml');
  const id = 'b'.repeat(64);
  service.listAllContainers = async () => [{
    id: id.slice(0, 12),
    fullId: id,
    name: 'project-app-1',
    image: 'example:latest',
    state: 'exited',
    portMappings: [],
    status: 'Exited',
    isInfra: false,
    composeService: 'app',
    composeProject: 'project',
    composeFile,
  }];
  const calls = [];
  service.runComposeCommand = async (_file, args, _timeout, projectName) => {
    calls.push({ args, projectName });
    if (args.includes('--all')) return failed('podman-compose: error: unrecognized arguments: --all');
    if (args[0] === 'version') return ok('podman version 6.1.4\npodman-compose version 1.6.0\n');
    return ok(`${id.slice(0, 12)}\n`);
  };
  const statuses = await service.composePs(composeFile, undefined, 'project');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, 'exited');
  assert.deepEqual(calls, [
    { args: ['ps', '--all', '-q'], projectName: 'project' },
    { args: ['version'], projectName: 'project' },
    { args: ['ps', '-q'], projectName: 'project' },
  ]);
});

test('does not silently omit stopped containers for an unknown Compose provider', async () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'plugin';
  service.listAllContainers = async () => [];
  const calls = [];
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    if (args.includes('--all')) return failed('error: unrecognized arguments: --all');
    if (args[0] === 'version') return ok('Other Compose version 1.0');
    throw new Error('an unsafe fallback must not be used');
  };
  await assert.rejects(() => service.composePs(composeFixture), /cannot safely list stopped containers/i);
  assert.deepEqual(calls, [['ps', '--all', '-q'], ['version']]);
});

test('reports Compose status errors without probing a fallback', async () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'plugin';
  service.listAllContainers = async () => [];
  const calls = [];
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    return failed('provider connection failed');
  };
  await assert.rejects(() => service.composePs(composeFixture), /provider connection failed/i);
  assert.deepEqual(calls, [['ps', '--all', '-q']]);
});

test('does not probe a Compose fallback after a timed-out status query', async () => {
  const service = new PodmanService();
  config.composeCommandStyle = 'plugin';
  service.listAllContainers = async () => [];
  const calls = [];
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    return failed('unrecognized arguments: --all\nExecution timed out', 'ETIMEDOUT');
  };
  await assert.rejects(() => service.composePs(composeFixture), /timed out/i);
  assert.deepEqual(calls, [['ps', '--all', '-q']]);
});

test('queries the default podman-compose provider without a redundant --all probe', async () => {
  const service = new PodmanService();
  service.listAllContainers = async () => [];
  const calls = [];
  let resolveVersion;
  const version = new Promise((resolve) => { resolveVersion = resolve; });
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    if (args[0] === 'version') return version;
    if (args.join(' ') === 'ps -q') return ok();
    throw new Error('an extra all-container probe should not be needed');
  };
  const status = service.composePs(composeFixture);
  assert.deepEqual(calls, [['version'], ['ps', '-q']]);
  resolveVersion(ok('podman-compose version 1.6.0'));
  assert.deepEqual(await status, []);
});

test('reports a failed default podman-compose status without retrying it', async () => {
  const service = new PodmanService();
  service.listAllContainers = async () => [];
  const calls = [];
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    if (args[0] === 'version') return ok('podman-compose version 1.6.0');
    return failed('status query timed out', 'ETIMEDOUT');
  };
  await assert.rejects(() => service.composePs(composeFixture), /status query timed out/i);
  assert.deepEqual(calls, [['version'], ['ps', '-q']]);
});

test('uses --all for an auto-detected provider other than podman-compose', async () => {
  const service = new PodmanService();
  const composeFile = path.resolve('fixtures', 'compose.yaml');
  const id = 'c'.repeat(64);
  service.listAllContainers = async () => [{
    id: id.slice(0, 12), fullId: id, name: 'project-app-1', image: 'example',
    state: 'exited', portMappings: [], status: 'Exited', isInfra: false,
    composeService: 'app', composeProject: 'project', composeFile,
  }];
  const calls = [];
  service.runComposeCommand = async (_file, args) => {
    calls.push(args);
    if (args[0] === 'version') return ok('Other Compose version 2.0');
    if (args.includes('--all')) return ok(`${id.slice(0, 12)}\n`);
    return ok();
  };
  const statuses = await service.composePs(composeFile);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, 'exited');
  assert.deepEqual(calls, [['version'], ['ps', '-q'], ['ps', '--all', '-q']]);
});

test('rejects malformed Podman list output', async () => {
  const service = new PodmanService();
  service.runEngineCommand = async () => ok('not JSON');
  await assert.rejects(() => service.listAllContainers(), /invalid JSON/i);
  service.runEngineCommand = async () => ok('["not a resource"]');
  await assert.rejects(() => service.listAllContainers(), /invalid JSON/i);
});

test('rejects malformed Compose project IDs even when no containers are listed', async () => {
  const service = new PodmanService();
  service.listAllContainers = async () => [];
  service.runComposeCommand = async () => ok('unexpected provider output\n');
  await assert.rejects(() => service.composePs(path.resolve('compose.yaml')), /invalid container ID/i);
});

test('scaling down removes only the highest-numbered replicas of the selected service', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
  const items = ids.map((fullId, index) => ({
    fullId,
    service: index === 3 ? 'other' : 'app',
    replica: index + 1,
  }));
  service.runComposeCommand = async () => ok('compose complete');
  const calls = [];
  service.composePs = async (...args) => {
    calls.push({ kind: 'status', args });
    return calls.filter((call) => call.kind === 'status').length <= 2
      ? items
      : items.filter((item) => item.fullId !== ids[2]);
  };
  service.runEngineCommand = async (args, options) => {
    calls.push({ kind: 'remove', args, options });
    return ok('removed');
  };
  const result = await service.composeScale(composeFixture, 'app', 2, 'project');
  assert.equal(result.success, true);
  const removal = calls.find((call) => call.kind === 'remove');
  assert.deepEqual(removal.args, ['container', 'rm', '-f', ids[2]]);
  assert.equal(removal.options.engineOverride, 'podman');
  assert.ok(calls.filter((call) => call.kind === 'status').every((call) => call.args[2] === 'project'));
});

test('scaling refuses ambiguous replicas and changed settings before deleting anything', async () => {
  const service = new PodmanService();
  service.runComposeCommand = async () => ok();
  service.runEngineCommand = async () => {
    throw new Error('unsafe scaling must not remove containers');
  };
  service.composePs = async () => [
    { service: 'app', fullId: 'a'.repeat(64), replica: 1 },
    { service: 'app', fullId: 'b'.repeat(64) },
  ];
  await assert.rejects(() => service.composeScale(composeFixture, 'app', 1), /cannot safely identify/i);
  await assert.rejects(() => service.composeScale(composeFixture, 'app', -1), /non-negative integer/i);
  service.composePs = async () => {
    config.composePath = 'different-provider';
    return [];
  };
  await assert.rejects(() => service.composeScale(composeFixture, 'app', 0), /settings or file changed/i);
});

test('scaling refuses replicas that changed since confirmation', async () => {
  const service = new PodmanService();
  service.composePs = async () => [
    { service: 'app', fullId: 'a'.repeat(64), replica: 1 },
    { service: 'app', fullId: 'b'.repeat(64), replica: 2 },
  ];
  service.runComposeCommand = async () => {
    throw new Error('stale confirmation must not execute Compose');
  };
  await assert.rejects(
    () => service.composeScale(composeFixture, 'app', 1, undefined, ['a'.repeat(64)]),
    /replicas changed/i
  );
});

test('scaling to zero removes only the selected service without invoking Compose up', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  const items = ids.map((fullId, index) => ({
    fullId,
    service: index === 2 ? 'other' : 'app',
  }));
  let queries = 0;
  service.composePs = async () => ++queries === 1 ? items : [items[2]];
  service.runComposeCommand = async () => {
    throw new Error('scale-to-zero must not invoke Compose up');
  };
  let removal;
  service.runEngineCommand = async (args, options) => {
    removal = { args, options };
    return ok('removed');
  };
  const result = await service.composeScale(composeFixture, 'app', 0, 'project', ids.slice(0, 2));
  assert.equal(result.success, true);
  assert.deepEqual(removal.args, ['container', 'rm', '-f', ...ids.slice(0, 2)]);
  assert.equal(removal.options.engineOverride, 'podman');
});

test('scaling refuses a Compose file changed during confirmation or status checks', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scale-'));
  const file = path.join(dir, 'compose.yaml');
  fs.writeFileSync(file, 'services: {}\n');
  t.after(() => {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  });
  const service = new PodmanService();
  service.runComposeCommand = async () => {
    throw new Error('changed Compose files must not execute');
  };
  service.runEngineCommand = async () => {
    throw new Error('changed Compose files must not remove containers');
  };
  await assert.rejects(
    () => service.composeScale(file, 'app', 0, undefined, [], 'different content'),
    /file changed/i
  );
  service.composePs = async () => {
    fs.writeFileSync(file, 'services:\n  app: {}\n');
    return [];
  };
  await assert.rejects(() => service.composeScale(file, 'app', 0), /file changed/i);
});

test('registry login and logout target the requested engine', async () => {
  const service = new PodmanService();
  const calls = [];
  config.engine = 'docker';
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return ok();
  };
  await service.loginRegistry('registry.example', 'user', 'secret', 'podman');
  await service.logoutRegistry('registry.example', 'podman');
  assert.equal(calls[0].options.engineOverride, 'podman');
  assert.equal(calls[0].options.stdin, 'secret');
  assert.equal(calls[1].options.engineOverride, 'podman');
});

test('a failed registry logout preserves stored credentials', async () => {
  const { disconnectRegistryCredentials } = require('./podman-harness.cjs')
    .loadModule(path.join('src', 'extension.ts'));
  const calls = [];
  const secrets = { delete: async (key) => { calls.push(['delete', key]); } };
  const podman = { logoutRegistry: async (...args) => {
    calls.push(['logout', ...args]);
    return failed('registry unavailable');
  } };
  await assert.rejects(
    () => disconnectRegistryCredentials(podman, secrets, 'registry.example', 'podman', true),
    /registry unavailable/
  );
  assert.deepEqual(calls, [['logout', 'registry.example', 'podman']]);
  podman.logoutRegistry = async (...args) => {
    calls.push(['logout', ...args]);
    return ok();
  };
  await disconnectRegistryCredentials(podman, secrets, 'registry.example', 'podman', true);
  assert.equal(calls.at(-1)[0], 'delete');
});

test('batch operations deduplicate IDs and report failures without skipping later targets', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  service.listAllContainers = async () =>
    ids.map((fullId, index) => ({ fullId, name: `container-${index}`, isInfra: false }));
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return args[2] === ids[1] ? failed('cannot start') : ok();
  };
  const results = await service.runPodmanBatch('container', 'start', [...ids, ids[0]]);
  assert.deepEqual(results.map((item) => item.result.success), [true, false, true]);
  assert.deepEqual(calls.map((call) => call.args), ids.map((id) => ['container', 'start', id]));
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
});

test('rejects invalid, missing, and infra batch targets before running any action', async () => {
  const service = new PodmanService();
  const good = 'a'.repeat(64);
  const infra = 'b'.repeat(64);
  service.listAllContainers = async () => [
    { fullId: good, name: 'good', isInfra: false },
    { fullId: infra, name: 'infra', isInfra: true },
  ];
  service.runEngineCommand = async () => {
    throw new Error('an invalid batch must not execute');
  };
  await assert.rejects(() => service.runPodmanBatch('container', 'stop', [good, infra]), /cannot be managed/i);
  await assert.rejects(() => service.runPodmanBatch('container', 'stop', [good, 'c'.repeat(64)]), /no longer exists/i);
  await assert.rejects(() => service.runPodmanBatch('container', 'stop', ['--all']), /invalid/i);
  config.engine = 'docker';
  await assert.rejects(() => service.runPodmanBatch('container', 'stop', [good]), /require Podman/i);
});

test('pause and resume use Podman container and pod commands', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return ok();
  };
  await service.pauseContainer('container-id');
  await service.unpauseContainer('container-id');
  await service.pausePod('pod-id');
  await service.unpausePod('pod-id');
  assert.deepEqual(calls.map((call) => call.args), [
    ['container', 'pause', 'container-id'],
    ['container', 'unpause', 'container-id'],
    ['pod', 'pause', 'pod-id'],
    ['pod', 'unpause', 'pod-id'],
  ]);
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
});

test('pod logs skip infra containers and report per-container failures', async () => {
  const service = new PodmanService();
  const infra = 'a'.repeat(64);
  const first = 'b'.repeat(64);
  const second = 'c'.repeat(64);
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'pod') {
      return ok(JSON.stringify({
        CreateInfra: true,
        InfraContainerID: infra,
        Containers: [
          { Id: infra, Name: 'infra' },
          { Id: first, Name: 'app' },
          { Id: second, Name: 'worker' },
        ],
      }));
    }
    return args[3] === second ? failed('log unavailable') : ok('ready\n');
  };
  const result = await service.getPodLogs('pod-id', 42);
  assert.equal(result.success, false);
  assert.equal(result.stdout, '[app] ready');
  assert.match(result.stderr, /worker: log unavailable/);
  assert.deepEqual(calls.map((call) => call.args), [
    ['pod', 'inspect', 'pod-id', '--format', 'json'],
    ['logs', '--tail', '42', first],
    ['logs', '--tail', '42', second],
  ]);
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
});

test('pod logs reject malformed inspection instead of returning empty output', async () => {
  const service = new PodmanService();
  service.runEngineCommand = async () => ok('{"CreateInfra":true,"Containers":[]}');
  await assert.rejects(() => service.getPodLogs('pod-id'), /missing infra container ID/i);
  service.runEngineCommand = async () => ok('not JSON');
  await assert.rejects(() => service.getPodLogs('pod-id'), /invalid.*JSON/i);
});

test('Compose log streaming falls back only when the standalone provider is missing', async () => {
  const service = new PodmanService();
  service.getPodmanComposeTargets = async () => ({ containers: [] });
  const calls = [];
  const child = {};
  service.spawnComposeLogProcess = async (invocation) => {
    calls.push(invocation);
    if (calls.length === 1) {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }
    return child;
  };
  assert.deepEqual(await service.streamComposeLogs(path.resolve('compose.yaml'), 'app'), [
    { process: child },
  ]);
  assert.equal(calls[0].bin, 'podman-compose');
  assert.equal(calls[1].bin, 'podman');
  assert.equal(calls[1].args[0], 'compose');

  calls.length = 0;
  service.spawnComposeLogProcess = async (invocation) => {
    calls.push(invocation);
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  };
  await assert.rejects(() => service.streamComposeLogs(path.resolve('compose.yaml'), 'app'), /permission denied/);
  assert.equal(calls.length, 1);
});

test('scaled Compose lifecycle commands include every replica but exclude orphan services', async () => {
  const service = new PodmanService();
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  service.composePs = async () => ids.map((fullId, index) => ({
    fullId, name: `replica-${index}`, service: index < 2 ? 'app' : 'orphan', replica: index + 1,
  }));
  service.runComposeCommand = async (file, args) => {
    if (args[0] === 'config') return ok(fs.readFileSync(file, 'utf8'));
    throw new Error('Scaled lifecycle actions must not rely on YAML-expanded names');
  };
  const calls = [];
  service.runEngineCommand = async (args, options) => {
    calls.push({ args, options });
    return ok();
  };
  await service.composeStop(composeFixture, ['app']);
  await service.composeStart(composeFixture, ['app']);
  await service.composeRestart(composeFixture, ['app']);
  assert.deepEqual(calls.map((call) => call.args), [
    ['container', 'stop', ids[0]], ['container', 'stop', ids[1]],
    ['container', 'start', ids[0]], ['container', 'start', ids[1]],
    ['container', 'restart', ids[0]], ['container', 'restart', ids[1]],
  ]);
  assert.ok(calls.every((call) => call.options.engineOverride === 'podman'));
});

test('scaled Compose lifecycle commands honor the configured stop grace period', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-grace-'));
  const file = path.join(dir, 'compose.yaml');
  fs.writeFileSync(file, 'services:\n  app:\n    image: example\n    stop_grace_period: 1m500ms\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const service = new PodmanService();
  service.runComposeCommand = async (composeFile) => ok(fs.readFileSync(composeFile, 'utf8'));
  service.composePs = async () => [
    { fullId: 'a'.repeat(64), name: 'app-2', service: 'app', replica: 2 },
  ];
  const calls = [];
  service.runEngineCommand = async (args) => { calls.push(args); return ok(); };
  await service.composeStop(file);
  assert.deepEqual(calls, [['container', 'stop', '--time', '61', 'a'.repeat(64)]]);
  fs.writeFileSync(file, 'services:\n  app:\n    stop_grace_period: invalid\n');
  await assert.rejects(() => service.composeStop(file), /Unsupported.*stop_grace_period/i);
  assert.equal(calls.length, 1);
});

test('scaled Compose logs follow all replicas using explicit container IDs', async () => {
  const service = new PodmanService();
  service.runComposeCommand = async (file) => ok(fs.readFileSync(file, 'utf8'));
  const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  service.composePs = async () => ids.map((fullId, index) => ({
    fullId, name: `replica-${index}`, service: index < 2 ? 'app' : 'orphan', replica: index + 1,
  }));
  const invocations = [];
  const children = [{}, {}];
  service.spawnComposeLogProcess = async (value, engine) => {
    invocations.push({ value, engine });
    return children[invocations.length - 1];
  };
  assert.deepEqual(await service.streamComposeLogs(composeFixture, 'app', 42),
    children.map((process, index) => ({ process, containerName: `replica-${index}` }))
  );
  assert.ok(invocations.every((invocation) => invocation.engine === 'podman'));
  assert.ok(invocations.every((invocation) => invocation.value.bin === 'podman'));
  assert.deepEqual(invocations.map((invocation) => invocation.value.args), ids.slice(0, 2).map((id) =>
    ['logs', '-f', '--tail', '42', id]
  ));
});

test('a failed replica log startup terminates every process that already started', async () => {
  const service = new PodmanService();
  service.getPodmanComposeTargets = async () => ({
    containers: [{ fullId: 'a'.repeat(64) }, { fullId: 'b'.repeat(64) }],
  });
  let killed = false;
  const child = { kill: () => { killed = true; } };
  service.spawnComposeLogProcess = async (value) => {
    if (value.args.at(-1) === 'b'.repeat(64)) throw new Error('spawn denied');
    return child;
  };
  await assert.rejects(() => service.streamComposeLogs(composeFixture, 'app'), /spawn denied/);
  assert.equal(killed, true);
});

test('Compose Down cleans replicas left by the provider without removing orphan services', async () => {
  const service = new PodmanService();
  const app1 = { fullId: 'a'.repeat(64), name: 'app-1', service: 'app', replica: 1 };
  const app2 = { fullId: 'b'.repeat(64), name: 'app-2', service: 'app', replica: 2 };
  const orphan = { fullId: 'c'.repeat(64), name: 'orphan', service: 'orphan', replica: 1 };
  let queries = 0;
  service.composePs = async () => {
    queries++;
    return queries === 1 ? [app1, app2, orphan] : queries === 2 ? [app2, orphan] : [orphan];
  };
  const calls = [];
  service.runComposeCommand = async (_file, args, _timeout, project) => {
    if (args[0] === 'config') return ok(fs.readFileSync(_file, 'utf8'));
    calls.push({ provider: args, project });
    return ok();
  };
  service.runEngineCommand = async (args, options) => {
    calls.push({ engine: args, target: options.engineOverride });
    return ok();
  };
  const result = await service.composeDown(composeFixture, { projectName: 'project' });
  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    { provider: ['down'], project: 'project' },
    { engine: ['container', 'stop', app2.fullId], target: 'podman' },
    { engine: ['container', 'rm', app2.fullId], target: 'podman' },
    { provider: ['down'], project: 'project' },
  ]);
});

test('Compose Down refuses unexpected containers and does not retry failed operations', async () => {
  const service = new PodmanService();
  const first = { fullId: 'a'.repeat(64), name: 'app-1', service: 'app', replica: 1 };
  let queries = 0;
  service.composePs = async () => [{ ...first, fullId: (++queries === 1 ? 'a' : 'b').repeat(64) }];
  service.runComposeCommand = async (file, args) =>
    args[0] === 'config' ? ok(fs.readFileSync(file, 'utf8')) : ok();
  service.runEngineCommand = async () => {
    throw new Error('Changed containers must not be deleted automatically');
  };
  await assert.rejects(() => service.composeDown(composeFixture), /containers changed during Down/i);
  queries = 0;
  let commands = 0;
  service.runComposeCommand = async (file, args) => {
    if (args[0] === 'config') return ok(fs.readFileSync(file, 'utf8'));
    commands++;
    return failed('provider timed out', 'ETIMEDOUT');
  };
  const result = await service.composeDown(composeFixture);
  assert.equal(result.success, false);
  assert.equal(queries, 1);
  assert.equal(commands, 1);
});

test('Compose Down guards settings and preserves failures during leftover cleanup', async () => {
  const service = new PodmanService();
  service.composePs = async () => [
    { fullId: 'a'.repeat(64), name: 'app-2', service: 'app', replica: 2 },
  ];
  service.runComposeCommand = async (file, args) => {
    if (args[0] === 'config') return ok(fs.readFileSync(file, 'utf8'));
    config.podmanPath = 'different-podman';
    return ok();
  };
  service.runEngineCommand = async () => {
    throw new Error('Changed settings must prevent fallback deletion');
  };
  await assert.rejects(() => service.composeDown(composeFixture), /settings or file changed/i);
  config.podmanPath = 'podman';
  service.runComposeCommand = async (file, args) =>
    args[0] === 'config' ? ok(fs.readFileSync(file, 'utf8')) : ok();
  const calls = [];
  service.runEngineCommand = async (args) => {
    calls.push(args);
    return failed('stop denied');
  };
  const result = await service.composeDown(composeFixture);
  assert.equal(result.success, false);
  assert.equal(result.stderr, 'stop denied');
  assert.deepEqual(calls, [['container', 'stop', 'a'.repeat(64)]]);
});

test('Compose Down removes anonymous volumes and orphan replicas only when explicitly requested', async () => {
  const service = new PodmanService();
  let queries = 0;
  service.composePs = async () => ++queries < 3 ? [
    { fullId: 'c'.repeat(64), name: 'orphan', service: 'orphan', replica: 2 },
  ] : [];
  const providerArgs = [];
  service.runComposeCommand = async (file, args) => {
    if (args[0] === 'config') return ok(fs.readFileSync(file, 'utf8'));
    providerArgs.push(args);
    return ok();
  };
  const calls = [];
  service.runEngineCommand = async (args) => { calls.push(args); return ok(); };
  assert.equal((await service.composeDown(composeFixture, {
    removeVolumes: true, removeOrphans: true,
  })).success, true);
  assert.deepEqual(providerArgs, [
    ['down', '-v', '--remove-orphans'], ['down', '-v', '--remove-orphans'],
  ]);
  assert.deepEqual(calls, [
    ['container', 'stop', 'c'.repeat(64)],
    ['container', 'rm', '-v', 'c'.repeat(64)],
  ]);
});

test('terminal commands pass executable paths and IDs as arguments, not shell text', async (t) => {
  const original = vscode.window.createTerminal;
  t.after(() => { vscode.window.createTerminal = original; });
  const terminals = [];
  vscode.window.createTerminal = (options) => {
    terminals.push(options);
    return { show() {} };
  };
  config.podmanPath = `${path.join('C:', 'Program Files', 'Podman', 'podman.exe')} --remote`;
  const service = new PodmanService();
  const id = 'container;not-a-shell-command';
  service.openContainerTerminal(id);
  await service.openLogsExternal(id, undefined, 'terminal');
  assert.equal(terminals[0].shellPath, path.join('C:', 'Program Files', 'Podman', 'podman.exe'));
  assert.deepEqual(terminals[0].shellArgs, ['--remote', 'exec', '-it', id, '/bin/sh']);
  assert.deepEqual(terminals[1].shellArgs, ['--remote', 'logs', '-f', id]);
});
