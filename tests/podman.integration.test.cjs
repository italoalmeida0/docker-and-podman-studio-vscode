const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { config, loadLogProvider, loadService, vscode } = require('./podman-harness.cjs');
const {
  assertNoImageVolumes, composeTmpfs, imageVolumeDestinations, tmpfsMounts,
} = require('./podman-test-util.cjs');

const enabled = process.env.PODMAN_INTEGRATION_TESTS === '1';

function succeeded(result) {
  assert.equal(result.success, true, `${result.commandStr || 'command'}: ${result.stderr}`);
  return result;
}

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('Timed out waiting for expected Podman output');
}

test('exercises an isolated Podman Compose project', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 300_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const PodmanService = loadService();
  const service = new PodmanService();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio-podman-'));
  const composeFile = path.join(dir, 'compose.yaml');
  const project = `studiotest${crypto.randomBytes(6).toString('hex')}`;
  let attemptedUp = false;
  let logProvider;
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'false',
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    const existing = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(existing.stdout), []);
    fs.writeFileSync(composeFile, [
      `name: ${project}`,
      'services:',
      '  app:',
      `    image: ${JSON.stringify(image)}`,
      '    command: ["sh", "-c", "echo studio-compose-ready; sleep 900"]',
      ...composeTmpfs(destinations),
      '',
    ].join('\n'));

    attemptedUp = true;
    succeeded(await service.composeUp(composeFile));
    const doc = { name: project, services: { app: {} } };
    const running = await service.composePs(composeFile, doc);
    assert.equal(running.length, 1, 'the selected Compose project must be detected');
    assert.equal(running[0].status, 'running');
    await assertNoImageVolumes(service, running[0].fullId, destinations);
    const LogProvider = loadLogProvider();
    logProvider = new LogProvider(service);
    const lines = [];
    const errors = [];
    logProvider.onLogLine((entry) => lines.push(entry.message));
    logProvider.onError((error) => errors.push(error));
    await logProvider.startComposeStreaming(composeFile, 'app');
    await waitFor(() => lines.some((line) => line.includes('studio-compose-ready')) || errors.length);
    assert.deepEqual(errors, []);
    assert.ok(lines.some((line) => line.includes('studio-compose-ready')));
    assert.ok(logProvider.getHistory('app').some((entry) => entry.sourceTimestamp),
      'Compose logs must retain the provider timestamp');
    logProvider.stopStreaming('app');
    succeeded(await service.runEngineCommand([
      'exec', '--user', '0', running[0].fullId, 'sh', '-c',
      'printf "studio-while-away\\n" > /proc/1/fd/1',
    ]));
    lines.length = 0;
    await logProvider.startComposeStreaming(composeFile, 'app');
    await waitFor(() => lines.some((line) => line.includes('studio-while-away')) || errors.length);
    assert.deepEqual(errors, []);
    assert.ok(lines.some((line) => line.includes('studio-while-away')));
    assert.ok(!lines.some((line) => line.includes('studio-compose-ready')),
      'replayed lines already in history should not be duplicated');
    logProvider.stopStreaming('app');
    succeeded(await service.composeScale(composeFile, 'app', 2));
    assert.equal((await service.composePs(composeFile, doc)).length, 2);
    lines.length = 0;
    await logProvider.startComposeStreaming(composeFile, 'app');
    await waitFor(() => lines.some((line) => line.includes(`${project}_app_2`)) || errors.length);
    assert.deepEqual(errors, []);
    assert.ok(lines.some((line) => line.includes(`${project}_app_2`)));
    assert.ok(logProvider.getHistory('app').some((entry) => entry.message.includes(`${project}_app_1`)));
    assert.ok(!lines.some((line) => line.includes(`${project}_app_1`)),
      'the existing replica history should not be replayed as new output');
    logProvider.stopStreaming('app');
    succeeded(await service.composeStop(composeFile));
    const stoppedReplicas = await service.composePs(composeFile, doc);
    assert.equal(stoppedReplicas.length, 2);
    assert.ok(stoppedReplicas.every((container) => container.status === 'exited'));
    succeeded(await service.composeStart(composeFile));
    succeeded(await service.composeRestart(composeFile));
    assert.ok((await service.composePs(composeFile, doc)).every((container) =>
      container.status === 'running'
    ));
    succeeded(await service.composeScale(composeFile, 'app', 1));
    const scaledDown = await service.composePs(composeFile, doc);
    if (scaledDown.length !== 1) {
      const details = [];
      for (const container of scaledDown) {
        const inspection = succeeded(await service.runEngineCommand([
          'inspect', '--format', '{{json .Config.Labels}}', container.fullId,
        ]));
        const labels = JSON.parse(inspection.stdout);
        details.push({
          name: container.name,
          status: container.status,
          replica: labels['com.docker.compose.container-number'],
        });
      }
      assert.fail(`Unexpected containers after scaling down: ${JSON.stringify(details)}`);
    }
    succeeded(await service.composeScale(composeFile, 'app', 0));
    assert.equal((await service.composePs(composeFile, doc)).length, 0);
    succeeded(await service.composeScale(composeFile, 'app', 1));
    const restored = await service.composePs(composeFile, doc);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, 'running');
    await assertNoImageVolumes(service, restored[0].fullId, destinations);
    succeeded(await service.composeStop(composeFile));
    const stopped = await service.composePs(composeFile, doc);
    assert.equal(stopped.length, 1, 'stopped Compose containers must remain visible');
    assert.notEqual(stopped[0].status, 'running');
    const ps = succeeded(await service.runComposeCommand(composeFile, ['ps', '-q']));
    assert.match(ps.stdout, new RegExp(stopped[0].id));
    succeeded(await service.composeStart(composeFile));
    succeeded(await service.composeScale(composeFile, 'app', 2));
    assert.equal((await service.composePs(composeFile, doc)).length, 2);
    succeeded(await service.composeDown(composeFile, { projectName: project }));
    const remaining = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(remaining.stdout), []);
    assert.ok(!(await service.listNetworks()).some((network) => network.composeProject === project));
    attemptedUp = false;
  } finally {
    logProvider?.dispose();
    if (attemptedUp) {
      const cleanup = await service.composeDown(composeFile, { projectName: project });
      if (!cleanup.success) {
        throw new Error(`Failed to clean up isolated project ${project}: ${cleanup.stderr}`);
      }
      const remaining = succeeded(await service.runEngineCommand([
        'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
      ]));
      assert.deepEqual(JSON.parse(remaining.stdout), []);
      assert.ok(!(await service.listNetworks()).some((network) => network.composeProject === project));
    }
    if (fs.existsSync(composeFile)) {
      fs.unlinkSync(composeFile);
    }
    fs.rmdirSync(dir);
  }
});

test('exercises an isolated Podman Compose project grouped into a pod', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 300_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const PodmanService = loadService();
  const service = new PodmanService();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio-pod-compose-'));
  const composeFile = path.join(dir, 'compose.yaml');
  const project = `studiotest${crypto.randomBytes(6).toString('hex')}`;
  let attemptedUp = false;
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'true',
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    assert.ok(!(await service.listPods()).some((pod) => pod.name.includes(project)));
    assert.ok(!(await service.listNetworks()).some((network) => network.name.includes(project)));
    const existing = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(existing.stdout), []);
    fs.writeFileSync(composeFile, [
      `name: ${project}`,
      'services:',
      '  app:',
      `    image: ${JSON.stringify(image)}`,
      '    command: ["sh", "-c", "sleep 900"]',
      ...composeTmpfs(destinations),
      '  worker:',
      `    image: ${JSON.stringify(image)}`,
      '    command: ["sh", "-c", "sleep 900"]',
      ...composeTmpfs(destinations),
      '',
    ].join('\n'));

    attemptedUp = true;
    succeeded(await service.composeUp(composeFile));
    const doc = { name: project, services: { app: {}, worker: {} } };
    const initial = await service.composePs(composeFile, doc);
    assert.deepEqual(initial.map((item) => item.service).sort(), ['app', 'worker']);
    assert.ok(initial.every((item) => item.status === 'running' && item.podId));
    for (const container of initial) {
      await assertNoImageVolumes(service, container.fullId, destinations);
    }
    const workerId = initial.find((item) => item.service === 'worker').fullId;
    const groupedPod = (await service.listPods()).find((pod) => pod.id === initial[0].podId);
    assert.ok(groupedPod);
    const listed = await service.listAllContainers();
    if (groupedPod.infraId) {
      assert.ok(listed.some((item) => item.isInfra && item.id === groupedPod.infraId));
    }

    succeeded(await service.composeStop(composeFile, ['worker']));
    const stopped = await service.composePs(composeFile, doc);
    assert.notEqual(stopped.find((item) => item.service === 'worker').status, 'running');
    assert.equal(stopped.find((item) => item.service === 'app').status, 'running');
    succeeded(await service.composeStart(composeFile, ['worker']));
    succeeded(await service.composeRestart(composeFile, ['worker']));
    succeeded(await service.composeScale(composeFile, 'app', 0));
    const zero = await service.composePs(composeFile, doc);
    assert.deepEqual(zero.map((item) => item.service), ['worker']);
    assert.equal(zero[0].fullId, workerId);
    assert.equal(zero[0].status, 'running');
    succeeded(await service.composeScale(composeFile, 'app', 1));
    const restored = await service.composePs(composeFile, doc);
    assert.deepEqual(restored.map((item) => item.service).sort(), ['app', 'worker']);
    await assertNoImageVolumes(service, restored.find((item) => item.service === 'app').fullId, destinations);
    assert.equal(restored.find((item) => item.service === 'worker').fullId, workerId);
    assert.equal(restored.find((item) => item.service === 'worker').status, 'running');
    succeeded(await service.composeScale(composeFile, 'app', 2));
    succeeded(await service.composeStop(composeFile, ['app']));
    const stoppedReplicas = await service.composePs(composeFile, doc);
    assert.equal(stoppedReplicas.filter((item) => item.service === 'app').length, 2);
    assert.ok(stoppedReplicas.filter((item) => item.service === 'app')
      .every((item) => item.status === 'exited'));
    assert.equal(stoppedReplicas.find((item) => item.service === 'worker').status, 'running');
    succeeded(await service.composeStart(composeFile, ['app']));
    succeeded(await service.composeRestart(composeFile, ['app']));
    assert.ok((await service.composePs(composeFile, doc)).every((item) => item.status === 'running'));
    succeeded(await service.composeRemoveServices(composeFile, ['app'], doc));
    const remaining = await service.composePs(composeFile, doc);
    assert.deepEqual(remaining.map((item) => item.service), ['worker']);
    assert.equal(remaining[0].fullId, workerId);
    assert.equal(remaining[0].status, 'running');
    succeeded(await service.composeScale(composeFile, 'app', 2));
  } finally {
    if (attemptedUp) {
      const cleanup = await service.composeDown(composeFile, { projectName: project });
      if (!cleanup.success) {
        throw new Error(`Failed to clean up isolated project ${project}: ${cleanup.stderr}`);
      }
      assert.ok(!(await service.listPods()).some((pod) => pod.name.includes(project)));
      assert.ok(!(await service.listNetworks()).some((network) => network.name.includes(project)));
    }
    if (fs.existsSync(composeFile)) fs.unlinkSync(composeFile);
    fs.rmdirSync(dir);
  }
});

test('exercises an isolated project through the podman compose provider wrapper', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 300_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const PodmanService = loadService();
  const service = new PodmanService();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio-compose-plugin-'));
  const composeFile = path.join(dir, 'compose.yaml');
  const project = `studiotest${crypto.randomBytes(6).toString('hex')}`;
  let attemptedUp = false;
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'plugin',
    inPod: 'default',
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    const existing = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(existing.stdout), []);
    assert.ok(!(await service.listPods()).some((pod) => pod.name.includes(project)));
    assert.ok(!(await service.listNetworks()).some((network) => network.name.includes(project)));
    fs.writeFileSync(composeFile, [
      `name: ${project}`,
      'services:',
      '  app:',
      `    image: ${JSON.stringify(image)}`,
      '    command: ["sh", "-c", "sleep 900"]',
      ...composeTmpfs(destinations),
      '',
    ].join('\n'));

    attemptedUp = true;
    succeeded(await service.composeUp(composeFile, { projectName: project }));
    const doc = { name: project, services: { app: {} } };
    const running = await service.composePs(composeFile, doc, project);
    assert.equal(running.length, 1);
    assert.equal(running[0].status, 'running');
    await assertNoImageVolumes(service, running[0].fullId, destinations);
    succeeded(await service.composeStop(composeFile, undefined, project));
    const stopped = await service.composePs(composeFile, doc, project);
    assert.equal(stopped.length, 1);
    assert.notEqual(stopped[0].status, 'running');
    succeeded(await service.composeScale(composeFile, 'app', 0, project));
    assert.deepEqual(await service.composePs(composeFile, doc, project), []);
    succeeded(await service.composeScale(composeFile, 'app', 1, project));
    const restored = await service.composePs(composeFile, doc, project);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, 'running');
    await assertNoImageVolumes(service, restored[0].fullId, destinations);
    succeeded(await service.composeScale(composeFile, 'app', 2, project));
    assert.equal((await service.composePs(composeFile, doc, project)).length, 2);
  } finally {
    if (attemptedUp) {
      const cleanup = await service.composeDown(composeFile, { projectName: project });
      if (!cleanup.success) {
        throw new Error(`Failed to clean up isolated project ${project}: ${cleanup.stderr}`);
      }
      const remaining = succeeded(await service.runEngineCommand([
        'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
      ]));
      assert.deepEqual(JSON.parse(remaining.stdout), []);
      assert.ok(!(await service.listPods()).some((pod) => pod.name.includes(project)));
      assert.ok(!(await service.listNetworks()).some((network) => network.name.includes(project)));
    }
    if (fs.existsSync(composeFile)) fs.unlinkSync(composeFile);
    fs.rmdirSync(dir);
  }
});

test('exercises isolated Podman containers, pods, storage, network and build', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 600_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.match(image || '', /^[a-zA-Z0-9._:/@+-]+$/, 'PODMAN_TEST_IMAGE must be a local image reference');
  const PodmanService = loadService();
  const service = new PodmanService();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio build space-'));
  const containerfile = path.join(dir, 'Containerfile');
  const prefix = `studiotest${crypto.randomBytes(6).toString('hex')}`;
  const imageTag = `localhost/${prefix}:audit`;
  const network = `${prefix}-network`;
  const volume = `${prefix}-volume`;
  const containers = [`${prefix}-a`, `${prefix}-b`, `${prefix}-pod-a`, `${prefix}-pod-b`];
  const pods = [`${prefix}-pod1`, `${prefix}-pod2`];
  const resources = [
    { kind: 'image', name: imageTag },
    { kind: 'network', name: network },
    { kind: 'volume', name: volume },
    ...containers.map((name) => ({ kind: 'container', name })),
    ...pods.map((name) => ({ kind: 'pod', name })),
  ];
  let cleanupAllowed = false;
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'false',
  });
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];

  async function exists(kind, name) {
    const result = await service.runEngineCommand([kind, 'exists', name]);
    if (result.exitCode === 1) return false;
    succeeded(result);
    return true;
  }

  function idFrom(result) {
    const id = succeeded(result).stdout.trim();
    assert.match(id, /^[a-f0-9]{64}$/i);
    return id;
  }

  async function assertBatch(resource, action, ids) {
    const results = await service.runPodmanBatch(resource, action, ids);
    assert.equal(results.length, ids.length);
    for (const item of results) succeeded(item.result);
  }

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    for (const resource of resources) {
      assert.equal(await exists(resource.kind, resource.name), false, `${resource.kind} collision`);
    }
    cleanupAllowed = true;

    fs.writeFileSync(containerfile, `FROM ${image}\nLABEL studio.audit=${prefix}\n`);
    succeeded(await service.buildImage('Containerfile', imageTag, path.relative(root, dir)));
    succeeded(await service.createNetwork({ name: network }));
    succeeded(await service.createVolume(volume));
    const standaloneIds = [];
    for (const name of containers.slice(0, 2)) {
      standaloneIds.push(idFrom(await service.createContainer({
        name,
        image: imageTag,
        network,
        volumes: [`${volume}:/studio-audit`],
        mounts: tmpfsMounts(destinations),
        command: `sh -c 'echo studio-container-ready; sleep 900'`,
      })));
      await assertNoImageVolumes(service, standaloneIds[standaloneIds.length - 1], destinations);
    }

    const listedContainers = await service.listAllContainers();
    assert.ok(standaloneIds.every((id) => listedContainers.some((item) => item.fullId === id)));
    assert.ok((await service.listNetworks()).some((item) => item.name === network));
    assert.ok((await service.listVolumes()).some((item) => item.name === volume));
    const builtImage = (await service.listImages(listedContainers)).find(
      (item) => item.repository === `localhost/${prefix}` && item.tag === 'audit'
    );
    assert.ok(builtImage, 'the built image must be listed');
    assert.equal(builtImage.inUse, true, 'the image must be marked in use');

    assert.equal((await service.removeNetwork(network)).success, false);
    assert.equal((await service.removeVolume(volume)).success, false);
    assert.equal((await service.removeImage(imageTag)).success, false);
    assert.equal(await exists('network', network), true);
    assert.equal(await exists('volume', volume), true);
    assert.equal(await exists('image', imageTag), true);

    const logs = succeeded(await service.getContainerLogHistory(standaloneIds[0]));
    assert.match(`${logs.stdout}\n${logs.stderr}`, /studio-container-ready/);
    succeeded(await service.pauseContainer(standaloneIds[0]));
    assert.equal(
      (await service.listAllContainers()).find((item) => item.fullId === standaloneIds[0]).state,
      'paused'
    );
    succeeded(await service.unpauseContainer(standaloneIds[0]));
    await assertBatch('container', 'stop', standaloneIds);
    await assertBatch('container', 'start', standaloneIds);
    await assertBatch('container', 'restart', standaloneIds);

    const podIds = [];
    for (let index = 0; index < pods.length; index++) {
      podIds.push(idFrom(await service.createPod({ name: pods[index] })));
      const containerId = idFrom(await service.createContainer({
        name: containers[index + 2],
        pod: pods[index],
        image: imageTag,
        mounts: tmpfsMounts(destinations),
        command: `sh -c 'echo studio-pod-ready; sleep 900'`,
      }));
      await assertNoImageVolumes(service, containerId, destinations);
    }
    const listedPods = await service.listPods();
    assert.ok(podIds.every((id) => listedPods.some((item) => item.fullId === id)));
    const containersWithInfra = await service.listAllContainers();
    assert.ok(containersWithInfra.some((item) => item.isInfra && item.podId === podIds[0].slice(0, 12)));
    const podLogs = succeeded(await service.getPodLogs(podIds[0]));
    assert.match(`${podLogs.stdout}\n${podLogs.stderr}`, /studio-pod-ready/);
    succeeded(await service.pausePod(podIds[0]));
    assert.equal((await service.listPods()).find((item) => item.fullId === podIds[0]).state, 'paused');
    succeeded(await service.unpausePod(podIds[0]));
    await assertBatch('pod', 'stop', podIds);
    await assertBatch('pod', 'start', podIds);
    await assertBatch('pod', 'restart', podIds);
  } finally {
    const cleanupErrors = [];
    async function clean(kind, name, remove) {
      try {
        if (await exists(kind, name)) succeeded(await remove(name));
      } catch (error) {
        cleanupErrors.push(`${kind} ${name}: ${error.message}`);
      }
    }
    if (cleanupAllowed) {
      for (const name of containers) {
        await clean('container', name, (target) => service.removeContainer(target, true));
      }
      for (const name of pods) {
        await clean('pod', name, (target) => service.removePod(target, true));
      }
      await clean('network', network, (target) => service.removeNetwork(target));
      await clean('volume', volume, (target) => service.removeVolume(target));
      await clean('image', imageTag, (target) => service.removeImage(target));
    }
    if (fs.existsSync(containerfile)) fs.unlinkSync(containerfile);
    fs.rmdirSync(dir);
    if (cleanupErrors.length) throw new Error(`Isolated resource cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
});

test('exercises advanced Podman pod and container creation options', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 180_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const service = new (loadService())();
  const prefix = `studiotest${crypto.randomBytes(6).toString('hex')}`;
  const podName = `${prefix}-pod`;
  const containerName = `${prefix}-container`;
  let cleanupAllowed = false;
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'false',
  });

  async function exists(kind, name) {
    const result = await service.runPodmanCommand([kind, 'exists', name]);
    if (result.exitCode === 1) return false;
    succeeded(result);
    return true;
  }

  try {
    succeeded(await service.runPodmanCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    assert.equal(await exists('pod', podName), false, 'Pod name collision');
    assert.equal(await exists('container', containerName), false, 'Container name collision');
    cleanupAllowed = true;

    succeeded(await service.createPod({
      name: podName,
      hostname: 'studio-audit',
      network: 'none',
      cpuShares: '512',
      additionalHosts: ['studio-audit-host:127.0.0.77'],
      labels: [`studio.audit=${prefix}`],
    }));
    const inspection = JSON.parse(succeeded(await service.runPodmanCommand([
      'pod', 'inspect', '--format', 'json', podName,
    ])).stdout);
    const pod = Array.isArray(inspection) ? inspection[0] : inspection;
    assert.equal(pod.Name, podName);
    assert.equal(pod.Labels['studio.audit'], prefix);
    assert.equal(pod.Hostname, 'studio-audit');
    assert.equal(pod.cpu_shares ?? pod.CpuShares ?? pod.CPUShares, 512);
    assert.ok(pod.InfraConfig.HostAdd.includes('studio-audit-host:127.0.0.77'));
    assert.equal(JSON.parse(succeeded(await service.runPodmanCommand([
      'inspect', '--format', '{{json .HostConfig.NetworkMode}}', pod.InfraContainerID,
    ])).stdout), 'none');

    const id = succeeded(await service.createContainer({
      name: containerName,
      image,
      network: 'none',
      restart: 'no',
      cpus: '0.5',
      memory: '128m',
      env: ['STUDIO_AUDIT=advanced-options'],
      mounts: tmpfsMounts(destinations),
      command: "sh -c 'echo studio-advanced-ready; sleep 180'",
    })).stdout.trim();
    assert.match(id, /^[a-f0-9]{64}$/i);
    await assertNoImageVolumes(service, id, destinations);
    const container = JSON.parse(succeeded(await service.runPodmanCommand([
      'inspect', '--format', '{{json .}}', id,
    ])).stdout);
    assert.ok(container.Config.Env.includes('STUDIO_AUDIT=advanced-options'));
    assert.equal(container.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(container.HostConfig.NetworkMode, 'none');
    assert.equal(container.HostConfig.RestartPolicy.Name, 'no');
    assert.ok(
      container.HostConfig.NanoCpus === 500_000_000 ||
      (container.HostConfig.CpuPeriod > 0 &&
        container.HostConfig.CpuQuota * 2 === container.HostConfig.CpuPeriod),
      'Container CPU limit was not applied'
    );
    assert.match(succeeded(await service.getContainerLogHistory(id)).stdout, /studio-advanced-ready/);
  } finally {
    const errors = [];
    if (cleanupAllowed) {
      for (const [kind, name, remove] of [
        ['container', containerName, (target) => service.removeContainer(target, true)],
        ['pod', podName, (target) => service.removePod(target, true)],
      ]) {
        try {
          if (await exists(kind, name)) succeeded(await remove(name));
        } catch (error) {
          errors.push(`${kind} ${name}: ${error.message}`);
        }
      }
    }
    if (errors.length) throw new Error(`Isolated resource cleanup failed:\n${errors.join('\n')}`);
  }
});
