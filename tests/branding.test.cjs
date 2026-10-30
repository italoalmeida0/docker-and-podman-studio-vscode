const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');
const { loadModule, vscode } = require('./podman-harness.cjs');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');

test('the Studio sidebar displays the installed extension version', () => {
  const webviewRoot = path.join(root, 'webview-ui');
  const fixture = path.join(webviewRoot, 'sidebar-version-test.cjs');
  const output = esbuild.buildSync({
    stdin: {
      contents: `
        import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { Sidebar } from './src/components/Sidebar';
        import { useStudioStore } from './src/store';

        export function renderVersion(version) {
          useStudioStore.getInitialState().settings = version
            ? { extensionVersion: version }
            : null;
          return renderToStaticMarkup(React.createElement(Sidebar));
        }
      `,
      resolveDir: webviewRoot,
      sourcefile: 'sidebar-version-test.tsx',
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const instance = new Module(fixture, module);
  instance.filename = fixture;
  instance.paths = Module._nodeModulePaths(webviewRoot);
  const hadNavigator = typeof globalThis.navigator !== 'undefined';
  if (!hadNavigator) globalThis.navigator = { language: 'en' };
  try {
    instance._compile(output, fixture);
    const footer = (version) => {
      const html = instance.exports.renderVersion(version);
      return html.match(/<span class="truncate font-mono text-\[10px\]">([^<]+)<\/span>/)?.[1];
    };
    assert.equal(footer(undefined), 'Docker');
    assert.equal(footer('9.8.7'), 'v9.8.7 · Docker');
    assert.equal(footer('2.3.4'), 'v2.3.4 · Docker');
  } finally {
    if (!hadNavigator) delete globalThis.navigator;
  }
});

test('the activity bar and launcher share a theme-compatible brand icon', () => {
  const activityIcon = manifest.contributes.viewsContainers.activitybar.find(
    (container) => container.id === 'dockerPodmanStudio'
  ).icon;
  const launcherIcon = manifest.contributes.views.dockerPodmanStudio.find(
    (view) => view.id === 'dockerPodmanStudio.launcher'
  ).icon;
  const svg = fs.readFileSync(path.join(root, activityIcon), 'utf8');

  assert.equal(launcherIcon, activityIcon);
  assert.match(svg, /<svg\b[^>]*\bviewBox="[^"]+"/);
  assert.match(svg, /currentColor/);
});

test('the Studio editor tab uses the original extension icon', () => {
  const makeUri = (fsPath) => ({ fsPath, toString: () => fsPath });
  vscode.Uri = {
    file: makeUri,
    joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
  };
  vscode.ViewColumn = { Active: 1 };
  const panel = {
    webview: {
      asWebviewUri: (uri) => uri,
      cspSource: 'vscode-resource:',
      onDidReceiveMessage: () => ({ dispose() {} }),
    },
    onDidDispose: () => ({ dispose() {} }),
    dispose() {},
  };
  vscode.window.createWebviewPanel = () => panel;
  const { StudioWebviewPanel } = loadModule(path.join('src', 'ui', 'webviewProvider.ts'));
  const provider = new StudioWebviewPanel(makeUri(root));

  assert.equal(provider.createOrShowPanel().iconPath.fsPath, path.join(root, manifest.icon));
  assert.deepEqual(fs.readFileSync(panel.iconPath.fsPath).subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  provider.dispose();
});

test('the status bar uses the contributed brand icon in every engine state', () => {
  const icon = manifest.contributes.icons['docker-podman-studio-logo'];
  assert.equal(icon.default.fontCharacter, '\\E001');
  const font = fs.readFileSync(path.join(root, icon.default.fontPath));
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOFF');
  assert.equal(font.readUInt32BE(8), font.length);
  const privateOffset = font.readUInt32BE(36);
  const privateLength = font.readUInt32BE(40);
  assert.ok(privateOffset >= 44 && privateLength === 64 && privateOffset + privateLength <= font.length);
  const activityIcon = manifest.contributes.viewsContainers.activitybar.find(
    (container) => container.id === 'dockerPodmanStudio'
  ).icon;
  const svgHash = createHash('sha256')
    .update(fs.readFileSync(path.join(root, activityIcon), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  assert.equal(font.subarray(privateOffset, privateOffset + privateLength).toString('ascii'), svgHash);

  const items = [];
  vscode.window.createStatusBarItem = () => {
    const item = { show() {}, hide() {}, dispose() {} };
    items.push(item);
    return item;
  };
  const { StatusBarManager } = loadModule(path.join('src', 'ui', 'statusBarManager.ts'));
  const statusBar = StatusBarManager.getInstance();
  for (const [state, expectedSuffix] of [
    [undefined, ''],
    [true, ' $(circle-filled)'],
    [false, ' $(circle-outline)'],
  ]) {
    statusBar.updateMachineBadge(state);
    assert.equal(items[0].text, `$(docker-podman-studio-logo) Docker & Podman (Podman)${expectedSuffix}`);
  }
  statusBar.dispose();
});
