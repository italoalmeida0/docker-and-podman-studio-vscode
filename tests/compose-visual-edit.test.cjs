const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { createVisualServiceDraft, applyVisualServiceDraft } =
  loadModule('src/shared/composeVisualEdit.ts');
const { YamlService } = loadModule('src/services/yamlService.ts');
const { ComposeVisualError, describeComposeVisualError, formatComposeVisualMessage } =
  loadModule(path.join('src', 'shared', 'composeVisualMessages.ts'));
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

test('visual editing errors preserve their reason and follow the selected language', () => {
  const locales = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'pl', 'tr', 'nl',
    'ja', 'ko', 'zh-CN', 'zh-TW', 'hi'];
  const keys = ['directMapping', 'invalidYaml', 'invalidEnvKey', 'duplicateEnvKeys', 'staleDraft',
    'advancedField', 'invalidDependencies', 'missingBuildContext', 'advancedBuild'];
  const variables = { key: 'MY_KEY', field: 'ports' };
  for (const locale of locales) {
    for (const key of keys) {
      const english = formatComposeVisualMessage('en', key, variables);
      const message = formatComposeVisualMessage(locale, key, variables);
      assert.ok(message, `${locale}:${key}`);
      assert.doesNotMatch(message, /\{\w+\}/, `${locale}:${key}`);
      for (const value of Object.values(variables)) {
        if (english.includes(value)) assert.ok(message.includes(value), `${locale}:${key}:${value}`);
      }
      if (locale !== 'en') assert.notEqual(message, english, `${locale}:${key}`);
    }
  }
  const draft = createVisualServiceDraft('image: example\n');
  draft.values.environment = 'BAD KEY=value';
  assert.throws(() => applyVisualServiceDraft(draft), (error) => {
    assert.equal(error.name, 'ComposeVisualError');
    assert.equal(error.key, 'invalidEnvKey');
    assert.equal(error.variables.key, 'BAD KEY');
    assert.match(formatComposeVisualMessage('pt-BR', error.key, error.variables), /Chave de ambiente inválida/);
    assert.match(formatComposeVisualMessage('es', error.key, error.variables), /Clave de entorno no válida/);
    return true;
  });
});

test('invalid service YAML retains parser details and its explanation follows the language', () => {
  assert.throws(() => createVisualServiceDraft('image: [unterminated'), (error) => {
    assert.equal(error.name, 'ComposeVisualError');
    assert.equal(error.key, 'invalidYaml');
    assert.ok(error.details.length > 10);
    return true;
  });
  const error = new ComposeVisualError('invalidYaml', {}, 'Technical parser details');
  const english = describeComposeVisualError('en', error);
  const portuguese = describeComposeVisualError('pt-BR', error);
  const spanish = describeComposeVisualError('es', error);
  assert.match(english.summary, /service YAML is invalid/i);
  assert.match(portuguese.summary, /YAML do serviço é inválido/);
  assert.match(spanish.summary, /YAML del servicio no es válido/);
  for (const result of [english, portuguese, spanish]) {
    assert.equal(result.details, 'Technical parser details');
    assert.notEqual(result.summary, result.details);
  }
});

test('unexpected visual editing errors show a localized neutral summary and preserve details', () => {
  const error = new Error('Technical failure');
  const english = describeComposeVisualError('en', error);
  const portuguese = describeComposeVisualError('pt-BR', error);
  assert.match(english.summary, /something went wrong/i);
  assert.match(portuguese.summary, /algo deu errado/i);
  assert.equal(english.details, 'Technical failure');
  assert.equal(portuguese.details, 'Technical failure');
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
