const assert = require('node:assert/strict');
const path = require('node:path');

async function imageVolumeDestinations(service, image) {
  const result = await service.runPodmanCommand([
    'image', 'inspect', '--format', '{{json .Config.Volumes}}', image,
  ]);
  assert.equal(result.success, true, `Unable to inspect test image volumes: ${result.stderr}`);
  const volumes = JSON.parse(result.stdout);
  if (volumes === null) return [];
  assert.ok(volumes && typeof volumes === 'object' && !Array.isArray(volumes));
  const destinations = Object.keys(volumes);
  for (const destination of destinations) {
    assert.ok(
      path.posix.isAbsolute(destination) && !/[,:$\r\n]/.test(destination),
      `Unsupported test image volume destination: ${destination}`
    );
  }
  return destinations;
}

function tmpfsMounts(destinations) {
  return destinations.map((destination) => `type=tmpfs,destination=${destination}`);
}

function composeTmpfs(destinations) {
  return destinations.length
    ? ['    tmpfs:', ...destinations.map((destination) => `      - ${JSON.stringify(destination)}`)]
    : [];
}

async function assertNoImageVolumes(service, containerId, destinations) {
  const result = await service.runPodmanCommand([
    'container', 'inspect', '--format', '{{json .Mounts}}', containerId,
  ]);
  assert.equal(result.success, true, `Unable to inspect test container mounts: ${result.stderr}`);
  const mounts = JSON.parse(result.stdout) || [];
  assert.ok(Array.isArray(mounts), 'Container mounts must be an array');
  for (const mount of mounts) {
    assert.ok(
      mount.Type !== 'volume' || !destinations.includes(mount.Destination),
      `Test image created an unexpected volume at ${mount.Destination}`
    );
  }
}

module.exports = {
  assertNoImageVolumes,
  composeTmpfs,
  imageVolumeDestinations,
  tmpfsMounts,
};
