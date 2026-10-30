const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { config, loadService, vscode } = require('./podman-harness.cjs');
const { composeTmpfs, imageVolumeDestinations, tmpfsMounts } = require('./podman-test-util.cjs');

const enabled = process.env.PODMAN_INTEGRATION_TESTS === '1';

function succeeded(result) {
  assert.equal(result.success, true, `${result.commandStr || 'command'}: ${result.stderr}`);
  return result;
}

function setup() {
  Object.assign(config, {
    engine: 'podman',
    podmanPath: 'podman',
    composePath: '',
    composeCommandStyle: 'auto',
    inPod: 'false',
  });
  return new (loadService())();
}

test('real Podman protects referenced storage and removes only selected test resources', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 300_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const service = setup();
  const prefix = `studiocleanup${crypto.randomBytes(6).toString('hex')}`;
  const names = {
    container: `${prefix}-container`,
    usedVolume: `${prefix}-used-volume`,
    freeVolume: `${prefix}-free-volume`,
    usedNetwork: `${prefix}-used-network`,
    freeNetwork: `${prefix}-free-network`,
    image: `localhost/${prefix}:test`,
  };
  const resources = [
    ['container', names.container],
    ['volume', names.usedVolume], ['volume', names.freeVolume],
    ['network', names.usedNetwork], ['network', names.freeNetwork],
    ['image', names.image],
  ];
  let cleanupAllowed = false;

  async function exists(kind, name) {
    const result = await service.runEngineCommand([kind, 'exists', name]);
    if (result.exitCode === 1) return false;
    succeeded(result);
    return true;
  }

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    for (const [kind, name] of resources) {
      assert.equal(await exists(kind, name), false, `${kind} collision: ${name}`);
    }
    cleanupAllowed = true;
    const destinations = await imageVolumeDestinations(service, image);
    succeeded(await service.createVolume(names.usedVolume));
    succeeded(await service.createVolume(names.freeVolume));
    succeeded(await service.createNetwork({ name: names.usedNetwork }));
    succeeded(await service.createNetwork({ name: names.freeNetwork }));
    const created = succeeded(await service.runEngineCommand([
      'create', '--name', names.container, '--network', names.usedNetwork,
      '-v', `${names.usedVolume}:/studio-data`,
      ...tmpfsMounts(destinations).flatMap((mount) => ['--mount', mount]),
      image, 'sh', '-c', 'sleep 900',
    ]));
    const containerId = created.stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/i);

    async function checkUsage() {
      const volumes = await service.listVolumes();
      const networks = await service.listNetworks();
      const usedVolume = volumes.find((volume) => volume.name === names.usedVolume);
      const freeVolume = volumes.find((volume) => volume.name === names.freeVolume);
      const usedNetwork = networks.find((network) => network.name === names.usedNetwork);
      const freeNetwork = networks.find((network) => network.name === names.freeNetwork);
      assert.equal(usedVolume?.usage, 'inUse');
      assert.equal(freeVolume?.usage, 'unused');
      assert.equal(usedNetwork?.usage, 'inUse');
      assert.equal(freeNetwork?.usage, 'unused');
      assert.ok(networks.some((network) => network.protected));
      return { usedVolume, freeVolume, usedNetwork, freeNetwork };
    }

    await checkUsage();
    succeeded(await service.runEngineCommand(['container', 'start', containerId]));
    succeeded(await service.runEngineCommand(['container', 'stop', '--time', '1', containerId]));
    const resourcesAfterStop = await checkUsage();
    await assert.rejects(() => service.removeResourceSelection('volume', [{
      name: names.usedVolume, identity: resourcesAfterStop.usedVolume.created,
    }], 'podman'), /in use/i);
    await assert.rejects(() => service.removeResourceSelection('network', [{
      name: names.usedNetwork, identity: resourcesAfterStop.usedNetwork.fullId,
    }], 'podman'), /in use/i);

    const volumeResult = await service.removeResourceSelection('volume', [{
      name: names.freeVolume, identity: resourcesAfterStop.freeVolume.created,
    }], 'podman');
    const networkResult = await service.removeResourceSelection('network', [{
      name: names.freeNetwork, identity: resourcesAfterStop.freeNetwork.fullId,
    }], 'podman');
    succeeded(volumeResult[0].result);
    succeeded(networkResult[0].result);
    assert.equal(await exists('volume', names.freeVolume), false);
    assert.equal(await exists('network', names.freeNetwork), false);
    assert.equal(await exists('volume', names.usedVolume), true);
    assert.equal(await exists('network', names.usedNetwork), true);

    succeeded(await service.runEngineCommand(['tag', image, names.image]));
    const tagged = (await service.listImages()).find((item) =>
      `${item.repository}:${item.tag}` === names.image
    );
    assert.ok(tagged, 'the isolated test tag should be listed');
    const imageResult = await service.removeResourceSelection('image', [{
      name: names.image, identity: tagged.fullId,
    }], 'podman');
    succeeded(imageResult[0].result);
    assert.equal(await exists('image', names.image), false);
    assert.equal(await exists('image', image), true);
  } finally {
    const errors = [];
    if (cleanupAllowed) {
      for (const [kind, name] of resources) {
        try {
          if (await exists(kind, name)) {
            const args = kind === 'container'
              ? ['container', 'rm', '-f', name]
              : [kind, 'rm', '--', name];
            succeeded(await service.runEngineCommand(args));
          }
        } catch (error) {
          errors.push(`${kind} ${name}: ${error.message}`);
        }
      }
    }
    if (errors.length) throw new Error(`Isolated resource cleanup failed:\n${errors.join('\n')}`);
  }
});

test('real Podman removes selected Compose replicas and leaves other services running', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 360_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const service = setup();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio-selected-compose-'));
  const file = path.join(dir, 'compose.yaml');
  const project = `studioselected${crypto.randomBytes(6).toString('hex')}`;
  let attemptedUp = false;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const existing = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(existing.stdout), []);
    const destinations = await imageVolumeDestinations(service, image);
    const content = [
      `name: ${project}`,
      'services:',
      ...['app', 'worker', 'keep'].flatMap((name) => [
        `  ${name}:`,
        `    image: ${JSON.stringify(image)}`,
        '    command: ["sh", "-c", "sleep 900"]',
        '    stop_grace_period: 1s',
        ...composeTmpfs(destinations),
      ]),
      '',
    ].join('\n');
    fs.writeFileSync(file, content);
    const doc = { name: project, services: { app: {}, worker: {}, keep: {} } };
    attemptedUp = true;
    succeeded(await service.composeUp(file));
    succeeded(await service.composeScale(file, 'app', 2));
    succeeded(await service.composeStop(file, ['worker']));
    const before = await service.composePs(file, doc);
    assert.equal(before.filter((container) => container.service === 'app').length, 2);
    assert.equal(before.find((container) => container.service === 'worker')?.status, 'exited');

    const result = succeeded(await service.composeRemoveServices(file, ['app', 'worker'], doc, content));
    assert.match(result.stdout, /app/);
    const after = await service.composePs(file, doc);
    assert.deepEqual(after.map((container) => [container.service, container.status]), [['keep', 'running']]);
  } finally {
    if (attemptedUp) {
      const cleanup = await service.composeDown(file, { projectName: project });
      if (!cleanup.success) throw new Error(`Failed to clean up isolated project ${project}: ${cleanup.stderr}`);
      const remaining = succeeded(await service.runEngineCommand([
        'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
      ]));
      assert.deepEqual(JSON.parse(remaining.stdout), []);
    }
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('real Podman builds only the selected Compose services', {
  skip: !enabled && 'Set PODMAN_INTEGRATION_TESTS=1 and PODMAN_TEST_IMAGE to a local image.',
  timeout: 360_000,
}, async () => {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'PODMAN_TEST_IMAGE must name an image already available locally');
  const service = setup();
  const root = process.env.PODMAN_TEST_ROOT || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'studio-selected-build-'));
  const file = path.join(dir, 'compose.yaml');
  const containerfile = path.join(dir, 'Containerfile');
  const project = `studiobuild${crypto.randomBytes(6).toString('hex')}`;
  const images = Object.fromEntries(['app', 'worker', 'keep'].map((name) =>
    [name, `localhost/${project}-${name}:built`]
  ));
  const previousFolders = vscode.workspace.workspaceFolders;
  let cleanupAllowed = false;
  let attemptedUp = false;
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: dir } }];

  async function imageExists(name) {
    const result = await service.runEngineCommand(['image', 'exists', name]);
    if (result.exitCode === 1) return false;
    succeeded(result);
    return true;
  }

  try {
    succeeded(await service.runEngineCommand(['image', 'exists', image]));
    const existing = succeeded(await service.runEngineCommand([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
    ]));
    assert.deepEqual(JSON.parse(existing.stdout), []);
    for (const name of Object.values(images)) assert.equal(await imageExists(name), false);
    cleanupAllowed = true;
    const destinations = await imageVolumeDestinations(service, image);
    fs.writeFileSync(containerfile, `FROM ${image}\nLABEL studio.integration=${project}\n`);
    fs.writeFileSync(file, [
      `name: ${project}`,
      'services:',
      ...Object.entries(images).flatMap(([name, tag]) => [
        `  ${name}:`,
        `    image: ${JSON.stringify(tag)}`,
        '    build:',
        '      context: .',
        '      dockerfile: Containerfile',
        '    network_mode: none',
        '    command: ["sh", "-c", "sleep 900"]',
        '    stop_grace_period: 1s',
        ...composeTmpfs(destinations),
      ]),
      '',
    ].join('\n'));

    attemptedUp = true;
    succeeded(await service.composeBuild(file, ['app', 'worker']));
    const statuses = await service.composePs(file, {
      name: project, services: { app: {}, worker: {}, keep: {} },
    });
    assert.deepEqual(statuses.map((item) => item.service).sort(), ['app', 'worker']);
    assert.ok(statuses.every((item) => item.status === 'running'));
    assert.equal(await imageExists(images.app), true);
    assert.equal(await imageExists(images.worker), true);
    assert.equal(await imageExists(images.keep), false);
  } finally {
    const errors = [];
    let projectClean = true;
    if (attemptedUp) {
      try {
        succeeded(await service.composeDown(file, { projectName: project }));
        const remaining = succeeded(await service.runEngineCommand([
          'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', 'json',
        ]));
        assert.deepEqual(JSON.parse(remaining.stdout), []);
      } catch (error) {
        projectClean = false;
        errors.push(`Compose project ${project}: ${error.message}`);
      }
    }
    if (cleanupAllowed && projectClean) {
      for (const tag of Object.values(images)) {
        try {
          if (await imageExists(tag)) succeeded(await service.runEngineCommand(['image', 'rm', '--', tag]));
        } catch (error) {
          errors.push(`Image ${tag}: ${error.message}`);
        }
      }
    }
    if (projectClean) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(containerfile)) fs.unlinkSync(containerfile);
      fs.rmdirSync(dir);
    }
    vscode.workspace.workspaceFolders = previousFolders;
    if (errors.length) throw new Error(`Isolated build cleanup failed:\n${errors.join('\n')}`);
  }
});
