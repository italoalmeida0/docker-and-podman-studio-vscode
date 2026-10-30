const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { mergeComposeFileList } = loadModule('src/services/composeDetector.ts');

test('Compose file choices deduplicate normalized Windows paths and retain the active spelling', () => {
  const active = path.resolve('Workspace', 'compose.yaml');
  const detected = active.toUpperCase();
  const another = path.resolve('Workspace', 'other.yaml');
  assert.deepEqual(mergeComposeFileList([detected, another], active, true), [active, another].sort());
  assert.equal(mergeComposeFileList([detected], active, false).length, active === detected ? 1 : 2);
});
