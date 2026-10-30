const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { syncComposeDraft } = loadModule('webview-ui/src/composeDrafts.ts');
const { assertComposeEditBase, composeEditStatuses } = loadModule('src/services/composeEdit.ts');

test('clean drafts follow the file while dirty drafts survive external changes', () => {
  assert.deepEqual(syncComposeDraft(undefined, 'one'), { base: 'one', text: 'one' });
  assert.deepEqual(syncComposeDraft({ base: 'one', text: 'one' }, 'two'), { base: 'two', text: 'two' });
  assert.deepEqual(syncComposeDraft({ base: 'one', text: 'my edit' }, 'two'), { base: 'one', text: 'my edit' });
  assert.deepEqual(syncComposeDraft({ base: 'one', text: 'my edit' }, 'my edit'), { base: 'my edit', text: 'my edit' });
});

test('edits reject different files, stale content and unsaved VS Code editors', () => {
  const valid = {
    activeFile: 'C:\\project\\compose.yml',
    requestedFile: 'C:\\project\\compose.yml',
    expectedContent: 'original',
    currentContent: 'original',
    dirtyEditor: false,
  };
  assert.doesNotThrow(() => assertComposeEditBase(valid));
  assert.throws(() => assertComposeEditBase({ ...valid, requestedFile: 'C:\\other\\compose.yml' }), /active Compose file changed/);
  assert.throws(() => assertComposeEditBase({ ...valid, currentContent: 'external edit' }), /changed since editing/);
  assert.throws(() => assertComposeEditBase({ ...valid, dirtyEditor: true }), /unsaved changes/);
});

test('edit safety also sees active containers hidden by the selected Compose profiles', () => {
  const file = path.resolve('project', 'compose.yaml');
  const other = path.resolve('other', 'compose.yaml');
  const container = {
    isInfra: false, state: 'running', composeProject: 'project', composeService: 'worker',
    composeFiles: [file], composeFile: file,
  };
  const statuses = composeEditStatuses([file], [
    { service: 'app', status: 'exited' },
  ], [
    container,
    { ...container, composeService: 'unrelated', composeFiles: [other], composeFile: other },
    { ...container, composeService: '', composeFiles: [], composeFile: '' },
    { ...container, composeService: 'infra', isInfra: true },
  ]);
  assert.deepEqual(statuses, [
    { service: 'app', status: 'exited' },
    { service: 'worker', status: 'running' },
    { service: '', status: 'running' },
  ]);
});

test('service save acknowledgements preserve newer drafts even after leaving the page', () => {
  if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule('webview-ui/src/store.ts');
  const store = useStudioStore.getState();
  const file = 'project-compose.yaml';
  const original = { name: 'app', base: 'base', text: 'first edit' };
  store.setComposeServiceDraft(file, original);
  store.beginComposeEdit('first', {
    file, kind: 'service', name: 'app', base: 'base', snapshot: JSON.stringify(original),
  });
  store.setActivePage('containers');
  const newer = { ...original, text: 'newer edit' };
  store.setComposeServiceDraft(file, newer);
  store.finishComposeEdit('first', file);
  assert.deepEqual(useStudioStore.getState().composeServiceDrafts[file], newer);
  assert.equal(useStudioStore.getState().pendingComposeEdits.first, undefined);
  store.beginComposeEdit('second', {
    file, kind: 'service', name: 'app', base: 'base', snapshot: JSON.stringify(newer),
  });
  store.finishComposeEdit('second', file);
  assert.equal(useStudioStore.getState().composeServiceDrafts[file], undefined);
  store.setComposeServiceDraft(file, original);
  store.beginComposeEdit('failed', {
    file, kind: 'service', name: 'app', base: 'base', snapshot: JSON.stringify(original),
  });
  store.finishComposeEdit('failed');
  assert.deepEqual(useStudioStore.getState().composeServiceDrafts[file], original);
});

test('raw YAML saves preserve edits made while the save is pending', () => {
  if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { language: 'en' };
  const { useStudioStore } = loadModule('webview-ui/src/store.ts');
  const store = useStudioStore.getState();
  const file = 'raw-compose.yaml';
  store.setComposeUpdate(null, file, 'base', null, {});
  store.setComposeDraft(file, { base: 'base', text: 'first edit' });
  store.beginComposeEdit('raw-save', {
    file, kind: 'raw', name: '', base: 'base', snapshot: 'first edit',
  });
  store.setActivePage('containers');
  store.setComposeDraft(file, { base: 'base', text: 'newer edit' });
  store.setComposeUpdate(null, file, 'first edit', null, {});
  store.finishComposeEdit('raw-save', file);
  assert.deepEqual(useStudioStore.getState().composeDrafts[file], { base: 'base', text: 'newer edit' });
  assert.equal(useStudioStore.getState().pendingComposeEdits['raw-save'], undefined);
});
