const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./podman-harness.cjs');

const { composeMounts, composeEnvFiles, serviceNetworks } = loadModule('webview-ui/src/composeTopology.ts');

test('default networks are represented per service and network_mode does not invent an edge', () => {
  assert.deepEqual(serviceNetworks({ image: 'example' }), ['default']);
  assert.deepEqual(serviceNetworks({ networks: { frontend: {} } }), ['frontend']);
  assert.deepEqual(serviceNetworks({ networks: ['backend'] }), ['backend']);
  assert.deepEqual(serviceNetworks({ network_mode: 'host' }), []);
  assert.deepEqual(serviceNetworks({ network_mode: 'service:db' }), []);
});

test('mounts distinguish long syntax, Windows binds, anonymous volumes, and tmpfs', () => {
  assert.deepEqual(composeMounts([
    'data:/data:ro',
    'C:\\work:/workspace:ro',
    '/cache',
    { type: 'bind', source: './src', target: '/app' },
    { type: 'volume', source: 'db', target: '/var/lib/db' },
    { type: 'volume', target: '/anonymous' },
    { type: 'tmpfs', target: '/run' },
  ]), [
    { kind: 'volume', source: 'data', target: '/data' },
    { kind: 'bind', source: 'C:\\work', target: '/workspace' },
    { kind: 'anonymous', target: '/cache' },
    { kind: 'bind', source: './src', target: '/app' },
    { kind: 'volume', source: 'db', target: '/var/lib/db' },
    { kind: 'anonymous', source: undefined, target: '/anonymous' },
    { kind: 'tmpfs', target: '/run' },
  ]);
  assert.deepEqual(composeEnvFiles(['one.env', { path: 'optional.env', required: false }]),
    ['one.env', 'optional.env']);
});
