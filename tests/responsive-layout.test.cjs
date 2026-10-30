const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const browserPath = process.env.STUDIO_BROWSER_PATH;
const root = path.resolve(__dirname, '..');
const uiRoot = path.join(root, 'webview-ui');
const vite = path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(fn, description, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = (event) => {
      const response = JSON.parse(event.data);
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      clearTimeout(request.timer);
      if (response.error) request.reject(new Error(response.error.message));
      else request.resolve(response.result);
    };
    this.socket.onclose = () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Browser connection closed'));
      }
      this.pending.clear();
    };
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out sending ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(body) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const composeFile = 'C:\\workspace\\compose.yaml';
const containerId = 'a'.repeat(64);
const podId = 'b'.repeat(64);
const imageId = 'c'.repeat(64);
const networkName = 'a-very-long-compose-network-name-for-responsive-layout';
const volumeName = 'a-very-long-compose-volume-name-for-responsive-layout';
const projectName = 'money-talk-example-project';
const serviceName = 'very-long-service-name-for-testing';
const settings = {
  engine: 'podman',
  language: 'en',
  podmanPath: 'podman',
  dockerPath: 'docker',
  composeCommandStyle: 'auto',
  composePath: '',
  inPod: 'default',
  machineName: 'podman-machine-default',
  pollingInterval: 2500,
  logBufferSize: 5000,
  longOperationTimeoutMinutes: 60,
  autoDetectFiles: false,
  confirmDeletions: true,
  logsOutput: 'studio',
  enablePushCommand: true,
  pushDefaultRegistry: '',
  registryProvider: 'dockerhub',
  registryUrl: '',
  registryAuthType: 'engineCli',
  registryUsername: '',
  registryAutoLogin: false,
};
const fixture = {
  systemInfo: {
    engine: 'podman', hostname: 'desktop-test-host', engineVersion: '5.0.0', podmanVersion: '5.0.0',
    apiVersion: '5.0.0', composeVersion: '1.0', os: 'Linux', kernel: '6.0',
    architecture: 'x86_64', cpus: 4, memoryTotal: '4 GB', memoryFree: '2 GB',
    storageDriver: 'overlay', remoteSocket: '/run/user/1000/podman/podman.sock',
    containersRunning: 1, containersStopped: 0, containersPaused: 0, containersTotal: 1,
    images: 2, podsTotal: 1, podsRunning: 1,
  },
  machines: [{
    name: 'podman-machine-with-a-long-name-for-testing', default: true, running: true,
    starting: false, vmType: 'wsl', cpus: 4, memory: '4 GB', diskSize: '30 GB',
    lastUp: '2026-01-01',
  }],
  diskUsage: [
    { type: 'Images', total: '12', active: '3', size: '2.5 GB', reclaimable: '1.2 GB (48%)' },
    { type: 'Containers', total: '5', active: '1', size: '450 MB', reclaimable: '350 MB (78%)' },
  ],
  pods: [{
    id: podId.slice(0, 12), fullId: podId, name: 'pod_money-talk-long-project-name',
    status: 'Running', state: 'running', created: '2026-01-01', infraId: '',
    networks: [networkName], labels: {},
    containers: [{ id: containerId, name: 'money-talk-redis-1', status: 'running', state: 'running', restartCount: 0 }],
  }],
  allContainers: [{
    id: containerId.slice(0, 12), fullId: containerId, name: 'money-talk-redis-1',
    image: 'docker.io/library/redis:7-alpine', imageId,
    status: 'Up 10 minutes', state: 'running', ports: '127.0.0.1:6379->6379/tcp',
    portMappings: [], created: '2026-01-01', podId,
    podName: 'pod_money-talk-long-project-name', isCompose: true, composeProject: projectName,
    composeService: 'redis', composeFile, composeFiles: [composeFile], networks: [networkName],
    mounts: [], command: 'redis-server', isInfra: false,
  }],
  images: [{
    id: imageId.slice(0, 12), fullId: imageId, repository: 'docker.io/library/redis',
    tag: '7-alpine', names: ['docker.io/library/redis:7-alpine'], size: '35.4 MB',
    sizeBytes: 35400000, created: '2026-01-01', containers: 1, inUse: true, dangling: false, digest: '',
  }, {
    id: 'd'.repeat(12), fullId: 'd'.repeat(64),
    repository: 'quay.io/very-long-organization-name/very-long-container-image-name',
    tag: 'a-very-long-image-tag-for-responsive-layout', names: [], size: '35.4 MB',
    sizeBytes: 35400000, created: '2026-01-01', containers: 0, inUse: false, dangling: false, digest: '',
  }],
  volumes: [{
    name: volumeName, driver: 'local', mountpoint: '/var/lib/containers/storage/volumes/test/_data',
    created: '2026-01-01', scope: 'local', anonymous: false, composeProject: projectName,
    labels: {}, usage: 'unused',
  }],
  networks: [{
    id: 'e'.repeat(12), fullId: 'e'.repeat(64), name: networkName, driver: 'bridge',
    networkInterface: 'podman0', created: '2026-01-01',
    subnets: [{ subnet: '10.0.0.0/24', gateway: '10.0.0.1' }],
    dnsEnabled: true, internal: false, ipv6Enabled: false, composeProject: projectName,
    usage: 'unused', protected: false,
  }],
  document: {
    services: {
      redis: {
        image: 'redis:7-alpine', build: '.',
        environment: { SUPER_LONG_ENVIRONMENT_VARIABLE: 'a'.repeat(40) },
        networks: [networkName, 'secondary-network'],
        volumes: [`${volumeName}:/data`, './config:/config'],
        env_file: ['demo.env'],
      },
      [serviceName]: { image: 'redis:7-alpine', build: '.' },
    },
    networks: { [networkName]: {}, 'secondary-network': {} },
    volumes: { [volumeName]: {}, 'secondary-volume': {} },
  },
  activeFile: composeFile,
  rawYaml: 'services:\n  redis:\n    image: redis:7-alpine\n',
  composeFiles: [composeFile],
  composeProject: {
    options: { files: [composeFile], profiles: [] }, revision: 'test-revision',
    error: null, resolving: false, customized: false, dependenciesIncomplete: false,
  },
  serviceFragments: { redis: 'image: redis:7-alpine', [serviceName]: 'image: redis:7-alpine' },
  composeContainers: [{
    id: containerId.slice(0, 12), fullId: containerId, name: 'money-talk-redis-1', service: 'redis',
    status: 'running', ports: [], image: 'redis:7-alpine', uptime: '10m',
    podId, podName: 'pod_money-talk-long-project-name',
  }],
  logEntries: [{
    timestamp: '2026-01-01T10:00:00Z', service: serviceName,
    level: 'info', message: 'A long log line for checking narrow windows without horizontal clipping.',
  }],
};

const locales = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'pl', 'tr', 'nl', 'ja', 'ko', 'zh-CN', 'zh-TW', 'hi'];
const scenarios = [
  { width: 200, height: 420, locales },
  { width: 240, height: 420, locales: ['en', 'pt-BR'] },
  { width: 280, height: 480, locales: ['en', 'pt-BR', 'de'] },
  { width: 320, height: 480, locales },
  { width: 360, height: 420, locales: ['en', 'pt-BR'] },
  { width: 480, height: 600, locales: ['en', 'pt-BR', 'de'] },
  { width: 768, height: 600, locales: ['en', 'pt-BR'] },
  { width: 1024, height: 700, locales: ['en', 'pt-BR'] },
  { width: 1440, height: 900, locales: ['en', 'pt-BR'] },
];

test('Studio layouts and actions remain usable at narrow and wide sizes', {
  skip: !browserPath && 'Set STUDIO_BROWSER_PATH to a Chromium browser to run the responsive UI test',
  timeout: 240_000,
}, async () => {
  assert.ok(fs.existsSync(browserPath), `Browser not found: ${browserPath}`);
  assert.ok(fs.existsSync(vite), 'Install the existing webview dependencies before running this test');
  assert.equal(typeof WebSocket, 'function', 'This test requires a Node.js version with WebSocket support');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-responsive-test-'));
  const vitePort = await availablePort();
  const chromePort = await availablePort();
  const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: uiRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const process of [server, chrome]) {
    process.stdout.on('data', (data) => { logs = (logs + data).slice(-12000); });
    process.stderr.on('data', (data) => { logs = (logs + data).slice(-12000); });
  }
  let page;
  let browser;
  try {
    await waitFor(async () => {
      if (server.exitCode !== null) throw new Error(`Vite exited: ${logs}`);
      return (await fetch(`http://127.0.0.1:${vitePort}/`)).ok;
    }, 'Vite');
    const browserInfo = await waitFor(async () => {
      if (chrome.exitCode !== null) throw new Error(`Browser exited: ${logs}`);
      return (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json();
    }, 'Chromium debugging endpoint');
    const target = await waitFor(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
      return targets.find((item) => item.type === 'page');
    }, 'browser page');
    browser = new Cdp(browserInfo.webSocketDebuggerUrl);
    page = new Cdp(target.webSocketDebuggerUrl);
    await Promise.all([browser.open(), page.open()]);
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__studioMessages = [];
        window.acquireVsCodeApi = () => ({
          postMessage: (message) => window.__studioMessages.push(message),
          getState: () => ({}), setState: () => {},
        });`,
    });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/` });
    await waitFor(() => page.evaluate(`return Boolean(document.querySelector('aside nav button'));`), 'Studio');
    await page.evaluate(`
      const { useStudioStore } = await import('/src/store.ts');
      window.__studioStore = useStudioStore;
      useStudioStore.getState().setSettings(${JSON.stringify(settings)});
      useStudioStore.setState(${JSON.stringify(fixture)});
      await new Promise((resolve) => setTimeout(resolve, 100));
    `);

    const problems = [];
    for (const scenario of scenarios) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false,
      });
      const issues = await page.evaluate(`
        const store = window.__studioStore;
        const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const errors = [];
        const visible = (el) => Boolean(el.getClientRects().length && el.offsetWidth && el.offsetHeight);
        const inspectSidebar = (locale) => {
          const sidebar = document.querySelector('aside');
          const main = document.querySelector('main');
          if (!sidebar || !main) { errors.push(locale + '/sidebar: missing navigation'); return; }
          const bounds = sidebar.getBoundingClientRect();
          const mainBounds = main.getBoundingClientRect();
          if (mainBounds.left < bounds.right - 1 || mainBounds.right > innerWidth + 1) {
            errors.push(locale + '/sidebar: navigation overlaps the page');
          }
          for (const control of sidebar.querySelectorAll('button, select')) {
            if (!visible(control)) continue;
            const rect = control.getBoundingClientRect();
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) {
              errors.push(locale + '/sidebar: control exceeds navigation width');
            }
            for (const icon of control.querySelectorAll('svg')) {
              if (!icon.getClientRects().length) continue;
              const iconRect = icon.getBoundingClientRect();
              if (iconRect.width < 8 || iconRect.height < 8) {
                errors.push(locale + '/sidebar: navigation icon is compressed');
              }
            }
          }
        };
        const inspect = (label) => {
          const root = document.querySelector('main > div:last-child > div');
          if (!root || !root.children[1]) {
            errors.push(label + ': missing page'); return;
          }
          for (const [region, el] of [['header', root.children[0]], ['content', root.children[1]]]) {
            if (el.scrollWidth > el.clientWidth + 2) {
              errors.push(label + ': ' + region + ' overflows by ' + (el.scrollWidth - el.clientWidth) + 'px');
            }
          }
          for (const card of root.querySelectorAll('.overflow-hidden')) {
            if (visible(card) && card.scrollWidth > card.clientWidth + 2) {
              errors.push(label + ': clipped card by ' + (card.scrollWidth - card.clientWidth) + 'px: ' + card.innerText.slice(0, 90));
            }
          }
          for (const el of root.querySelectorAll('div, section, fieldset, button')) {
            if (visible(el) && !el.classList.contains('truncate') && !el.closest('table') &&
                getComputedStyle(el).overflowX === 'visible' && el.scrollWidth > el.clientWidth + 3) {
              errors.push(label + ': overflowing ' + el.tagName + ' by ' +
                (el.scrollWidth - el.clientWidth) + 'px: ' + el.innerText.slice(0, 70));
            }
          }
          for (const identity of root.querySelectorAll('button[aria-expanded]')) {
            const actions = identity.parentElement?.nextElementSibling;
            if (!actions || !actions.querySelector('button') || !visible(identity)) continue;
            const a = identity.getBoundingClientRect();
            for (const action of actions.querySelectorAll('button')) {
              const b = action.getBoundingClientRect();
              if (visible(action) && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
                errors.push(label + ': identity overlaps an action');
                break;
              }
            }
          }
          for (const button of root.querySelectorAll('button')) {
            if (!visible(button)) continue;
            for (const icon of button.querySelectorAll('svg')) {
              if (!icon.getClientRects().length) continue;
              const rect = icon.getBoundingClientRect();
              if (rect.width < 8 || rect.height < 8) {
                errors.push(label + ': action icon is compressed (' + Math.round(rect.width) + 'x' +
                  Math.round(rect.height) + 'px): ' + button.textContent.trim().slice(0, 60));
                break;
              }
            }
          }
        };
        for (const locale of ${JSON.stringify(scenario.locales)}) {
          store.getState().setLanguagePreference(locale);
          await wait();
          inspectSidebar(locale);
          for (const name of ['dashboard', 'compose', 'containers', 'images', 'volumes', 'networks', 'tools', 'settings']) {
            store.getState().setActivePage(name);
            await wait();
            inspect(locale + '/' + name);
            if (name === 'compose') {
              const tabs = [...document.querySelectorAll('.studio-page-header .overflow-x-auto button')];
              if (tabs.length !== 8) { errors.push(locale + '/compose: missing tabs'); continue; }
              for (let i = 1; i < tabs.length; i++) {
                tabs[i].click();
                await wait();
                if (i === 1) {
                  const nodes = [...document.querySelectorAll('[data-topology-node]')];
                  if (nodes.length < 8) errors.push(locale + '/topology: missing nodes');
                  for (let first = 0; first < nodes.length; first++) {
                    const a = nodes[first].getBoundingClientRect();
                    const canvas = nodes[first].parentElement.getBoundingClientRect();
                    if (a.bottom > canvas.bottom + 1) errors.push(locale + '/topology: node exceeds canvas');
                    for (let second = first + 1; second < nodes.length; second++) {
                      const b = nodes[second].getBoundingClientRect();
                      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
                        errors.push(locale + '/topology: nodes overlap (' +
                          nodes[first].dataset.topologyNode + ', ' + nodes[second].dataset.topologyNode + ')');
                      }
                    }
                  }
                }
                if (i === 2) {
                  const card = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
                    item.getAttribute('aria-label')?.includes('very-long-service-name-for-testing'))?.closest('.overflow-hidden');
                  card?.querySelector('button[aria-expanded]')?.click();
                  await wait();
                }
                inspect(locale + '/compose/tab-' + i);
              }
            }
            if (name === 'containers') {
              const card = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
                item.getAttribute('aria-label')?.includes('money-talk-redis-1'))?.closest('.overflow-hidden');
              if (!card) errors.push(locale + '/containers: missing pod member');
              else {
                card.querySelector('button[aria-expanded]')?.click();
                await wait();
                inspect(locale + '/containers/expanded');
              }
            }
          }
        }
        if (${scenario.width} === 200) {
          const state = store.getState();
          const keys = ['allContainers', 'pods', 'images', 'volumes', 'networks', 'machines',
            'systemInfo', 'diskUsage', 'composeFiles', 'activeFile', 'document', 'composeContainers'];
          const previous = Object.fromEntries(keys.map((key) => [key, state[key]]));
          store.setState({
            allContainers: [], pods: [], images: [], volumes: [], networks: [], machines: [],
            systemInfo: null, diskUsage: [], composeFiles: [], activeFile: '', document: null,
            composeContainers: [],
          });
          store.getState().setLanguagePreference('en');
          for (const name of ['dashboard', 'compose', 'containers', 'images', 'volumes', 'networks']) {
            store.getState().setActivePage(name);
            await wait();
            inspect('empty/' + name);
          }
          store.setState(previous);
          await wait();
        }
        return errors;
      `);
      problems.push(...issues.map((issue) => `${scenario.width}x${scenario.height}: ${issue}`));
    }
    assert.deepEqual(problems, [], problems.join('\n'));

    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    const topologyProblems = await page.evaluate(`
      const store = window.__studioStore;
      const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const errors = [];
      store.getState().setLanguagePreference('en');
      store.getState().setActivePage('compose');
      await wait();
      document.querySelectorAll('.studio-page-header .overflow-x-auto button')[1].click();
      await wait();
      await wait();
      const first = document.querySelector('[data-topology-node="svc:redis"]');
      const second = document.querySelector('[data-topology-node="svc:very-long-service-name-for-testing"]');
      if (!first || !second) return ['missing service nodes'];
      const before = second.getBoundingClientRect();
      first.style.paddingBottom = '100px';
      let expanded;
      let reflowed;
      for (let attempt = 0; attempt < 60; attempt++) {
        await wait();
        expanded = first.getBoundingClientRect();
        reflowed = second.getBoundingClientRect();
        if (reflowed.top >= expanded.bottom + 20 && reflowed.top >= before.top + 50) break;
      }
      if (reflowed.top < expanded.bottom + 20 || reflowed.top < before.top + 50) {
        errors.push('following nodes did not reflow after a card grew: ' +
          JSON.stringify({ beforeTop: before.top, firstBottom: expanded.bottom, afterTop: reflowed.top,
            firstHeight: first.offsetHeight, secondStyle: second.style.top }));
      }
      const startX = reflowed.left + 12;
      const startY = reflowed.top + 12;
      second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: startX, clientY: startY }));
      await wait();
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 45, clientY: startY + 60 }));
      await wait();
      window.dispatchEvent(new MouseEvent('mouseup'));
      await wait();
      const moved = second.getBoundingClientRect();
      if (Math.abs(moved.left - reflowed.left - 45) > 2 || Math.abs(moved.top - reflowed.top - 60) > 2) {
        errors.push('dragging a node did not preserve its position');
      }
      [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Reset Layout')?.click();
      await wait();
      const reset = second.getBoundingClientRect();
      if (Math.abs(reset.left - reflowed.left) > 2 || Math.abs(reset.top - reflowed.top) > 2) {
        errors.push('resetting the layout did not restore the measured positions');
      }
      return errors;
    `);
    assert.deepEqual(topologyProblems, [], topologyProblems.join('\n'));

    const modalProblems = [];
    for (const width of [200, 240, 280, 320, 480, 1024]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile: false });
      const issues = await page.evaluate(`
        const store = window.__studioStore;
        const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const errors = [];
        const inspect = (label) => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) { errors.push(label + ': missing dialog'); return; }
          const panel = dialog.firstElementChild;
          const rect = panel.getBoundingClientRect();
          if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) {
            errors.push(label + ': dialog exceeds the viewport ' +
              JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }));
          }
          for (const region of panel.children) {
            if (region.clientWidth && region.scrollWidth > region.clientWidth + 2) {
              errors.push(label + ': dialog region overflows by ' + (region.scrollWidth - region.clientWidth) + 'px');
            }
          }
          for (const el of dialog.querySelectorAll('div, fieldset, button')) {
            if (el.offsetWidth && el.offsetHeight && !el.classList.contains('truncate') &&
                getComputedStyle(el).overflowX === 'visible' && el.scrollWidth > el.clientWidth + 3) {
              errors.push(label + ': overflowing ' + el.tagName + ' by ' +
                (el.scrollWidth - el.clientWidth) + 'px: ' + el.innerText.slice(0, 60));
            }
          }
        };
        for (const locale of ['en', 'pt-BR', 'de']) {
          store.getState().setLanguagePreference(locale);
          for (const name of ['compose', 'containers', 'images', 'volumes', 'networks']) {
            store.getState().setActivePage(name);
            await wait();
            document.querySelector('.studio-page-header button')?.click();
            await wait();
            inspect(locale + '/' + name);
            if (name === 'containers' && locale === 'en') {
              [...document.querySelectorAll('[role="dialog"] button')].find((item) =>
                item.textContent.trim().startsWith('Advanced Mode'))?.click();
              await wait();
              inspect(locale + '/containers/advanced');
            }
            const panel = document.querySelector('[role="dialog"]')?.firstElementChild;
            panel?.querySelector('button')?.click();
            await wait();
          }
          store.getState().setActivePage('compose');
          store.setState((state) => ({
            composeProject: { ...state.composeProject, options: {
              ...state.composeProject.options,
              files: [state.activeFile, 'C:\\\\workspace\\\\a-very-long-override-file-name-for-testing.yaml'],
            } },
          }));
          await wait();
          document.querySelectorAll('.studio-page-header button')[2]?.click();
          await wait();
          inspect(locale + '/compose/options');
          document.querySelector('[role="dialog"] > div')?.querySelector('button')?.click();
          await wait();

          store.getState().setActivePage('images');
          await wait();
          for (const [index, action] of [[0, 'Run'], [1, 'Push']]) {
            const image = [...document.querySelectorAll('.studio-images-cards article, .studio-images-table tbody tr')]
              .find((item) => item.offsetWidth && item.textContent.includes('very-long-container-image-name'));
            const button = image?.querySelectorAll('button')[index];
            if (!button) { errors.push(locale + '/images: missing ' + action + ' action'); continue; }
            button.click();
            await wait();
            inspect(locale + '/images/' + action);
            document.querySelector('[role="dialog"] > div')?.querySelector('button')?.click();
            await wait();
          }

          if (locale === 'en') {
            store.getState().setActivePage('containers');
            await wait();
            const checkbox = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
              item.getAttribute('aria-label')?.includes('pod_money-talk-long-project-name'));
            const card = checkbox?.closest('.overflow-hidden');
            const identity = card?.querySelector('button[aria-expanded]');
            const actions = identity?.parentElement?.nextElementSibling;
            const logs = [...(actions?.querySelectorAll('button') || [])]
              .find((item) => item.textContent.trim() === 'Logs');
            if (!logs) { errors.push('pod: missing Logs action'); continue; }
            logs.click();
            store.getState().setLogHistory([{
              timestamp: 'T'.repeat(120), service: 'S'.repeat(120),
              level: 'error', message: 'M'.repeat(500),
            }]);
            await wait();
            inspect('pod/logs');
            if (!document.querySelector('[role="dialog"]')?.textContent.includes('M'.repeat(500))) {
              errors.push('pod/logs: long log line is missing');
            }
            document.documentElement.style.zoom = '1.2';
            await wait();
            inspect('pod/logs with 120% zoom');
            document.documentElement.style.zoom = '';
            await wait();
            document.querySelector('[role="dialog"] > div')?.querySelector('button')?.click();
            await wait();
          }
        }
        return errors;
      `);
      modalProblems.push(...issues.map((issue) => `${width}x420: ${issue}`));
    }
    assert.deepEqual(modalProblems, [], modalProblems.join('\n'));

    const feedbackProblems = [];
    for (const width of [200, 320]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile: false });
      const issues = await page.evaluate(`
      const store = window.__studioStore;
      const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      store.getState().setLanguagePreference('pt-BR');
      store.getState().setActivePage('images');
      store.getState().beginOperation('pulling', 'Downloading a container image', 'responsive-test');
      store.getState().showBanner('error', 'A'.repeat(180), 'B'.repeat(300), 'responsive-test');
      await wait();
      const center = document.querySelector('main > div:first-child');
      center.querySelectorAll('summary').forEach((item) => item.click());
      await wait();
      const errors = [...center.querySelectorAll('div, button')].filter((el) =>
        el.offsetWidth && getComputedStyle(el).overflowX === 'visible' &&
        el.scrollWidth > el.clientWidth + 3
      ).map((el) => 'feedback overflows by ' + (el.scrollWidth - el.clientWidth) + 'px');
      const height = center.getBoundingClientRect().height;
      if (height > innerHeight * 0.3 + 25) errors.push('feedback leaves too little room for the page');
      store.getState().endOperation('pulling', 'responsive-test');
      store.getState().banners.forEach((banner) => store.getState().dismissBanner(banner.id));
      await wait();
      return errors;
    `);
      feedbackProblems.push(...issues.map((issue) => width + 'px: ' + issue));
    }
    assert.deepEqual(feedbackProblems, [], feedbackProblems.join('\n'));

    const containerBefore = await page.evaluate(`
      const store = window.__studioStore;
      store.getState().setLanguagePreference('en');
      store.getState().setActivePage('containers');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
        item.getAttribute('aria-label')?.includes('money-talk-redis-1'));
      const card = checkbox.closest('.overflow-hidden');
      const identity = card.querySelector('button[aria-expanded]');
      identity.focus();
      return { tag: identity.tagName, expanded: identity.getAttribute('aria-expanded'), focused: document.activeElement === identity };
    `);
    assert.deepEqual(containerBefore, { tag: 'BUTTON', expanded: 'false', focused: true });
    await page.send('Page.bringToFront');
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    const containerAfter = await page.evaluate(`
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
        item.getAttribute('aria-label')?.includes('money-talk-redis-1'));
      const card = checkbox.closest('.overflow-hidden');
      const expanded = card.querySelector('button[aria-expanded]').getAttribute('aria-expanded');
      [...card.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Stop').click();
      return { expanded, message: window.__studioMessages.filter((item) => item.command === 'container:stop').at(-1) };
    `);
    assert.equal(containerAfter.expanded, 'true');
    assert.equal(containerAfter.message.payload.containerId, containerId);

    const podAction = await page.evaluate(`
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
        item.getAttribute('aria-label')?.includes('pod_money-talk-long-project-name'));
      const card = checkbox.closest('.overflow-hidden');
      const identity = card.querySelector('button[aria-expanded]');
      const expanded = identity.getAttribute('aria-expanded');
      const actions = identity.parentElement.nextElementSibling;
      [...actions.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Pause').click();
      return {
        expandedBefore: expanded,
        expandedAfter: identity.getAttribute('aria-expanded'),
        message: window.__studioMessages.filter((item) => item.command === 'pod:pause').at(-1),
      };
    `);
    assert.equal(podAction.expandedAfter, podAction.expandedBefore);
    assert.equal(podAction.message?.payload.podId, podId);

    for (const [pageName, resourceName, resource, identity] of [
      ['volumes', volumeName, 'volume', '2026-01-01'],
      ['networks', networkName, 'network', 'e'.repeat(64)],
    ]) {
      const message = await page.evaluate(`
        window.__studioStore.getState().setActivePage(${JSON.stringify(pageName)});
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const checkbox = [...document.querySelectorAll('input[type="checkbox"]')].find((item) =>
          item.getAttribute('aria-label')?.includes(${JSON.stringify(resourceName)}));
        checkbox.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const button = [...document.querySelectorAll('.studio-page-header button')].find((item) =>
          item.textContent.trim() === 'Delete (1)');
        if (!button || button.disabled) return null;
        button.click();
        return window.__studioMessages.filter((item) => item.command === 'resource:remove:batch').at(-1);
      `);
      assert.deepEqual(message?.payload, {
        resource, engine: 'podman', targets: [{ name: resourceName, identity }],
      });
    }

    const selection = await page.evaluate(`
      const store = window.__studioStore;
      store.getState().setActivePage('compose');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelectorAll('.studio-page-header .overflow-x-auto button')[2].click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
      inputs.find((item) => item.getAttribute('aria-label') === 'Select redis').click();
      inputs.find((item) => item.getAttribute('aria-label') === ${JSON.stringify(`Select ${serviceName}`)}).click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const toolbar = document.querySelector('[role="toolbar"]');
      return {
        count: document.querySelectorAll('[role="toolbar"]').length,
        selected: [...toolbar.querySelectorAll('button')].some((item) =>
          item.textContent.trim() === 'Up / Start (2)' && !item.disabled),
      };
    `);
    assert.deepEqual(selection, { count: 1, selected: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const batch = await page.evaluate(`
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const button = [...document.querySelectorAll('[role="toolbar"] button')].find((item) =>
        item.textContent.trim() === 'Up / Start (2)');
      if (!button || button.disabled) return null;
      button.click();
      return window.__studioMessages.filter((item) => item.command === 'stack:services:batch').at(-1);
    `);
    assert.equal(batch?.payload.action, 'up');
    assert.deepEqual(batch?.payload.services, ['redis', serviceName]);
    assert.equal(batch?.payload.projectRevision, 'test-revision');

    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 420, deviceScaleFactor: 1, mobile: false });
    const mobile = await page.evaluate(`
      const store = window.__studioStore;
      store.getState().setLanguagePreference('en');
      store.getState().setActivePage('images');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const cards = document.querySelector('.studio-images-cards');
      const table = document.querySelector('.studio-images-table');
      const card = cards.querySelector('article');
      const badge = [...card.querySelectorAll('span')].find((item) => item.textContent.trim() === 'In use (1)');
      card.querySelector('input[type="checkbox"]').click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        cards: Boolean(cards), table: Boolean(table),
        badgeRects: badge?.getClientRects().length, checked: card.querySelector('input').checked,
      };
    `);
    assert.deepEqual(mobile, { cards: true, table: false, badgeRects: 1, checked: true });

    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => page.evaluate(`return Boolean(document.querySelector('.studio-images-table'));`), 'wide image table');
    const desktop = await page.evaluate(`
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const cards = document.querySelector('.studio-images-cards');
      const table = document.querySelector('.studio-images-table');
      const row = table.querySelector('tbody tr');
      const badge = [...row.querySelectorAll('span')].find((item) => item.textContent.trim() === 'In use (1)');
      const badgeText = badge.querySelector('span');
      const badgeRange = document.createRange();
      badgeRange.selectNodeContents(badgeText);
      const checked = row.querySelector('input').checked;
      [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Delete').click();
      const message = window.__studioMessages.filter((item) => item.command === 'resource:remove:batch').at(-1);
      return { cards: Boolean(cards), table: Boolean(table),
        badgeRects: badge?.getClientRects().length, badgeTextLines: badgeRange.getClientRects().length,
        sizeWhitespace: getComputedStyle(row.cells[4]).whiteSpace, checked, message };
    `);
    assert.equal(desktop.cards, false);
    assert.equal(desktop.table, true);
    assert.equal(desktop.badgeRects, 1);
    assert.equal(desktop.badgeTextLines, 1);
    assert.equal(desktop.sizeWhitespace, 'nowrap');
    assert.equal(desktop.checked, true);
    assert.deepEqual(desktop.message.payload, {
      resource: 'image', engine: 'podman',
      targets: [{ name: 'docker.io/library/redis:7-alpine', identity: imageId }],
    });

    const translatedBadge = await page.evaluate(`
      const store = window.__studioStore;
      store.getState().setLanguagePreference('uk');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const label = document.querySelector('.studio-images-table tbody tr td:nth-child(6) > span > span');
      const range = document.createRange();
      range.selectNodeContents(label);
      const result = { text: label.textContent.trim(), lines: range.getClientRects().length,
        whiteSpace: getComputedStyle(label).whiteSpace };
      store.getState().setLanguagePreference('en');
      return result;
    `);
    assert.match(translatedBadge.text, /Використовується/);
    assert.equal(translatedBadge.lines, 1);
    assert.equal(translatedBadge.whiteSpace, 'nowrap');

    const largeTable = await page.evaluate(`
      const store = window.__studioStore;
      const image = store.getState().images[0];
      store.setState({ images: Array.from({ length: 200 }, (_, index) => ({
        ...image, repository: 'example.test/image-' + index,
        id: String(index).padStart(12, '0'), fullId: String(index).padStart(64, '0'),
      })) });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        rows: document.querySelectorAll('.studio-images-table tbody tr').length,
        cards: document.querySelectorAll('.studio-images-cards article').length,
      };
    `);
    assert.deepEqual(largeTable, { rows: 200, cards: 0 });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 420, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => page.evaluate(`return Boolean(document.querySelector('.studio-images-cards'));`), 'compact image cards');
    const largeCards = await page.evaluate(`
      return {
        rows: document.querySelectorAll('.studio-images-table tbody tr').length,
        cards: document.querySelectorAll('.studio-images-cards article').length,
      };
    `);
    assert.deepEqual(largeCards, { rows: 0, cards: 200 });

    for (const width of [1000, 1024, 1040, 1060]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await waitFor(() => page.evaluate(`
        const container = document.querySelector('.studio-images-layout');
        const cards = Boolean(document.querySelector('.studio-images-cards'));
        const table = Boolean(document.querySelector('.studio-images-table'));
        const compact = container.clientWidth <= 760;
        return cards === compact && table === !compact
          ? { width: container.clientWidth, compact }
          : null;
      `), `image layout for ${width}px viewport`);
      assert.equal(layout.compact, layout.width <= 760);
    }

    const restoredFromEmpty = await page.evaluate(`
      const store = window.__studioStore;
      const images = store.getState().images;
      store.setState({ images: [] });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const empty = !document.querySelector('.studio-images-cards, .studio-images-table');
      store.setState({ images });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { empty, count: document.querySelectorAll('.studio-images-cards article, .studio-images-table tbody tr').length };
    `);
    assert.deepEqual(restoredFromEmpty, { empty: true, count: 200 });
  } finally {
    page?.close();
    if (browser && chrome.exitCode === null) {
      await Promise.race([browser.send('Browser.close').catch(() => {}), sleep(3000)]);
    }
    browser?.close();
    for (const process of [chrome, server]) {
      const active = () => process.exitCode === null && process.signalCode === null;
      if (active()) process.kill();
      if (active()) {
        await Promise.race([new Promise((resolve) => process.once('exit', resolve)), sleep(10000)]);
      }
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt >= 39 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
        await sleep(500);
      }
    }
  }
});
