const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { createVisualServiceDraft, applyVisualServiceDraft } =
  loadModule('src/shared/composeVisualEdit.ts');
const { YamlService } = loadModule('src/services/yamlService.ts');
const yaml = new YamlService();

test('visual service changes preserve other fields, comments, anchors and scalar types', () => {
  const content = [
    'x-defaults: &common',
    '  labels: {owner: test}',
    'services:',
    '  app: &app',
    '    <<: *common',
    '    image: "example:v1" # image comment',
    '    build:',
    '      context: .',
    '      args: {KEEP: "yes"} # keep advanced build',
    '    environment:',
    '      FLAG: "false" # keep flag type',
    '      COUNT: "0123"',
    '    ports: ["8080:80"]',
    '    x-extra: {keep: true} # keep extension',
    '  worker:',
    '    <<: *app',
    '',
  ].join('\n');
  const draft = createVisualServiceDraft(yaml.serviceFragment(content, 'app'));
  draft.values.image = 'example:v2';
  draft.values.buildContext = './app';
  draft.values.environment += '\nNEW=value';
  draft.values.ports += '\n8443:443';
  const updated = yaml.updateServiceInYaml(content, 'app', applyVisualServiceDraft(draft));
  const doc = yaml.parse(updated);
  assert.equal(doc.services.app.image, 'example:v2');
  assert.equal(doc.services.app.environment.FLAG, 'false');
  assert.equal(doc.services.app.environment.COUNT, '0123');
  assert.equal(doc.services.app.environment.NEW, 'value');
  assert.deepEqual(doc.services.app.ports, ['8080:80', '8443:443']);
  assert.equal(doc.services.worker.build.args.KEEP, 'yes');
  for (const comment of ['# image comment', '# keep advanced build', '# keep flag type', '# keep extension']) {
    assert.ok(updated.includes(comment), comment);
  }
  assert.match(updated, /app: &app/);
  assert.match(updated, /<<: \*common/);
});

test('advanced representations are read-only and cannot be accidentally replaced', () => {
  const fragment = [
    'image: example',
    'ports:',
    '  - target: 80',
    '    published: "8080"',
    'volumes:',
    '  - type: bind',
    '    source: ./src',
    '    target: /app',
    'depends_on:',
    '  db:',
    '    condition: service_healthy',
    '',
  ].join('\n');
  const draft = createVisualServiceDraft(fragment);
  assert.equal(draft.supported.ports, false);
  assert.equal(draft.supported.volumes, false);
  assert.equal(draft.supported.dependsOn, false);
  draft.values.image = 'other';
  const updated = applyVisualServiceDraft(draft);
  assert.match(updated, /service_healthy/);
  assert.match(updated, /type: bind/);
  draft.values.ports = '9090:80';
  assert.throws(() => applyVisualServiceDraft(draft), /advanced form/i);
});

test('visual environment and dependency edits reject duplicates', () => {
  const draft = createVisualServiceDraft('image: example\n');
  draft.values.environment = 'KEY=one\nKEY=two';
  assert.throws(() => applyVisualServiceDraft(draft), /unique/i);
  draft.values.environment = '';
  draft.values.dependsOn = 'db\ndb';
  assert.throws(() => applyVisualServiceDraft(draft), /unique/i);
});

test('removing a build with advanced options requires explicit YAML editing', () => {
  const draft = createVisualServiceDraft('build:\n  context: .\n  args: {SECRET: value}\n');
  draft.values.buildContext = '';
  assert.throws(() => applyVisualServiceDraft(draft), /advanced fields/i);
});

test('an unresolved external anchor is rejected when saving the complete document', () => {
  const content = 'x-base: &base {image: example}\nservices:\n  app:\n    <<: *base\n';
  const draft = createVisualServiceDraft(yaml.serviceFragment(content, 'app'));
  draft.values.image = 'updated';
  const changedFragment = applyVisualServiceDraft(draft).replace('*base', '*missing');
  assert.throws(() => yaml.updateServiceInYaml(content, 'app', changedFragment), /alias/i);
});
