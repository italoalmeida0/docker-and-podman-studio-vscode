const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { RefreshCoordinator } = loadModule(path.join('src', 'services', 'refreshCoordinator.ts'));
const { ResourceLoadErrors } = loadModule(path.join('src', 'services', 'resourceLoadErrors.ts'));
const { ResourceSnapshotCache } = loadModule(path.join('src', 'services', 'resourceSnapshotCache.ts'));
const { ScopedErrorTracker } = loadModule(path.join('src', 'services', 'scopedErrorTracker.ts'));
const { BatchErrorTracker } = loadModule(path.join('src', 'services', 'batchErrorTracker.ts'));
const { FeedbackAttemptTracker } = loadModule(path.join('src', 'services', 'feedbackAttempts.ts'));
const { OperationProgress } = loadModule(path.join('src', 'services', 'operationProgress.ts'));
const { feedbackScope } = loadModule(path.join('src', 'shared', 'feedbackScope.ts'));
const { classifyFailure } = loadModule(path.join('src', 'shared', 'operationFeedback.ts'));
const { failureSeverity, formatFailureSummary } = loadModule(path.join('src', 'shared', 'failureMessages.ts'));
const { formatUserMessage } = loadModule(path.join('src', 'shared', 'userMessages.ts'));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('refresh reuse and replacement keep only the current indicator', async () => {
  const sent = [];
  const progress = new OperationProgress((command, payload) => sent.push({ command, payload }), () => {});
  const coordinator = new RefreshCoordinator(progress);
  const old = deferred();
  const next = deferred();
  let invocations = 0;
  const first = coordinator.run('podman', 'first', () => { invocations++; return old.promise; }, false);
  const reused = coordinator.run('podman', 'ignored', () => { invocations++; return Promise.resolve(); }, true);
  assert.equal(first, reused);
  await Promise.resolve();
  assert.equal(invocations, 1);
  assert.equal(progress.snapshot().length, 1);

  const replacement = coordinator.run('docker', 'replacement', () => next.promise, true);
  const currentId = progress.snapshot()[0].id;
  assert.equal(progress.snapshot().length, 1);
  old.resolve();
  await first;
  assert.deepEqual(progress.snapshot().map((entry) => entry.id), [currentId]);
  next.resolve();
  await replacement;
  assert.deepEqual(progress.snapshot(), []);
  assert.equal(sent.filter((event) => event.command === 'operation:end').length, 2);
});

test('resource failures recover independently and do not cross engine contexts', () => {
  const errors = new ResourceLoadErrors();
  assert.equal(errors.setContext('podman'), false);
  assert.equal(errors.fail('containers', 'unavailable'), true);
  assert.equal(errors.fail('images', 'bad response'), true);
  assert.equal(errors.fail('images', 'bad response'), false);
  assert.match(errors.details(), /containers: unavailable/);
  assert.match(errors.details(), /images: bad response/);
  assert.equal(errors.resolve('containers'), true);
  assert.doesNotMatch(errors.details(), /containers/);
  assert.match(errors.details(), /images/);
  assert.equal(errors.resolve('containers'), false);
  assert.equal(errors.setContext('docker'), true);
  assert.equal(errors.details(), '');
  assert.equal(errors.setContext('docker'), false);
});

test('completed resource data is replayed after reopen without crossing engine contexts', () => {
  const cache = new ResourceSnapshotCache();
  cache.set('podman', 'containers:update', [{ id: 'one' }]);
  cache.set('podman', 'images:update', [{ id: 'two' }]);
  assert.deepEqual(cache.entries('podman'), [
    ['containers:update', [{ id: 'one' }]],
    ['images:update', [{ id: 'two' }]],
  ]);
  cache.set('podman', 'containers:update', [{ id: 'updated' }]);
  assert.deepEqual(cache.entries('podman')[0], ['containers:update', [{ id: 'updated' }]]);
  assert.deepEqual(cache.entries('docker'), []);
  cache.set('docker', 'containers:update', []);
  assert.deepEqual(cache.entries('podman'), []);
});

test('Compose state recovery clears only the matching failure and old project context', () => {
  const errors = new ScopedErrorTracker();
  assert.deepEqual(errors.setContext('podman:one.yaml'), []);
  assert.equal(errors.record('read', 'read-one'), undefined);
  assert.equal(errors.record('watch', 'watch-one'), undefined);
  assert.equal(errors.record('read', 'read-one'), undefined);
  assert.equal(errors.resolve('read'), 'read-one');
  assert.equal(errors.resolve('read'), undefined);
  assert.equal(errors.record('resolve', 'resolve-one'), undefined);
  assert.equal(errors.record('resolve', 'resolve-new'), 'resolve-one');
  assert.deepEqual(errors.setContext('podman:one.yaml'), []);
  assert.deepEqual(errors.setContext('podman:two.yaml'), ['watch-one', 'resolve-new']);
  assert.equal(errors.resolve('watch'), undefined);
});

test('action scopes isolate targets and contexts without retaining secrets or YAML', () => {
  const a = feedbackScope('podman', 'stack:services:batch', 'one.yaml', {
    action: 'up', services: ['two', 'one'], rawYaml: 'PRIVATE_YAML', password: 'PRIVATE_PASSWORD',
  });
  const reordered = feedbackScope('podman', 'stack:services:batch', 'one.yaml', {
    action: 'up', services: ['one', 'two'], rawYaml: 'changed',
  });
  assert.equal(a, reordered);
  assert.doesNotMatch(a, /PRIVATE_|changed/);
  assert.notEqual(a, feedbackScope('podman', 'stack:services:batch', 'two.yaml', {
    action: 'up', services: ['one', 'two'],
  }));
  assert.notEqual(a, feedbackScope('docker', 'stack:services:batch', 'one.yaml', {
    action: 'up', services: ['one', 'two'],
  }));
  assert.notEqual(a, feedbackScope('podman', 'stack:services:batch', 'one.yaml', {
    action: 'stop', services: ['one', 'two'],
  }));
  assert.equal(
    feedbackScope('podman', 'compose:image:search', 'one.yaml', { query: 'first' }),
    feedbackScope('podman', 'compose:image:search', 'two.yaml', { query: 'second' })
  );
});

test('only the latest attempt can update feedback in its applicable context', () => {
  const tracker = new FeedbackAttemptTracker();
  const first = tracker.start('refresh', 'podman', 'podman:1');
  const independent = tracker.start('other', 'podman', 'podman:1');
  const retry = tracker.start('refresh', 'podman', 'podman:1');
  assert.equal(tracker.isCurrent(first, 'podman:1'), false);
  assert.equal(tracker.isCurrent(retry, 'podman:1'), true);
  assert.equal(tracker.isCurrent(independent, 'podman:1'), true);
  assert.equal(tracker.isCurrent(retry, 'docker:2'), false);
  assert.equal(tracker.isCurrent(retry, 'podman:3'), false);
  tracker.finish(first);
  assert.equal(tracker.isCurrent(retry, 'podman:1'), true);
  tracker.finish(retry);
  assert.equal(tracker.isCurrent(first, 'podman:1'), false);
  const fileAttempt = tracker.start('file-create', 'podman', 'podman:1', true);
  assert.equal(tracker.isCurrent(fileAttempt, 'docker:2'), true);
  const retryFile = tracker.start('file-create', 'docker', 'docker:2', true);
  assert.equal(tracker.isCurrent(fileAttempt, 'docker:2'), false);
  assert.equal(tracker.isCurrent(retryFile, 'podman:3'), true);
  tracker.finish(retryFile);
  assert.equal(tracker.isCurrent(retryFile, 'podman:3'), false);
  const pendingRegistration = tracker.start('file-register', 'podman', 'podman:3', true);
  tracker.invalidate('file-register');
  assert.equal(tracker.isCurrent(pendingRegistration, 'docker:4'), false);
});

test('recoverable failures are warnings but serious failures remain errors', () => {
  for (const kind of ['timeout', 'missingExecutable', 'missingFile', 'portInUse',
    'registryAuth', 'imageNotFound', 'engineConnection', 'network', 'unsavedChanges',
    'staleResource', 'resourceInUse', 'invalidInput']) {
    assert.equal(failureSeverity({ kind }), 'warning', kind);
  }
  for (const kind of ['generic', 'diskSpace', 'permission']) {
    assert.equal(failureSeverity({ kind }), 'error', kind);
  }
  assert.equal(failureSeverity({ kind: 'generic', resourceRefresh: true }), 'warning');
  assert.equal(failureSeverity({ kind: 'diskSpace', resourceRefresh: true }), 'error');
  assert.equal(failureSeverity(), 'error');
});

test('batch failures resolve only after all affected targets succeed in the same context', () => {
  const tracker = new BatchErrorTracker();
  tracker.record('first', { group: 'podman-start', succeeded: ['a'], pending: ['b', 'c'] });
  tracker.record('other-action', { group: 'podman-stop', succeeded: [], pending: ['b'] });
  assert.deepEqual(tracker.resolve({ group: 'podman-start', succeeded: ['b'], pending: [] }), []);
  assert.deepEqual(tracker.resolve({ group: 'docker-start', succeeded: ['c'], pending: [] }), []);
  assert.deepEqual(tracker.resolve({ group: 'podman-start', succeeded: ['c'], pending: [] }), ['first']);
  assert.deepEqual(tracker.resolve({ group: 'podman-stop', succeeded: ['b'], pending: [] }), ['other-action']);
  tracker.record('retry', { group: 'podman-start', succeeded: [], pending: ['x'] });
  tracker.record('retry', { group: 'podman-start', succeeded: [], pending: ['y'] });
  assert.deepEqual(tracker.resolve({ group: 'podman-start', succeeded: ['x'], pending: [] }), []);
  assert.deepEqual(tracker.resolve({ group: 'podman-start', succeeded: ['y'], pending: [] }), ['retry']);
});

test('technical invalid JSON is not blamed on user input', () => {
  assert.equal(classifyFailure('Podman returned invalid resource data: invalid JSON'), 'generic');
  assert.equal(classifyFailure('Invalid Compose selection. Refresh and try again.'), 'invalidInput');
});

test('specific user errors retain their reason when the display language changes', () => {
  const locales = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'pl', 'tr', 'nl',
    'ja', 'ko', 'zh-CN', 'zh-TW', 'hi'];
  const keys = [
    'provideRegistryUrl', 'stopServiceBeforeEdit', 'stopAllBeforeRawSave',
    'invalidComposeExtension', 'fileNameOnlyError', 'selectFolderOrWorkspaceError',
    'fileAlreadyExists', 'composeRegistrationFailed', 'podsRequirePodmanError', 'invalidLongOperationTimeout',
    'provideUsernameForLogin', 'emptyServiceYamlError', 'invalidServiceYamlObject',
  ];
  const variables = { service: 'api', services: 'api, db', path: 'compose.yaml', cmd: 'podman' };
  for (const locale of locales) {
    for (const key of keys) {
      const message = formatUserMessage(locale, { key, variables });
      assert.ok(message.length > 10, `${locale}:${key}`);
      assert.doesNotMatch(message, /\{\w+\}/, `${locale}:${key}`);
      if (locale !== 'en') {
        assert.notEqual(message, formatUserMessage('en', { key, variables }), `${locale}:${key}`);
      }
    }
  }
  const failure = { kind: 'resourceInUse', direct: { key: 'stopServiceBeforeEdit', variables: { service: 'api' } } };
  assert.match(formatFailureSummary('pt-BR', failure), /Pare o serviço "api"/);
  assert.match(formatFailureSummary('en', failure), /Stop service "api"/);
  assert.match(formatFailureSummary('es', failure), /Detén el servicio "api"/);
});

test('missing files and command launch failures have distinct localized guidance', () => {
  const locales = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'pl', 'tr', 'nl',
    'ja', 'ko', 'zh-CN', 'zh-TW', 'hi'];
  for (const kind of ['missingFile', 'missingExecutable']) {
    const english = formatFailureSummary('en', { kind });
    for (const locale of locales) {
      const message = formatFailureSummary(locale, { kind });
      assert.ok(message.length > 10, `${locale}:${kind}`);
      if (locale !== 'en') assert.notEqual(message, english, `${locale}:${kind}`);
    }
  }
  assert.match(formatFailureSummary('pt-BR', { kind: 'missingFile' }), /arquivo ou pasta/);
  assert.match(formatFailureSummary('pt-BR', { kind: 'missingExecutable' }), /executável.*pasta de trabalho/);
});

test('partial Compose registration preserves the file and exposes localized recovery details', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-registration-'));
  const file = path.join(directory, 'compose.yaml');
  fs.writeFileSync(file, 'services: {}\n');
  t.after(() => {
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  const { composeRegistrationScope, registerCreatedComposeFile } =
    loadModule(path.join('src', 'extension.ts'));
  const originalError = new Error('registration backend unavailable');
  await assert.rejects(
    () => registerCreatedComposeFile({ registerFile: async () => { throw originalError; } }, file),
    (error) => {
      assert.equal(error.name, 'UserFacingError');
      assert.equal(error.presentation.key, 'composeRegistrationFailed');
      assert.equal(error.presentation.variables.path, file);
      assert.match(error.technicalDetails, /registration backend unavailable/);
      const summary = formatFailureSummary('pt-BR', { kind: error.kind, direct: error.presentation });
      assert.match(summary, /arquivo foi criado/);
      assert.ok(summary.includes(file));
      assert.doesNotMatch(summary, /registration backend unavailable/);
      return true;
    }
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'services: {}\n');
  if (!globalThis.navigator) globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  const registrationScope = composeRegistrationScope(file);
  const creationScope = feedbackScope('global', 'compose:file:create', undefined, {});
  assert.notEqual(registrationScope, creationScope);
  assert.notEqual(registrationScope, composeRegistrationScope(path.join(directory, 'other.yaml')));
  store.showBanner('error', 'Created but not registered', 'details', registrationScope);
  store.showBanner('error', 'Another creation failed', 'details', creationScope);
  store.resolveBannerScope(creationScope);
  store.setEnginePreference('podman');
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message),
    ['Created but not registered']);
  store.resolveBannerScope(registrationScope);
  assert.deepEqual(useStudioStore.getState().banners, []);
  let registered;
  await registerCreatedComposeFile({ registerFile: async (target) => { registered = target; return []; } }, file);
  assert.equal(registered, file);
  const { UserFacingError, getErrorDetails } =
    loadModule(path.join('src', 'shared', 'userFacingError.ts'));
  const failure = new UserFacingError('composeRegistrationFailed', { path: file }, 'generic', originalError.stack);
  assert.match(getErrorDetails(failure), /registration backend unavailable/);
  assert.equal(getErrorDetails('plain failure'), 'plain failure');
});

test('Compose inline alerts use the selected language', () => {
  const { composeAlertTexts } = loadModule(path.join('webview-ui', 'src', 'i18n', 'composeAlerts.ts'));
  const locales = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'pl', 'tr', 'nl',
    'ja', 'ko', 'zh-CN', 'zh-TW', 'hi'];
  const english = composeAlertTexts('en');
  const hadNavigator = typeof globalThis.navigator !== 'undefined';
  if (!hadNavigator) globalThis.navigator = { language: 'en' };
  try {
    const { composeExtrasForLocale } =
      loadModule(path.join('webview-ui', 'src', 'i18n', 'composeExtras.ts'));
    for (const key of ['draftPending', 'fragmentUnavailable', 'projectDependenciesIncomplete',
      'finishServiceEdit', 'visualAdvancedField', 'selectedBuildHint', 'batchStartHint']) {
      assert.ok(Object.hasOwn(english, key), key);
    }
    for (const locale of locales) {
      const messages = composeAlertTexts(locale);
      const extras = composeExtrasForLocale(locale);
      for (const key of Object.keys(english)) {
        assert.ok(messages[key], `${locale}:${key}`);
        if (locale !== 'en') assert.notEqual(messages[key], english[key], `${locale}:${key}`);
        assert.equal(extras[key], messages[key], `${locale}:${key} is used by Compose`);
      }
    }
  } finally {
    if (!hadNavigator) delete globalThis.navigator;
  }
  assert.match(composeAlertTexts('pt-BR').invalidYaml, /aba YAML/);
  assert.match(composeAlertTexts('es').projectFailed, /configuración del proyecto/);
  assert.match(composeAlertTexts('es').draftPending, /cambios sin guardar/);
});

test('operation labels stay localized when the language changes during a task', () => {
  const { localizedOperationLabel } = loadModule(path.join('webview-ui', 'src', 'operationLabels.ts'));
  const { en } = loadModule(path.join('webview-ui', 'src', 'i18n', 'en.ts'));
  const { ptBR } = loadModule(path.join('webview-ui', 'src', 'i18n', 'ptBR.ts'));
  const { es } = loadModule(path.join('webview-ui', 'src', 'i18n', 'es.ts'));
  const operation = { key: 'compose-build-batch', label: 'Build 2 selected services', labelLocale: 'en' };
  assert.equal(localizedOperationLabel(operation, 'en', en), operation.label);
  assert.match(localizedOperationLabel(operation, 'pt-BR', ptBR), /Construindo.*Compose/);
  assert.match(localizedOperationLabel(operation, 'es', es), /Construyendo.*Compose/);
  const failure = { kind: 'network', operation: operation.label, operationLocale: 'en' };
  const localized = localizedOperationLabel(operation, 'pt-BR', ptBR);
  assert.match(formatFailureSummary('pt-BR', failure, localized), /Construindo.*Compose/);
  assert.doesNotMatch(formatFailureSummary('pt-BR', failure, localized), /Build 2 selected services/);
});

test('webview reconciles duplicate operation events and scoped errors', () => {
  if (!globalThis.navigator) globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  store.beginOperation('refresh-all', 'Loading', 'one');
  store.beginOperation('refresh-all', 'Loading', 'one');
  assert.equal(useStudioStore.getState().operationsInProgress['refresh-all'], 1);
  store.beginOperation('refresh-all', 'Loading again', 'two');
  store.endOperation('refresh-all', 'one');
  store.endOperation('refresh-all', 'one');
  assert.equal(useStudioStore.getState().operationsInProgress['refresh-all'], 1);
  store.endOperation('refresh-all', 'two');
  assert.equal(useStudioStore.getState().operationInProgress, null);

  store.showBanner('error', 'old', 'details', 'one');
  store.showBanner('error', 'new', 'details', 'one');
  store.showBanner('error', 'other', 'details', 'two');
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message), ['new', 'other']);
  store.resolveBannerScope('one');
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message), ['other']);
  store.resolveBannerScope('missing');
  assert.equal(useStudioStore.getState().banners.length, 1);
});

test('engine changes clear only engine feedback and retain Compose drafts', () => {
  if (!globalThis.navigator) globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule(path.join('webview-ui', 'src', 'store.ts'));
  const store = useStudioStore.getState();
  store.setComposeUpdate({ services: {} }, 'compose.yaml', 'services: {}\n', null, {}, {
    options: null, revision: 'old-revision', error: 'engine unavailable',
    resolving: false, customized: false, dependenciesIncomplete: true,
  });
  store.setSettingsTestResult({ ok: false, message: 'old registry failure' });
  store.setImageResults([{ name: 'old/image' }]);
  store.setImageSearchError('old search failure', { kind: 'network' });
  store.showBanner('error', 'Docker failure', 'details', 'engine', { kind: 'timeout' }, undefined, 'docker');
  store.showBanner('error', 'Independent failure', 'details', 'global');
  store.showBanner('success', 'Docker completed', undefined, undefined, undefined, undefined, 'docker');
  const before = useStudioStore.getState();
  const dockerId = before.banners[0].id;
  const globalId = before.banners[1].id;
  const draft = before.composeDrafts['compose.yaml'];
  store.pauseBanner(dockerId);
  store.pauseBanner(globalId);

  store.setEnginePreference('podman');
  const switched = useStudioStore.getState();
  assert.deepEqual(switched.banners.map((banner) => banner.message), ['Independent failure']);
  assert.deepEqual(switched.pausedBanners, { [globalId]: 1 });
  assert.equal(switched.settingsTestResult, null);
  assert.deepEqual(switched.imageResults, []);
  assert.equal(switched.imageSearchError, null);
  assert.equal(switched.imageSearchFailure, null);
  assert.equal(switched.composeProject.error, null);
  assert.equal(switched.composeProject.revision, null);
  assert.equal(switched.composeProject.resolving, true);
  assert.equal(switched.composeProject.dependenciesIncomplete, false);
  assert.deepEqual(switched.composeDrafts['compose.yaml'], draft);

  const settings = { engine: 'podman', language: 'en', podmanPath: 'podman', dockerPath: 'docker' };
  store.setSettings(settings);
  store.showBanner('error', 'Podman failure', 'details', 'podman', { kind: 'timeout' }, undefined, 'podman');
  store.setSettings({ ...settings });
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message),
    ['Independent failure', 'Podman failure']);
  store.setSettings({ ...settings, podmanPath: 'other-podman' });
  assert.deepEqual(useStudioStore.getState().banners.map((banner) => banner.message),
    ['Independent failure']);
});
