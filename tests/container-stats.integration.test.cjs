const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { config, loadModule, loadService } = require('./podman-harness.cjs');

const enabled = process.env.PODMAN_INTEGRATION_TESTS === '1';
const { ContainerStatsMonitor } = loadModule('src/services/containerStatsMonitor.ts');

function succeeded(result) {
  assert.equal(result.success, true, `${result.commandStr || 'command'}: ${result.stderr}`);
  return result;
}

function setupService(podmanPath = 'podman') {
  Object.assign(config, {
    engine: 'podman',
    podmanPath,
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'false',
  });
  return new (loadService())();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a missing Podman executable is reported as unavailable instead of crashing the monitor', async () => {
  const service = setupService('studio-missing-podman-executable');
  const statuses = [];
  const monitor = new ContainerStatsMonitor({
    spawnStream: (engine) => service.streamContainerStats(engine),
    onSamples: () => assert.fail('no samples are expected without an engine'),
    onStatus: (status) => statuses.push(status),
  });
  try {
    monitor.setActive('podman');
    const deadline = Date.now() + 15_000;
    while (!statuses.some((status) => status.state === 'unavailable') && Date.now() < deadline) {
      await sleep(100);
    }
    const unavailable = statuses.find((status) => status.state === 'unavailable');
    assert.ok(unavailable, `expected an unavailable status, got ${JSON.stringify(statuses)}`);
    assert.equal(unavailable.code, 'executableMissing');
    await sleep(3000);
    assert.equal(statuses.filter((status) => status.state === 'connecting').length, 1, 'a missing executable is not retried');
  } finally {
    monitor.dispose();
  }
});

test('real Podman streams live usage for running containers, including ones started later', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 240_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const service = setupService();
  const tag = crypto.randomBytes(6).toString('hex');
  const label = `studio.statsprobe=${tag}`;
  const busyName = `studiostats-cpu-${tag}`;
  const heldName = `studiostats-mem-${tag}`;
  const batches = [];
  const statuses = [];
  const monitor = new ContainerStatsMonitor({
    spawnStream: (engine) => service.streamContainerStats(engine),
    onSamples: (engine, at, samples) => batches.push({ engine, at, samples }),
    onStatus: (status) => statuses.push(status),
  });

  const latestFor = (name) => {
    for (let index = batches.length - 1; index >= 0; index -= 1) {
      const sample = batches[index].samples.find((item) => item.name === name);
      if (sample) return sample;
    }
    return undefined;
  };
  const waitFor = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = predicate();
      if (found) return found;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${description}; last statuses: ${JSON.stringify(statuses.slice(-3))}`);
  };

  try {
    monitor.setActive('podman');
    await waitFor(() => statuses.some((status) => status.state === 'live') || undefined, 'the first live status');

    succeeded(await service.runEngineCommand([
      'run', '-d', '--name', busyName, '--label', label, '--entrypoint', 'sh', image,
      '-c', 'while :; do :; done',
    ]));
    succeeded(await service.runEngineCommand([
      'run', '-d', '--name', heldName, '--label', label, '--entrypoint', 'sh', image,
      '-c', "x=$(head -c 67108864 /dev/zero | tr '\\0' a); sleep 3600",
    ]));

    const busy = await waitFor(() => {
      const sample = latestFor(busyName);
      return sample && sample.cpuPercent !== null && sample.cpuPercent > 50 ? sample : undefined;
    }, 'CPU usage of the busy container');
    assert.ok(busy.pids >= 1, 'PIDs are reported');
    assert.ok(busy.memUsageBytes > 0 && busy.memLimitBytes > busy.memUsageBytes, 'memory usage and limit are reported');

    const held = await waitFor(() => {
      const sample = latestFor(heldName);
      return sample && sample.memUsageBytes >= 32 * 1024 * 1024 ? sample : undefined;
    }, 'memory held by the second container');
    assert.ok(held.memPercent > 0, 'memory percentage is reported');

    await waitFor(() => batches.some((batch) =>
      batch.samples.some((sample) => sample.name === busyName && sample.netRxRate !== null)
    ) || undefined, 'a network rate after two samples');

    const samplesBeforeStop = batches.length;
    succeeded(await service.runEngineCommand(['stop', '-t', '1', busyName]));
    const stoppedAt = Date.now();
    await waitFor(() => {
      const last = batches.at(-1);
      return last && last.at > stoppedAt && !last.samples.some((sample) => sample.name === busyName) || undefined;
    }, 'the stopped container leaving the stream');
    assert.ok(batches.length > samplesBeforeStop, 'the stream keeps reporting the remaining containers');
    assert.ok(latestFor(heldName), 'the running container is still reported');

    const failures = statuses.filter((status) => status.state === 'retrying' || status.state === 'unavailable');
    assert.deepEqual(failures, [], 'a normal container lifecycle does not produce failures');
  } finally {
    monitor.dispose();
    for (const name of [busyName, heldName]) {
      await service.runEngineCommand(['rm', '-f', '--time', '1', name]);
    }
    const remaining = await service.runEngineCommand(['ps', '-a', '--filter', `label=${label}`, '--format', '{{.Names}}']);
    assert.equal(remaining.stdout.trim(), '', 'the test containers were removed');
  }

  const idle = statuses.at(-1);
  assert.deepEqual(idle, { engine: 'podman', state: 'idle' });
  const countAfterDispose = batches.length;
  await sleep(2500);
  assert.equal(batches.length, countAfterDispose, 'no samples arrive after the monitor is disposed');
});
