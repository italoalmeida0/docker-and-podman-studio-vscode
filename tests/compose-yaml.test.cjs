const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { YamlService, composeReferences } = loadModule('src/services/yamlService.ts');
const yaml = new YamlService();

const original = [
  '# Keep this comment',
  'x-defaults: &defaults',
  '  image: alpine:3',
  'include:',
  '  - shared.yaml',
  'services:',
  '  app: &app',
  '    <<: *defaults',
  '    environment:',
  '      FLAG: "false" # Keep this too',
  '      CODE: "0123"',
  '  worker:',
  '    <<: *app',
  '    depends_on: [app]',
  '    networks: [frontend]',
  '    volumes:',
  '      - type: volume',
  '        source: data',
  '        target: /data',
  'networks:',
  '  frontend: {}',
  'volumes:',
  '  data: {}',
  '',
].join('\n');

test('visual YAML edits retain extensions, includes, comments, anchors and scalar types', () => {
  const updated = yaml.addServiceToYaml(original, { name: 'cache', image: 'redis:7' });
  assert.match(updated, /# Keep this comment/);
  assert.match(updated, /# Keep this too/);
  assert.match(updated, /x-defaults: &defaults/);
  assert.match(updated, /app: &app/);
  assert.match(updated, /<<: \*defaults/);
  assert.match(updated, /<<: \*app/);
  assert.match(updated, /include:/);
  assert.deepEqual(yaml.parse(updated).include, ['shared.yaml']);
  assert.equal(yaml.parse(updated).services.app.environment.FLAG, 'false');
  assert.equal(yaml.parse(updated).services.app.environment.CODE, '0123');
  assert.equal(yaml.parse(updated).services.cache.image, 'redis:7');
});

test('one-pass project parsing preserves service fragments and aliases', () => {
  const parsed = yaml.parseWithServiceFragments(original);
  assert.deepEqual(parsed.document, yaml.parse(original));
  assert.deepEqual(parsed.serviceFragments, yaml.serviceFragments(original));
  assert.match(parsed.serviceFragments.app, /# Keep this too/);
  assert.equal(parsed.document.services.worker.environment.CODE, '0123');
  assert.throws(() => yaml.parseWithServiceFragments('services:\n  app: {}\n  app: {}\n'), /unique|duplicate/i);
});

test('service fragment editing preserves scalar types, comments and outer anchors', () => {
  const fragment = yaml.serviceFragment(original, 'app');
  assert.match(fragment, /FLAG: "false" # Keep this too/);
  const edited = yaml.updateServiceInYaml(original, 'app', fragment.replace('"0123"', '"0456"'));
  const parsed = yaml.parse(edited);
  assert.equal(parsed.services.app.environment.FLAG, 'false');
  assert.equal(parsed.services.app.environment.CODE, '0456');
  assert.equal(parsed.services.worker.environment.CODE, '0456');
  assert.match(edited, /app: &app/);
  assert.match(edited, /# Keep this too/);
  assert.match(edited, /x-defaults: &defaults/);
});

test('aliases cannot be left dangling by a visual edit', () => {
  const content = 'services:\n  app: &shared\n    image: alpine\n  worker: *shared\n';
  assert.throws(() => yaml.removeServiceFromYaml(content, 'app'), /alias|anchor/i);
  assert.throws(() => yaml.updateServiceInYaml(content, 'app', 'image: alpine\nextra: *missing'), /alias|anchor/i);
});

test('duplicate YAML keys and duplicate visual resource names are rejected', () => {
  assert.throws(() => yaml.parse('services:\n  app: {image: a}\n  app: {image: b}\n'), /unique|duplicate/i);
  assert.throws(() => yaml.addServiceToYaml(original, { name: 'app', image: 'other' }), /already exists/i);
  assert.throws(() => yaml.addResourceToYaml(original, 'networks', 'frontend', {}), /already exists/i);
  assert.throws(() => yaml.addServiceToYaml(original, { name: '../bad', image: 'other' }), /invalid/i);
});

test('adding a service creates missing named resources without overwriting existing definitions', () => {
  const updated = yaml.addServiceToYaml(original, {
    name: 'cache', image: 'redis', volumes: ['data:/data', 'cache:/cache'],
  }, {
    volumes: { data: { driver: 'other' }, cache: {} },
    networks: { frontend: { driver: 'other' }, backend: { driver: 'bridge' } },
  });
  const parsed = yaml.parse(updated);
  assert.deepEqual(parsed.volumes.data, {});
  assert.deepEqual(parsed.volumes.cache, {});
  assert.deepEqual(parsed.networks.frontend, {});
  assert.deepEqual(parsed.networks.backend, { driver: 'bridge' });
  assert.match(updated, /# Keep this too/);
});

test('adding resources creates absent or null YAML sections as mappings', () => {
  const content = 'services:\n  app: {image: redis}\nvolumes:\n';
  const added = yaml.addServiceToYaml(content, {
    name: 'worker', image: 'redis', volumes: ['data:/data'], networks: ['private'],
  }, {
    volumes: { data: {} }, networks: { private: {} },
  });
  const parsed = yaml.parse(added);
  assert.deepEqual(parsed.volumes, { data: {} });
  assert.deepEqual(parsed.networks, { private: {} });
  assert.deepEqual(parsed.services.worker.volumes, ['data:/data']);
  const networkAdded = yaml.addResourceToYaml('services: {}\n', 'networks', 'private', { driver: 'bridge' });
  assert.deepEqual(yaml.parse(networkAdded).networks.private, { driver: 'bridge' });
  const serviceAdded = yaml.addServiceToYaml('name: example\n', { name: 'app', image: 'redis' });
  assert.equal(yaml.parse(serviceAdded).services.app.image, 'redis');
});

test('referenced services, networks and volumes cannot be removed', () => {
  const doc = yaml.parse(original);
  assert.deepEqual(composeReferences(doc, 'service', 'app'), ['worker']);
  assert.deepEqual(composeReferences(doc, 'network', 'frontend'), ['worker']);
  assert.deepEqual(composeReferences(doc, 'volume', 'data'), ['worker']);
  assert.throws(() => yaml.removeServiceFromYaml(original, 'app'), /referenced by: worker/i);
  assert.throws(() => yaml.removeResourceFromYaml(original, 'networks', 'frontend'), /referenced by: worker/i);
  assert.throws(() => yaml.removeResourceFromYaml(original, 'volumes', 'data'), /referenced by: worker/i);
});

test('diagnostics accept extends, include, cap_add and long-form port mappings', () => {
  const content = [
    'include: [base.yaml]',
    'services:',
    '  app:',
    '    extends:',
    '      file: base.yaml',
    '      service: base',
    '    cap_add: [NET_ADMIN]',
    '    ports:',
    '      - target: 80',
    '        published: "8080"',
    '',
  ].join('\n');
  assert.deepEqual(yaml.validate(content), []);
  assert.ok(yaml.validate('services:\n  app: {}\n  app: {}\n').some((issue) => issue.severity === 'error'));
});
