const assert = require('node:assert/strict');
const test = require('node:test');
const YAML = require('yaml');
const { loadModule } = require('./podman-harness.cjs');

const { buildComposeDocument, serializeComposeBuilder, validateComposeBuilder } =
  loadModule('src/shared/composeBuilder.ts');

function service(name, overrides = {}) {
  return {
    name,
    containerName: '',
    source: 'image',
    image: 'docker.io/library/alpine:latest',
    buildContext: '.',
    buildDockerfile: 'Containerfile',
    ports: [],
    restartPolicy: 'unless-stopped',
    networkName: 'app-net',
    volumeName: '',
    volumesText: '',
    environmentText: '',
    dependsText: '',
    commandText: '',
    ...overrides,
  };
}

test('wizard preview is the serialized document with every configured service field', () => {
  const spec = { services: [
    service('app', {
      source: 'build', image: '', buildContext: './app', ports: ['8080:80'],
      environmentText: 'FLAG=false\nCODE=0123\nTOKEN= value with spaces ',
      volumesText: 'cache:/cache\n./config:/etc/app:ro\nC:\\data:/win',
      dependsText: 'db:service_healthy', commandText: 'run server',
      healthcheck: { test: 'echo "ready"', interval: '10s', timeout: '3s', retries: '4', startPeriod: '2s' },
    }),
    service('db', { image: 'postgres:16', volumeName: 'db-data' }),
  ] };
  const document = buildComposeDocument(spec);
  const preview = serializeComposeBuilder(spec);
  assert.deepEqual(YAML.parse(preview), document);
  assert.deepEqual(Object.keys(document.services), ['app', 'db']);
  assert.equal(document.services.app.image, undefined);
  assert.deepEqual(document.services.app.build, { context: './app', dockerfile: 'Containerfile' });
  assert.deepEqual(document.services.app.environment, { FLAG: 'false', CODE: '0123', TOKEN: ' value with spaces ' });
  assert.deepEqual(document.services.app.depends_on, { db: { condition: 'service_healthy' } });
  assert.deepEqual(document.services.app.healthcheck, {
    test: ['CMD-SHELL', 'echo "ready"'], interval: '10s', timeout: '3s', retries: 4, start_period: '2s',
  });
  assert.equal(document.services.app.command, 'run server');
  assert.deepEqual(Object.keys(document.volumes).sort(), ['cache', 'db-data']);
  assert.deepEqual(Object.keys(document.networks), ['app-net']);
});

test('wizard rejects duplicates, invalid dependencies, cycles and bad healthchecks', () => {
  assert.match(validateComposeBuilder({ services: [service('app'), service('app')] }).join('\n'), /duplicated/i);
  assert.match(validateComposeBuilder({ services: [service('app', { dependsText: 'missing' })] }).join('\n'), /dependency/i);
  assert.match(validateComposeBuilder({ services: [
    service('app', { dependsText: 'db' }), service('db', { dependsText: 'app' }),
  ] }).join('\n'), /cycle/i);
  assert.match(validateComposeBuilder({ services: [
    service('app', { healthcheck: { test: '', interval: '', timeout: '', retries: '-1', startPeriod: '' } }),
  ] }).join('\n'), /healthcheck/i);
  assert.throws(() => buildComposeDocument({ services: [service('app', { image: '' })] }), /requires an image/i);
});

test('wizard rejects duplicate environment keys instead of silently overwriting values', () => {
  const errors = validateComposeBuilder({ services: [service('app', { environmentText: 'KEY=one\nKEY=two' })] });
  assert.match(errors.join('\n'), /duplicate environment key/i);
});

test('adding a service accepts existing dependencies, preserves inherited environment and catches cycles', () => {
  const existing = { db: { image: 'postgres:16', container_name: 'database' } };
  const spec = { services: [service('app', {
    source: 'build', image: '', dependsText: 'db', environmentText: 'INHERITED\nEMPTY=\nTOKEN= value ',
  })] };
  assert.deepEqual(validateComposeBuilder(spec, existing), []);
  const result = buildComposeDocument(spec, existing);
  assert.deepEqual(result.services.app.environment, { INHERITED: null, EMPTY: '', TOKEN: ' value ' });
  assert.deepEqual(result.services.app.depends_on, ['db']);
  assert.equal(result.services.app.image, undefined);
  assert.match(validateComposeBuilder(spec, { db: { depends_on: ['app'] } }).join('\n'), /cycle/i);
  assert.match(validateComposeBuilder({ services: [
    service('app', { containerName: 'database' }),
  ] }, existing).join('\n'), /duplicated/i);
  assert.match(validateComposeBuilder({ services: [
    service('app', { environmentText: 'BAD KEY=value' }),
  ] }).join('\n'), /environment key/i);
});
