const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { isSensitiveEnvironmentKey, environmentLines } = loadModule('webview-ui/src/composeSecrets.ts');

test('sensitive environment values are masked until explicitly revealed', () => {
  assert.equal(isSensitiveEnvironmentKey('DATABASE_PASSWORD'), true);
  assert.equal(isSensitiveEnvironmentKey('API_KEY'), true);
  assert.equal(isSensitiveEnvironmentKey('MONKEY'), false);
  const env = { DATABASE_PASSWORD: 'secret', API_KEY: 'abc', DEBUG: 'false' };
  assert.deepEqual(environmentLines(env, false, '[hidden]'), [
    'DATABASE_PASSWORD=[hidden]', 'API_KEY=[hidden]', 'DEBUG=false',
  ]);
  assert.deepEqual(environmentLines(['TOKEN=abc', 'EMPTY=', 'INHERITED'], true, '[hidden]'), [
    'TOKEN=abc', 'EMPTY=', 'INHERITED',
  ]);
});
