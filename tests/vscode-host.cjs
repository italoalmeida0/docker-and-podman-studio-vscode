const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const vscode = require('vscode');
const { assertNoImageVolumes, imageVolumeDestinations, tmpfsMounts } =
  require('./podman-test-util.cjs');

function loadPodmanService() {
  const entry = path.resolve(__dirname, '..', 'src', 'services', 'podmanService.ts');
  const output = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const instance = new Module(entry, module);
  instance.filename = entry;
  instance.paths = Module._nodeModulePaths(path.dirname(entry));
  instance._compile(output, entry);
  return instance.exports.PodmanService;
}

function succeeded(result) {
  assert.equal(result.success, true, `${result.commandStr || 'command'}: ${result.stderr}`);
  return result;
}

async function waitFor(predicate, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(typeof message === 'function' ? message() : message);
}

async function run() {
  const image = process.env.PODMAN_TEST_IMAGE;
  assert.ok(image, 'Set PODMAN_TEST_IMAGE to a locally available image');
  const config = vscode.workspace.getConfiguration('dockerPodmanStudio');
  await config.update('engine', 'podman', vscode.ConfigurationTarget.Global);
  await config.update('autoDetectFiles', false, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension('ItaloAlmeida.docker-and-podman-studio');
  assert.ok(extension, 'Development extension is not available');
  await extension.activate();
  await vscode.commands.executeCommand('dockerPodmanStudio.openPanel');
  await waitFor(
    () => vscode.window.tabGroups.all.some((group) => group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputWebview &&
        ['dockerPodmanStudio', 'mainThreadWebview-dockerPodmanStudio'].includes(tab.input.viewType)
    )),
    () => `Studio webview did not open: ${JSON.stringify(vscode.window.tabGroups.all.map(
      (group) => group.tabs.map((tab) => ({
        label: tab.label,
        input: tab.input?.constructor?.name,
        viewType: tab.input?.viewType,
      }))
    ))}`
  );
  console.log('Studio webview opened in the Extension Development Host');

  const PodmanService = loadPodmanService();
  const service = new PodmanService();
  const name = `studiovscodetest${crypto.randomBytes(6).toString('hex')}`;
  let containerId;
  let cleanupAllowed = false;
  let terminal;
  try {
    succeeded(await service.runPodmanCommand(['image', 'exists', image]));
    const destinations = await imageVolumeDestinations(service, image);
    const existing = await service.runPodmanCommand(['container', 'exists', name]);
    assert.equal(existing.exitCode, 1, 'Isolated container name is already in use');
    cleanupAllowed = true;
    containerId = succeeded(await service.createContainer({
      name,
      image,
      mounts: tmpfsMounts(destinations),
      command: "sh -c 'echo studio-terminal-ready; sleep 180'",
    })).stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/i);
    await assertNoImageVolumes(service, containerId, destinations);

    service.openContainerTerminal(containerId, name);
    terminal = vscode.window.terminals.find((item) => item.name === `Podman: ${name}`);
    assert.ok(terminal, 'Interactive Podman terminal was not created');
    assert.ok(await terminal.processId, 'Interactive Podman terminal did not start a process');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        reject(new Error('Interactive terminal did not exit'));
      }, 20_000);
      const disposable = vscode.window.onDidCloseTerminal((item) => {
        if (item === terminal) {
          clearTimeout(timer);
          disposable.dispose();
          resolve(item);
        }
      });
    });
    terminal.sendText('exit');
    await closed;
    assert.equal(terminal.exitStatus?.code, 0, 'Interactive Podman terminal exited unsuccessfully');
    terminal = undefined;

    await service.openLogsExternal(containerId, name, 'terminal');
    terminal = vscode.window.terminals.find((item) => item.name === `Podman Logs: ${name}`);
    assert.ok(terminal, 'Podman logs terminal was not created');
    assert.ok(await terminal.processId, 'Podman logs terminal did not start a process');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal(terminal.exitStatus, undefined, 'Podman logs terminal exited unexpectedly');
    console.log('Interactive shell and live logs terminals started successfully');
  } finally {
    terminal?.dispose();
    if (cleanupAllowed) {
      const remaining = await service.runPodmanCommand(['container', 'exists', name]);
      if (remaining.success) {
        succeeded(await service.removeContainer(name, true));
      } else {
        assert.equal(remaining.exitCode, 1, remaining.stderr);
      }
    }
  }
}

exports.run = async function runTests() {
  try {
    await run();
    if (process.env.PODMAN_VSCODE_TEST_RESULT) {
      fs.writeFileSync(process.env.PODMAN_VSCODE_TEST_RESULT, 'passed\n');
    }
  } catch (error) {
    if (process.env.PODMAN_VSCODE_TEST_RESULT) {
      fs.writeFileSync(process.env.PODMAN_VSCODE_TEST_RESULT, `failed\n${error.stack || error}\n`);
    }
    throw error;
  }
};
