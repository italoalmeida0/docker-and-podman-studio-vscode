const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Cdp, availablePort, sleep, waitFor } = require('./browser-harness.cjs');

const browserPath = process.env.STUDIO_BROWSER_PATH;
const artifactDir = process.env.STUDIO_METRICS_ARTIFACTS || '';
const root = path.resolve(__dirname, '..');
const uiRoot = path.join(root, 'webview-ui');
const vite = path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const THEME = `
  :root {
    --vscode-editor-background: #1e1e1e;
    --vscode-sideBar-background: #252526;
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-disabledForeground: rgba(204, 204, 204, 0.5);
    --vscode-panel-border: #3c3c3c;
    --vscode-editorWidget-border: #454545;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-button-background: #0e639c;
    --vscode-input-border: #3c3c3c;
    --vscode-charts-blue: #3794ff;
    --vscode-charts-green: #89d185;
    --vscode-charts-orange: #d18616;
    --vscode-charts-purple: #b180d7;
    --vscode-charts-yellow: #cca700;
    --vscode-charts-foreground: #cccccc;
    --vscode-testing-iconPassed: #73c991;
    --vscode-editorWarning-foreground: #cca700;
  }
  body { background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: 'Segoe UI', sans-serif; }
`;

const containerId = (seed) => seed.repeat(12).slice(0, 12);
const fixtureContainers = [
  { id: containerId('a'), fullId: containerId('a').padEnd(64, 'a'), name: 'checkout-api', image: 'ghcr.io/example/checkout:2.4', state: 'running', status: 'Up 2 hours', ports: '127.0.0.1:8080->8080/tcp' },
  { id: containerId('b'), fullId: containerId('b').padEnd(64, 'b'), name: 'cache-redis', image: 'docker.io/library/redis:7-alpine', state: 'running', status: 'Up 2 hours', ports: '6379/tcp' },
  { id: containerId('c'), fullId: containerId('c').padEnd(64, 'c'), name: 'batch-worker', image: 'docker.io/library/alpine:3.20', state: 'exited', status: 'Exited (0) 3 minutes ago', ports: '' },
].map((container) => ({
  ...container,
  imageId: 'sha256:' + 'd'.repeat(64),
  portMappings: [],
  created: '2026-10-30T10:00:00Z',
  podId: '',
  podName: '',
  isCompose: false,
  composeProject: '',
  composeService: '',
  composeFile: '',
  composeFiles: [],
  networks: ['podman'],
  mounts: [],
  command: 'sh',
  isInfra: false,
}));

const settings = {
  engine: 'podman', language: 'en', podmanPath: 'podman', dockerPath: 'docker', composeCommandStyle: 'auto',
  composePath: '', inPod: 'default', machineName: 'podman-machine-default', pollingInterval: 2500, logBufferSize: 5000,
  longOperationTimeoutMinutes: 60, autoDetectFiles: false, confirmDeletions: true, logsOutput: 'studio',
  enablePushCommand: true, pushDefaultRegistry: '', registryProvider: 'dockerhub', registryUrl: '',
  registryAuthType: 'engineCli', registryUsername: '', registryAutoLogin: false,
};

function syntheticBatch(running, tick) {
  return running.map((container, index) => {
    const phase = (120 - tick) / 7 + index * 1.7;
    const cpu = 36 + 30 * Math.sin(phase) + 6 * Math.sin(phase * 3.1);
    return {
      id: container.id,
      name: container.name,
      cpuPercent: Math.max(0, cpu),
      memUsageBytes: 180_000_000 + index * 420_000_000 + (120 - tick) * 350_000 + 25_000_000 * Math.sin(phase / 2),
      memLimitBytes: 8_197_431_296,
      memPercent: 1.2 + index * 4,
      netRxRate: 1100 + 900 * Math.abs(Math.sin(phase)),
      netTxRate: 420 + 260 * Math.abs(Math.cos(phase)),
      blockReadRate: index === 0 ? 0 : 60_000 * Math.abs(Math.sin(phase * 1.3)),
      blockWriteRate: index === 0 ? 0 : 25_000 + 40_000 * Math.abs(Math.cos(phase)),
      pids: 2 + index + (tick % 9 === 0 ? 1 : 0),
    };
  });
}

const runningFixture = fixtureContainers.filter((container) => container.state === 'running');

test('live metrics render charts from the host stream and stay usable on narrow windows', {
  skip: !browserPath && 'Set STUDIO_BROWSER_PATH to a Chromium browser to run the live metrics UI test',
  timeout: 240_000,
}, async () => {
  assert.ok(fs.existsSync(browserPath), `Browser not found: ${browserPath}`);
  assert.ok(fs.existsSync(vite), 'Install the existing webview dependencies before running this test');
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-metrics-test-'));
  const vitePort = await availablePort();
  const chromePort = await availablePort();
  const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: uiRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const child of [server, chrome]) {
    child.stdout.on('data', (data) => { logs = (logs + data).slice(-8000); });
    child.stderr.on('data', (data) => { logs = (logs + data).slice(-8000); });
  }

  let page;
  const screenshot = async (name) => {
    if (!artifactDir) return;
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifactDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  try {
    await waitFor(async () => {
      if (server.exitCode !== null) throw new Error(`Vite exited: ${logs}`);
      return (await fetch(`http://127.0.0.1:${vitePort}/`)).ok;
    }, 'Vite');
    const target = await waitFor(async () => {
      if (chrome.exitCode !== null) throw new Error(`Browser exited: ${logs}`);
      const targets = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
      return targets.find((item) => item.type === 'page');
    }, 'browser page');
    page = new Cdp(target.webSocketDebuggerUrl);
    await page.open();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__studioMessages = [];
        window.acquireVsCodeApi = () => ({
          postMessage: (message) => window.__studioMessages.push(message),
          getState: () => ({}), setState: () => {},
        });
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = ${JSON.stringify(THEME)};
          document.head.appendChild(style);
        });`,
    });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });
    await waitFor(() => page.evaluate(`return Boolean(document.querySelector('aside nav button'));`), 'Studio');

    await page.evaluate(`
      const { useStudioStore } = await import('/src/store.ts');
      useStudioStore.getState().setSettings(${JSON.stringify(settings)});
      useStudioStore.setState({
        engine: 'podman',
        allContainers: ${JSON.stringify(fixtureContainers)},
        pods: [], images: [], volumes: [], networks: [], composeFiles: [],
        systemInfo: { engine: 'podman', hostname: 'test-host', engineVersion: '5.0.0', podmanVersion: '5.0.0', apiVersion: '5.0.0', composeVersion: '1.0', os: 'Linux', kernel: '6.0', architecture: 'x86_64', cpus: 8, memoryTotal: '8 GB', memoryFree: '4 GB', storageDriver: 'overlay', remoteSocket: '/run/user/1000/podman/podman.sock', containersRunning: 2, containersStopped: 1, containersPaused: 0, containersTotal: 3, images: 0, podsTotal: 0, podsRunning: 0 },
      });
      useStudioStore.getState().setActivePage('containers');
      await new Promise((resolve) => setTimeout(resolve, 150));
    `);
    await waitFor(() => page.evaluate(`return [...document.querySelectorAll('button[role="tab"]')].some((b) => b.textContent.includes('Live'));`), 'the Containers view switcher');

    // Feed two minutes of history through the same window messages the Extension Host sends.
    await page.evaluate(`
      const synthetic = ${syntheticBatch.toString()};
      const running = ${JSON.stringify(runningFixture)};
      const now = Date.now();
      for (let tick = 120; tick >= 0; tick -= 1) {
        const at = now - tick * 1000;
        window.postMessage({ command: 'stats:status', engine: 'podman', payload: { engine: 'podman', state: 'live' } }, '*');
        window.postMessage({ command: 'stats:samples', engine: 'podman', payload: { at, samples: synthetic(running, tick) } }, '*');
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    `);

    const tabClicked = await page.evaluate(`
      const tab = [...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent.includes('Live'));
      tab.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return tab.getAttribute('aria-selected');
    `);
    assert.equal(tabClicked, 'true', 'the live metrics tab becomes selected');
    const watchStart = await page.evaluate(`return window.__studioMessages.filter((m) => m.command === 'stats:watch').at(-1);`);
    assert.deepEqual(watchStart, { command: 'stats:watch', payload: { engine: 'podman', active: true } }, 'entering the view starts the host stream');

    const live = await page.evaluate(`
      await new Promise((resolve) => setTimeout(resolve, 200));
      const cards = [...document.querySelectorAll('[role="button"][aria-label$="live metrics"]')];
      return {
        status: document.querySelector('[role="status"]')?.textContent?.trim() ?? '',
        cards: cards.map((card) => card.getAttribute('aria-label')),
        sparklinePaths: [...document.querySelectorAll('svg[role="img"] path[d]')].filter((path) => (path.getAttribute('d') || '').length > 20).length,
        totals: [...document.querySelectorAll('section[aria-label] .text-2xl')].map((node) => node.textContent.trim()),
      };
    `);
    assert.equal(live.status, 'Live', 'the status chip reports a live stream');
    assert.deepEqual([...live.cards].sort(), ['cache-redis · live metrics', 'checkout-api · live metrics'], 'only running containers are monitored');
    assert.ok(live.sparklinePaths >= 4, 'each running container draws CPU and memory sparklines');
    assert.equal(live.totals.length, 4, 'four totals are shown');
    await screenshot('live-overview-1440');

    // Open the details of the first container and check the five charts.
    await page.evaluate(`document.querySelector('[role="button"][aria-label="checkout-api · live metrics"]').click(); await new Promise((r) => setTimeout(r, 400));`);
    const dialog = await page.evaluate(`
      const dialog = document.querySelector('[role="dialog"]');
      const canvases = [...(dialog?.querySelectorAll('.uplot canvas') ?? [])].map((canvas) => ({ width: canvas.width, height: canvas.height }));
      return { label: dialog?.getAttribute('aria-label') ?? null, charts: dialog?.querySelectorAll('.uplot').length ?? 0, canvases };
    `);
    assert.equal(dialog.label, 'checkout-api · live metrics');
    assert.equal(dialog.charts, 5, 'CPU, memory, network, block I/O and processes are charted');
    assert.ok(dialog.canvases.every((canvas) => canvas.width > 0 && canvas.height > 0), 'every chart has a drawn canvas');
    await screenshot('details-1440');

    // Hover the CPU chart: the tooltip must list every value at the cursor.
    const hoverPoint = await page.evaluate(`
      const over = document.querySelector('[role="dialog"] .uplot .u-over');
      const rect = over.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.6, y: rect.top + rect.height * 0.5 };
    `);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y });
    await sleep(250);
    const tooltip = await page.evaluate(`
      const visible = [...document.querySelectorAll('[role="dialog"] [role="img"] > div')].find((node) => !node.hidden && node.textContent.includes('CPU'));
      return visible ? visible.textContent : null;
    `);
    assert.ok(tooltip && /CPU/.test(tooltip) && /%/.test(tooltip), `the CPU tooltip shows its value (got ${tooltip})`);

    // Pause stops the stream request and resume restarts it.
    await page.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Pause')).click(); await new Promise((r) => setTimeout(r, 200));`);
    const paused = await page.evaluate(`return window.__studioMessages.filter((m) => m.command === 'stats:watch').at(-1);`);
    assert.deepEqual(paused, { command: 'stats:watch', payload: { engine: 'podman', active: false } });
    await page.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Resume')).click(); await new Promise((r) => setTimeout(r, 200));`);
    const resumed = await page.evaluate(`return window.__studioMessages.filter((m) => m.command === 'stats:watch').at(-1);`);
    assert.deepEqual(resumed, { command: 'stats:watch', payload: { engine: 'podman', active: true } });

    // Window selector changes the time range.
    await page.evaluate(`[...document.querySelectorAll('[role="dialog"] [role="group"] button')].find((b) => b.textContent.trim() === '5 min').click(); await new Promise((r) => setTimeout(r, 200));`);
    const windowPressed = await page.evaluate(`return [...document.querySelectorAll('[role="dialog"] [role="group"] button')].find((b) => b.textContent.trim() === '5 min').getAttribute('aria-pressed');`);
    assert.equal(windowPressed, 'true');

    // Escape closes the dialog and keeps the overview.
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    assert.equal(await page.evaluate(`return Boolean(document.querySelector('[role="dialog"]'));`), false, 'Escape closes the details');

    // Narrow window: nothing overflows horizontally and the details still fit.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const narrowOverview = await page.evaluate(`
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth };
    `);
    assert.ok(narrowOverview.scroll <= narrowOverview.inner + 1, `the overview does not overflow at 360px (scroll ${narrowOverview.scroll})`);
    await screenshot('live-overview-360');

    await page.evaluate(`document.querySelector('[role="button"][aria-label="cache-redis · live metrics"]').click(); await new Promise((r) => setTimeout(r, 400));`);
    const narrowDialog = await page.evaluate(`
      const dialog = document.querySelector('[role="dialog"]');
      const box = dialog.firstElementChild.getBoundingClientRect();
      const charts = [...dialog.querySelectorAll('.uplot')].map((node) => node.getBoundingClientRect().width);
      return { width: box.width, viewport: window.innerWidth, widest: Math.max(0, ...charts), overflow: dialog.firstElementChild.scrollWidth - dialog.firstElementChild.clientWidth };
    `);
    assert.ok(narrowDialog.width <= narrowDialog.viewport, 'the details dialog fits the 360px window');
    assert.ok(narrowDialog.widest <= narrowDialog.viewport, 'no chart is wider than the window');
    assert.ok(narrowDialog.overflow <= 1, `the details content does not overflow (${narrowDialog.overflow}px)`);
    await screenshot('details-360');

    const isBrowserExtensionOrigin = (url) => typeof url === 'string' && /^(chrome-extension|moz-extension|edge|devtools):/.test(url);
    const errors = page.events.filter((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails ?? {};
        return !isBrowserExtensionOrigin(details.url) && !isBrowserExtensionOrigin(details.stackTrace?.callFrames?.[0]?.url);
      }
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        return !isBrowserExtensionOrigin(event.params.stackTrace?.callFrames?.[0]?.url);
      }
      return false;
    });
    assert.deepEqual(errors.map((event) => event.params.exceptionDetails?.exception?.description || event.params.args?.[0]?.value || 'error'), [], 'the page reports no runtime errors');
    page.close();
  } finally {
    chrome.kill();
    server.kill();
    await sleep(800);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // Chromium can keep a profile lock briefly; the directory lives in the OS temp folder.
    }
  }
});
