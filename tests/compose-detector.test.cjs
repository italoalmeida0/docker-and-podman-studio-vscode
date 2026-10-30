const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadModule, vscode } = require('./podman-harness.cjs');

const { ComposeFileDetector, mergeComposeFileList } = loadModule('src/services/composeDetector.ts');

test('Compose file choices deduplicate normalized Windows paths and retain the active spelling', () => {
  const active = path.resolve('Workspace', 'compose.yaml');
  const detected = active.toUpperCase();
  const another = path.resolve('Workspace', 'other.yaml');
  assert.deepEqual(mergeComposeFileList([detected, another], active, true), [active, another].sort());
  assert.equal(mergeComposeFileList([detected], active, false).length, active === detected ? 1 : 2);
});

test('registration recovery is emitted only after the selected file is fully registered', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-compose-register-'));
  const file = path.join(directory, 'compose.yaml');
  fs.writeFileSync(file, 'services: {}\n');
  const previousFindFiles = vscode.workspace.findFiles;
  vscode.workspace.findFiles = async () => [];
  t.after(() => {
    vscode.workspace.findFiles = previousFindFiles;
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  let saved = [];
  let fail = true;
  const detector = new ComposeFileDetector({
    globalState: {
      get: () => saved,
      update: async (_key, value) => {
        if (fail) throw new Error('registration failed');
        saved = value;
      },
    },
  }, { listAllContainers: async () => [] });
  t.after(() => detector.dispose());
  const registered = [];
  detector.onFileRegistered((target) => registered.push(target));
  await assert.rejects(() => detector.registerFile(file), /registration failed/);
  assert.deepEqual(registered, []);
  fail = false;
  await detector.registerFile(file);
  assert.deepEqual(registered, [path.normalize(file)]);
});
