const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { config, loadService } = require('./podman-harness.cjs');

const PodmanService = loadService();
const file = path.resolve('tests', 'fixtures', 'compose-project-name.yaml');
const ok = { success: true, stdout: '', stderr: '', exitCode: 0 };

test.beforeEach(() => {
  Object.assign(config, {
    engine: 'podman', podmanPath: 'podman', dockerPath: 'docker',
    composePath: '', composeCommandStyle: 'auto', inPod: 'default',
  });
});

test('build and no-cache rebuild do not start services; build-and-up is explicit', async () => {
  const service = new PodmanService();
  const calls = [];
  service.runComposeCommand = async (target, args) => { calls.push({ target, args }); return ok; };
  await service.composeBuild(file, ['app']);
  await service.composeBuild(file, ['worker'], undefined, { noCache: true });
  await service.composeBuildUp(file, ['app']);
  assert.deepEqual(calls, [
    { target: file, args: ['build', 'app'] },
    { target: file, args: ['build', '--no-cache', 'worker'] },
    { target: file, args: ['up', '-d', '--build', 'app'] },
  ]);
});

test('all Compose invocations use ordered files, profiles, and an explicit environment file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'compose.yaml');
  const first = path.join(dir, 'override one.yaml');
  const second = path.join(dir, 'override-two.yaml');
  const env = path.join(dir, 'staging.env');
  for (const target of [base, first, second, env]) fs.writeFileSync(target, '');
  const service = new PodmanService();
  service.setComposeProjectOptions(base, {
    files: [base, first, second], profiles: ['api', 'jobs'], envFile: env,
  });
  const expected = [
    '-f', path.basename(base), '-f', first, '-f', second,
    '--profile', 'api', '--profile', 'jobs', '--env-file', env, 'build', 'api',
  ];
  assert.deepEqual(service.buildComposeInvocation(base, ['build', 'api']).args.slice(-expected.length), expected);
  config.engine = 'docker';
  const docker = service.buildComposeInvocation(base, ['build', 'api']);
  assert.deepEqual(docker.args.slice(-expected.length), expected);
  assert.ok(!docker.args.includes('-p'), 'do not override the provider project name implicitly');
  assert.deepEqual(
    service.buildComposeInvocation(base, ['ps'], 'explicit').args.slice(-3),
    ['-p', 'explicit', 'ps']
  );
});

test('project snapshots include overrides, explicit and implicit env files, order and engine settings', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-revision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'compose.yaml');
  const override = path.join(dir, 'override.yaml');
  const env = path.join(dir, 'staging.env');
  const implicit = path.join(dir, '.env');
  fs.writeFileSync(base, 'services: {}');
  fs.writeFileSync(override, 'services: {}');
  fs.writeFileSync(env, 'KEY=one');
  const service = new PodmanService();
  service.setComposeProjectOptions(base, { files: [base, override], profiles: [], envFile: env });
  let revision = service.getComposeProjectRevision(base);
  fs.writeFileSync(override, 'services: {app: {image: alpine}}');
  assert.notEqual(service.getComposeProjectRevision(base), revision);
  revision = service.getComposeProjectRevision(base);
  fs.writeFileSync(env, 'KEY=two');
  assert.notEqual(service.getComposeProjectRevision(base), revision);
  revision = service.getComposeProjectRevision(base);
  fs.writeFileSync(implicit, 'DEFAULT=one');
  assert.notEqual(service.getComposeProjectRevision(base), revision);
  revision = service.getComposeProjectRevision(base);
  config.composeCommandStyle = 'plugin';
  assert.notEqual(service.getComposeProjectRevision(base), revision);
  assert.throws(() => service.setComposeProjectOptions(base, {
    files: [base, base], profiles: [],
  }), /duplicate/i);
  assert.throws(() => service.setComposeProjectOptions(base, {
    files: [base], profiles: ['--all'],
  }), /profiles/i);
});

test('project snapshots follow static include, extends, env, config and secret files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-dependencies-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sub = path.join(dir, 'child');
  fs.mkdirSync(sub);
  const base = path.join(dir, 'compose.yaml');
  const included = path.join(sub, 'compose.yaml');
  const nested = path.join(sub, 'nested.yaml');
  const env = path.join(dir, 'app.env');
  const optional = path.join(dir, 'optional.env');
  const extension = path.join(dir, 'extends.yaml');
  const secret = path.join(dir, 'secret.txt');
  const configuration = path.join(dir, 'config.txt');
  fs.writeFileSync(base, [
    'include: [child/compose.yaml]',
    'services:',
    '  app:',
    '    extends: {file: extends.yaml, service: shared}',
    '    env_file:',
    '      - app.env',
    '      - {path: optional.env, required: false}',
    'configs:',
    '  settings: {file: config.txt}',
    'secrets:',
    '  token: {file: secret.txt}',
  ].join('\n'));
  fs.writeFileSync(included, 'include: [nested.yaml]\nservices: {}\n');
  fs.writeFileSync(nested, 'services: {}\n');
  fs.writeFileSync(extension, 'services:\n  shared:\n    image: alpine\n');
  fs.writeFileSync(env, 'VALUE=one\n');
  fs.writeFileSync(secret, 'secret-one\n');
  fs.writeFileSync(configuration, 'config-one\n');
  const service = new PodmanService();
  const watched = service.getComposeProjectWatchedFiles(base);
  for (const target of [base, included, nested, env, optional, extension, secret, configuration]) {
    assert.ok(watched.includes(target), `missing dependency ${target}`);
  }
  assert.equal(service.hasCustomComposeProject(base), true);
  assert.equal(service.getComposeProjectDependencies(base).incomplete, false);
  const snapshot = service.getComposeProjectSnapshot(base);
  assert.equal(snapshot.customized, true);
  assert.equal(snapshot.revision, service.getComposeProjectRevision(base));
  assert.deepEqual(snapshot.dependencies.files.map((entry) => entry.path), watched);
  for (const [file, value] of [
    [nested, 'services: {worker: {image: redis}}\n'],
    [env, 'VALUE=two\n'],
    [secret, 'secret-two\n'],
    [configuration, 'config-two\n'],
    [optional, 'OPTIONAL=now-present\n'],
  ]) {
    const revision = service.getComposeProjectRevision(base);
    fs.writeFileSync(file, value);
    assert.notEqual(service.getComposeProjectRevision(base), revision, file);
  }
  const before = fs.statSync(env);
  const revision = service.getComposeProjectRevision(base);
  fs.writeFileSync(env, 'VALUE=six\n');
  fs.utimesSync(env, before.atime, before.mtime);
  assert.notEqual(service.getComposeProjectRevision(base), revision,
    'same-size changes with unchanged timestamps must still change the snapshot');
  fs.writeFileSync(nested, 'include: [compose.yaml]\nservices: {}\n');
  assert.doesNotThrow(() => service.getComposeProjectRevision(base), 'cyclic references must terminate');
});

test('unresolved paths are explicitly identified rather than treated as tracked', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-dynamic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'compose.yaml');
  fs.writeFileSync(base, 'services:\n  app:\n    image: alpine\n    env_file: ${ENV_PATH}\n');
  const service = new PodmanService();
  assert.equal(service.getComposeProjectDependencies(base).incomplete, true);
  assert.doesNotThrow(() => service.getComposeProjectRevision(base));
});

test('provider configuration failures are surfaced and never treated as an empty project', async () => {
  const service = new PodmanService();
  service.runComposeCommand = async () => ({
    success: false, stdout: '', stderr: 'unsupported --profile', exitCode: 2,
  });
  await assert.rejects(() => service.resolveComposeDocument(file), /unsupported --profile/);
  service.runComposeCommand = async () => ok;
  await assert.rejects(() => service.resolveComposeDocument(file), /services mapping/);
  service.runComposeCommand = async () => ({ ...ok, stdout: 'services:\n  web:\n    image: nginx\n' });
  assert.equal((await service.resolveComposeDocument(file)).services.web.image, 'nginx');
});

test('replica removal refuses an override changed during the project safety check', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = path.join(dir, 'compose.yaml');
  const override = path.join(dir, 'override.yaml');
  fs.writeFileSync(base, 'services:\n  app:\n    image: alpine\n');
  fs.writeFileSync(override, 'services: {}\n');
  const service = new PodmanService();
  service.setComposeProjectOptions(base, { files: [base, override], profiles: [] });
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  service.composePs = async () => { await waiting; return []; };
  service.runComposeCommand = async () => ({ ...ok, stdout: fs.readFileSync(base, 'utf8') });
  service.runEngineCommand = async () => { throw new Error('must not remove containers'); };
  const removing = service.composeRemoveServices(base, ['app']);
  fs.writeFileSync(override, 'services:\n  app:\n    image: redis\n');
  release();
  await assert.rejects(removing, /changed/i);
});
