const assert = require('node:assert/strict');
const test = require('node:test');
const { composeTmpfs, imageVolumeDestinations, tmpfsMounts } = require('./podman-test-util.cjs');

function serviceWithVolume(destination) {
  return {
    runPodmanCommand: async () => ({
      success: true,
      stdout: JSON.stringify({ [destination]: {} }),
      stderr: '',
    }),
  };
}

test('test image volumes use isolated tmpfs mounts', async () => {
  const destinations = await imageVolumeDestinations(serviceWithVolume('/data'), 'example');
  assert.deepEqual(tmpfsMounts(destinations), ['type=tmpfs,destination=/data']);
  assert.deepEqual(composeTmpfs(destinations), ['    tmpfs:', '      - "/data"']);
});

test('rejects image volume paths that cannot be mounted safely by Compose', async () => {
  for (const destination of ['/data,other', '/data:options', '/data$NAME', '/data\nother']) {
    await assert.rejects(
      imageVolumeDestinations(serviceWithVolume(destination), 'example'),
      /Unsupported test image volume destination/
    );
  }
});
