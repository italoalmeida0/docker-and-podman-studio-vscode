import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CONFIG_SECTION,
  ContainerEngine,
  getConfig,
  getEngineLabel,
  getPodmanComposeSettingsKey,
  LanguageSetting,
  onConfigChange,
  resetEnginePaths,
  SECRET_KEY,
  StudioConfig,
  updateEngineSetting,
  updateLanguageSetting,
} from './config';
import { bt, resolveBackendLocale } from './i18n';
import {
  COMPOSE_DOCUMENT_SELECTOR,
  ComposeCompletionProvider,
} from './language/completionProvider';
import { ComposeDiagnosticsProvider } from './language/diagnosticsProvider';
import { ComposeFileDetector } from './services/composeDetector';
import { LogProvider } from './services/logProvider';
import { PodmanService } from './services/podmanService';
import { StatusProvider } from './services/statusProvider';
import { YamlService } from './services/yamlService';
import {
  InboundCommand as M,
  OutboundCommand as A,
  PodmanBatchResource,
  ServiceStatus,
} from './types';
import { showErrorWithCopy } from './ui/messageUtil';
import { StatusBarManager, withStatus } from './ui/statusBarManager';
import {
  StudioLauncherViewProvider,
  StudioWebviewPanel,
} from './ui/webviewProvider';
import { NativeCommandsManager } from './wizards/nativeWizards';

const ACTIVE_STATES = new Set(['running', 'unhealthy', 'starting', 'stopping', 'restarting']);

function isActiveComposeStatus(status: ServiceStatus, engine: ContainerEngine): boolean {
  return ACTIVE_STATES.has(status) || (engine === 'podman' && status === 'paused');
}

function cleanRegistryHost(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
}

function defaultHostForProvider(provider: string, customUrl: string): string {
  const cleaned = cleanRegistryHost(customUrl);
  if (cleaned) {
    return cleaned;
  }
  switch (provider) {
    case 'quay':
      return 'quay.io';
    case 'dockerhub':
      return 'docker.io';
    case 'ghcr':
      return 'ghcr.io';
    default:
      return '';
  }
}

export async function disconnectRegistryCredentials(
  podman: Pick<PodmanService, 'logoutRegistry'>,
  secrets: Pick<vscode.SecretStorage, 'delete'>,
  host: string,
  engine: ContainerEngine,
  shouldLogout: boolean
): Promise<void> {
  if (shouldLogout) {
    const result = await podman.logoutRegistry(host, engine);
    if (!result.success) {
      throw new Error(`${engine} logout failed: ${result.stderr || result.stdout || `exit code ${result.exitCode}`}`);
    }
  }
  await secrets.delete(SECRET_KEY);
}

function httpGetJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Docker-and-Podman-Studio-VSCode',
            ...headers,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`Registry HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

function parseLines(text?: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseEnvText(text?: string): Record<string, string> | undefined {
  const entries = parseLines(text)
    .map((line) => {
      const idx = line.indexOf('=');
      return idx === -1
        ? [line.trim(), '']
        : [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
    .filter(([k]) => Boolean(k));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseDependsText(text?: string): any {
  const lines = parseLines(text);
  if (lines.length === 0) {
    return undefined;
  }
  if (lines.some((l) => l.includes(':'))) {
    return Object.fromEntries(
      lines
        .map((l) => {
          const [svc, cond] = l.split(':').map((x) => x.trim());
          return [svc, cond ? { condition: cond } : {}];
        })
        .filter(([svc]) => Boolean(svc))
    );
  }
  return lines;
}

function namedVolumeFromMount(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (!trimmed) {
    return undefined;
  }
  // Ignore Windows drive paths such as C:\foo:/bar or relative/absolute host paths
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  const [source] = trimmed.split(':');
  if (!source || source.startsWith('.') || source.startsWith('/') || source.startsWith('~') || source.includes('\\')) {
    return undefined;
  }
  return source;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const podman = new PodmanService();
  const yamlService = new YamlService();
  const fileDetector = new ComposeFileDetector(context, podman);
  const statusProvider = new StatusProvider(podman, yamlService);
  const logProvider = new LogProvider(podman);
  const studioPanel = new StudioWebviewPanel(context.extensionUri);
  const launcherProvider = new StudioLauncherViewProvider();
  const statusBar = StatusBarManager.getInstance();
  const output = vscode.window.createOutputChannel('Docker and Podman Studio');

  let activeComposeFile: string | undefined;
  let refreshGeneration = 0;
  let lastRefreshError = '';

  function reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
    studioPanel.postMessage({ command: A.ERROR, payload: { message } });
  }

  const cfg = getConfig();
  if (cfg.autoDetectFiles) {
    await fileDetector.scan();
    fileDetector.startWatching();
  }
  const initialFiles = fileDetector.getFiles();
  activeComposeFile = initialFiles[0];
  if (activeComposeFile) {
    statusProvider.startPolling(activeComposeFile, cfg.pollingInterval);
  }

  function getComposeFileList(): string[] {
    const detected = fileDetector.getFiles();
    if (activeComposeFile && fs.existsSync(activeComposeFile)) {
      return Array.from(new Set([...detected, activeComposeFile])).sort();
    }
    return detected;
  }

  function getActiveComposeFile(): string | undefined {
    if (!activeComposeFile || !fs.existsSync(activeComposeFile)) {
      activeComposeFile = fileDetector.getFiles()[0];
    }
    return activeComposeFile;
  }

  function sendComposeState(): void {
    const file = getActiveComposeFile();
    studioPanel.postMessage({
      command: A.COMPOSE_FILES_UPDATE,
      payload: getComposeFileList(),
    });
    if (!file) {
      studioPanel.postMessage({
        command: A.COMPOSE_UPDATE,
        payload: { document: null, activeFile: null, rawYaml: '' },
      });
      return;
    }
    try {
      const rawYaml = fs.readFileSync(file, 'utf-8');
      const document = yamlService.parse(rawYaml);
      studioPanel.postMessage({
        command: A.COMPOSE_UPDATE,
        payload: { document, activeFile: file, rawYaml },
      });
    } catch (err: any) {
      studioPanel.postMessage({
        command: A.ERROR,
        payload: {
          message: bt('yamlReadError', {
            file: path.basename(file),
            err: err?.message || String(err),
          }),
        },
      });
    }
  }

  async function refreshStatusBarConnection(): Promise<void> {
    const currentCfg = getConfig();
    const generation = refreshGeneration;
    try {
      const sysInfo = await podman.getSystemInfo();
      if (generation === refreshGeneration && getConfig().engine === currentCfg.engine) {
        statusBar.updateMachineBadge(Boolean(sysInfo.engineVersion));
      }
    } catch (error) {
      output.appendLine(`[${new Date().toISOString()}] ${String(error)}`);
      if (generation === refreshGeneration && getConfig().engine === currentCfg.engine) {
        statusBar.updateMachineBadge(false);
      }
    }
  }

  async function refreshAllStudioData(selectedCompose?: string): Promise<void> {
    const currentCfg = getConfig();
    const generation = ++refreshGeneration;
    if (selectedCompose && fs.existsSync(selectedCompose)) {
      activeComposeFile = selectedCompose;
      statusProvider.startPolling(selectedCompose, currentCfg.pollingInterval);
    }

    const containers = podman.listAllContainers();
    const results = await Promise.allSettled([
      podman.getSystemInfo(),
      podman.listDockerContexts(),
      podman.listMachines(),
      podman.listPods(),
      containers,
      containers.then((list) => podman.listImages(list)),
      podman.listNetworks(),
      podman.listVolumes(),
      podman.getDiskUsage(),
    ] as const);
    if (generation !== refreshGeneration || getConfig().engine !== currentCfg.engine) {
      return;
    }
    const [sysInfo] = results;
    statusBar.updateMachineBadge(
      sysInfo.status === 'fulfilled' && Boolean(sysInfo.value.engineVersion)
    );

    if (studioPanel.isVisible()) {
      const commands = [
        A.SYSTEM_INFO_UPDATE,
        A.DOCKER_CONTEXTS_UPDATE,
        A.MACHINES_UPDATE,
        A.PODS_UPDATE,
        A.ALL_CONTAINERS_UPDATE,
        A.IMAGES_UPDATE,
        A.NETWORKS_UPDATE,
        A.VOLUMES_UPDATE,
        A.DISK_USAGE_UPDATE,
      ];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          studioPanel.postMessage({ command: commands[index], payload: result.value });
        } else if (index === 0) {
          studioPanel.postMessage({ command: A.SYSTEM_INFO_UPDATE, payload: null });
        }
      });
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (firstFailure) {
        const message =
          firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : String(firstFailure.reason);
        if (message !== lastRefreshError) {
          lastRefreshError = message;
          reportError(message);
        }
      } else {
        lastRefreshError = '';
      }
      try {
        await fileDetector.scan();
        sendComposeState();
        const composeStatuses = await statusProvider.poll();
        studioPanel.postMessage({ command: A.CONTAINERS_UPDATE, payload: composeStatuses });
      } catch (error) {
        reportError(error);
      }
    }
  }

  async function sendSettingsState(): Promise<void> {
    const current = getConfig();
    const hasRegistrySecret = Boolean(await context.secrets.get(SECRET_KEY));
    const resolvedLanguage = resolveBackendLocale(current.language);
    studioPanel.postMessage({
      command: A.SETTINGS_UPDATE,
      payload: {
        ...current,
        hasRegistrySecret,
        resolvedLanguage,
        vscodeLanguage: vscode.env.language || 'en',
      },
    });
  }

  function buildAuthHeaders(
    authType: string,
    username: string,
    secret?: string
  ): Record<string, string> {
    if (!secret) {
      return {};
    }
    if (authType === 'basic' && username) {
      return {
        Authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`,
      };
    }
    if (authType === 'bearer') {
      return {
        Authorization: `Bearer ${secret}`,
      };
    }
    return {};
  }

  async function searchImages(provider: string, registryUrl: string, query: string) {
    const q = encodeURIComponent(query.trim());
    if (provider === 'quay' && !registryUrl) {
      const data = await httpGetJson(`https://quay.io/api/v1/find/repositories?query=${q}`);
      return (data.results ?? []).slice(0, 12).map((r: any) => ({
        name: `quay.io/${r.namespace?.name || r.namespace}/${r.name}:latest`,
        description: r.description || 'Quay.io repository',
        source: 'Quay.io',
      }));
    }
    if ((provider === 'dockerhub' || !registryUrl) && provider !== 'custom') {
      const data = await httpGetJson(
        `https://hub.docker.com/v2/search/repositories/?query=${q}&page_size=12`
      );
      return (data.results ?? [])
        .map((r: any) => {
          const repo = r.repo_name || r.name;
          const owner = r.repo_owner || r.namespace;
          return {
            name:
              owner && owner !== 'library'
                ? `docker.io/${owner}/${repo}:latest`
                : `docker.io/library/${repo}:latest`,
            description: r.short_description || r.description || '',
            source: 'Docker Hub',
          };
        })
        .filter((x: any) => Boolean(x.name));
    }

    const host = cleanRegistryHost(registryUrl);
    const currentCfg = getConfig();
    const secret = await context.secrets.get(SECRET_KEY);
    const headers = buildAuthHeaders(
      currentCfg.registryAuthType,
      currentCfg.registryUsername,
      secret
    );
    const data = await httpGetJson(`https://${host}/v2/_catalog?n=100`, headers);
    return (data.repositories ?? [])
      .filter((name: string) => name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 12)
      .map((name: string) => ({
        name: `${host}/${name}:latest`,
        description: 'OCI Registry Catalog',
        source: host,
      }));
  }

  async function currentComposeStatuses() {
    const file = getActiveComposeFile();
    if (getConfig().engine === 'podman' && file) {
      const doc = yamlService.parse(fs.readFileSync(file, 'utf-8'));
      return podman.composePs(file, doc);
    }
    return statusProvider.getContainers();
  }

  async function ensureServiceStopped(serviceName: string): Promise<void> {
    const engine = getConfig().engine;
    const found = (await currentComposeStatuses())
      .find((c) => c.service === serviceName && isActiveComposeStatus(c.status, engine));
    if (found) {
      throw new Error(bt('stopServiceBeforeEdit', { service: serviceName }));
    }
  }

  async function ensureAllServicesStopped(): Promise<void> {
    const engine = getConfig().engine;
    const active = (await currentComposeStatuses())
      .filter((c) => isActiveComposeStatus(c.status, engine))
      .map((c) => c.service)
      .filter(Boolean);
    if (active.length > 0) {
      throw new Error(
        bt('stopAllBeforeRawSave', {
          services: Array.from(new Set(active)).join(', '),
        })
      );
    }
  }

  function resolveComposeTarget(dirInput?: string, fileNameInput?: string): string {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultName =
      getConfig().engine === 'podman' ? 'podman-compose.yml' : 'docker-compose.yml';
    const fileName = (fileNameInput || defaultName).trim();
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
      throw new Error(bt('invalidComposeExtension'));
    }
    if (fileName !== path.basename(fileName)) {
      throw new Error(bt('fileNameOnlyError'));
    }
    const dirRaw = dirInput?.trim() || '.';
    if (!wsRoot && !path.isAbsolute(dirRaw)) {
      throw new Error(bt('selectFolderOrWorkspaceError'));
    }
    const baseDir = path.isAbsolute(dirRaw) ? dirRaw : path.resolve(wsRoot!, dirRaw);
    return path.resolve(baseDir, fileName);
  }

  function formatSelectedDir(selectedPath: string): string {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) {
      return selectedPath;
    }
    const rel = path.relative(wsRoot, selectedPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return selectedPath;
    }
    return rel || '.';
  }

  async function notifyResult(
    opKey: string,
    label: string,
    task: () => Promise<{
      success: boolean;
      stdout?: string;
      stderr?: string;
      commandStr?: string;
    }>
  ): Promise<boolean> {
    studioPanel.postMessage({ command: A.OPERATION_START, payload: opKey });
    try {
      const res = await withStatus(label, task);
      if (!res.success) {
        const msg = (
          res.stderr || bt('engineFailedDefault', { engine: getEngineLabel() })
        ).trim();
        studioPanel.postMessage({ command: A.ERROR, payload: { message: `${label}: ${msg}` } });
        void showErrorWithCopy(`${label}: ${msg}`, res.commandStr);
        return false;
      }
      studioPanel.postMessage({
        command: A.NOTIFICATION,
        payload: { type: 'success', message: bt('opCompleted', { op: label }) },
      });
      return true;
    } finally {
      studioPanel.postMessage({ command: A.OPERATION_END, payload: opKey });
    }
  }

  async function confirmPodmanAction(message: string, detail?: string): Promise<boolean> {
    if (getConfig().engine !== 'podman' || !getConfig().confirmDeletions) {
      return true;
    }
    const yes = bt('yes');
    return (await vscode.window.showWarningMessage(message, { modal: true, detail }, yes)) === yes;
  }

  async function runBatch(resource: PodmanBatchResource, payload: any): Promise<void> {
    const action: unknown = payload?.action;
    const ids: unknown = payload?.ids;
    if (
      (action !== 'start' && action !== 'stop' && action !== 'restart') ||
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === 'string')
    ) {
      throw new Error('Invalid Podman batch operation or resource IDs.');
    }
    const actionLabel = bt(
      action === 'start' ? 'batchStart' : action === 'stop' ? 'batchStop' : 'batchRestart'
    );
    const label = bt('batchOperation', {
      action: actionLabel,
      count: ids.length,
      resource: bt(resource === 'pod' ? 'batchPods' : 'batchContainers'),
    });
    await notifyResult(`${resource}-batch`, label, async () => {
      const results = await podman.runPodmanBatch(resource, action, ids);
      const failures = results.filter((item) => !item.result.success);
      return {
        success: failures.length === 0,
        stdout: '',
        stderr: failures.length
          ? [
              bt('batchPartialFailure', {
                completed: results.length - failures.length,
                total: results.length,
              }),
              ...failures.map(
                (item) =>
                  `${item.name}: ${(item.result.stderr || item.result.stdout || `exit code ${item.result.exitCode}`).trim()}`
              ),
            ].join('\n')
          : '',
      };
    });
    await refreshAllStudioData();
  }

  // ==================== WEBVIEW MESSAGE HANDLER ====================

  studioPanel.onMessage(async (msg) => {
    const payload = msg?.payload ?? {};
    const composeFile = getActiveComposeFile();
    const engine = getConfig().engine;
    const engineLabel = getEngineLabel(engine);

    try {
      switch (msg.command) {
        case M.DASHBOARD_GET: {
          await refreshAllStudioData();
          break;
        }
        case M.SYSTEM_INFO_GET: {
          const info = await podman.getSystemInfo();
          studioPanel.postMessage({ command: A.SYSTEM_INFO_UPDATE, payload: info });
          break;
        }
        case M.DISK_USAGE_GET: {
          const df = await podman.getDiskUsage();
          studioPanel.postMessage({ command: A.DISK_USAGE_UPDATE, payload: df });
          break;
        }

        // Docker Contexts
        case M.DOCKER_CONTEXTS_LIST: {
          const contexts = await podman.listDockerContexts();
          studioPanel.postMessage({ command: A.DOCKER_CONTEXTS_UPDATE, payload: contexts });
          break;
        }
        case M.DOCKER_CONTEXT_USE: {
          if (!payload.name?.trim()) {
            break;
          }
          await notifyResult(
            'context-use',
            `Docker Context Use ${payload.name}`,
            () => podman.useDockerContext(String(payload.name))
          );
          await refreshAllStudioData();
          break;
        }

        // Podman Machines
        case M.MACHINES_LIST: {
          const machines = await podman.listMachines();
          studioPanel.postMessage({ command: A.MACHINES_UPDATE, payload: machines });
          break;
        }
        case M.MACHINE_START: {
          await notifyResult(
            'machine-start',
            `Podman Machine Start ${payload.name || ''}`.trim(),
            () => podman.startMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }
        case M.MACHINE_STOP: {
          await notifyResult(
            'machine-stop',
            `Podman Machine Stop ${payload.name || ''}`.trim(),
            () => podman.stopMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }
        case M.MACHINE_RESTART: {
          await notifyResult(
            'machine-restart',
            `Podman Machine Restart ${payload.name || ''}`.trim(),
            () => podman.restartMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }

        // Pods
        case M.PODS_LIST: {
          const pods = await podman.listPods();
          studioPanel.postMessage({ command: A.PODS_UPDATE, payload: pods });
          break;
        }
        case M.POD_CREATE: {
          const ok = await notifyResult(
            'pod-create',
            `Create Pod ${payload.name || ''}`.trim(),
            () => podman.createPod(payload)
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.POD_START: {
          await notifyResult('pod-start', `Start Pod ${payload.podId}`, () =>
            podman.startPod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_STOP: {
          await notifyResult('pod-stop', `Stop Pod ${payload.podId}`, () =>
            podman.stopPod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_RESTART: {
          await notifyResult('pod-restart', `Restart Pod ${payload.podId}`, () =>
            podman.restartPod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_PAUSE:
        case M.POD_UNPAUSE: {
          if (engine !== 'podman') {
            throw new Error(bt('podsRequirePodmanError'));
          }
          const pause = msg.command === M.POD_PAUSE;
          await notifyResult(pause ? 'pod-pause' : 'pod-unpause', `${pause ? 'Pause' : 'Resume'} Pod ${payload.podId}`, () =>
            pause ? podman.pausePod(payload.podId) : podman.unpausePod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_BATCH: {
          await runBatch('pod', payload);
          break;
        }
        case M.POD_REMOVE: {
          await notifyResult('pod-remove', `Remove Pod ${payload.podId}`, () =>
            podman.removePod(payload.podId, true)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_LOGS: {
          const res = await podman.getPodLogs(payload.podId, 300);
          if (!res.success) {
            throw new Error(res.stderr || 'Failed to read Podman pod logs.');
          }
          const entries = `${res.stdout}\n${res.stderr}`
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0)
            .map((line) => logProvider.parseLine(`pod:${payload.podName || payload.podId}`, line));
          studioPanel.postMessage({ command: A.LOG_HISTORY, payload: entries });
          break;
        }

        // Containers
        case M.CONTAINERS_LIST: {
          const list = await podman.listAllContainers();
          studioPanel.postMessage({ command: A.ALL_CONTAINERS_UPDATE, payload: list });
          break;
        }
        case M.CONTAINER_CREATE: {
          const ok = await notifyResult(
            'container-create',
            `Create Container ${payload.name || payload.image}`,
            () => podman.createContainer(payload)
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.CONTAINER_START: {
          await notifyResult('container-start', `Start Container ${payload.containerId}`, () =>
            podman.startContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_STOP: {
          await notifyResult('container-stop', `Stop Container ${payload.containerId}`, () =>
            podman.stopContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_RESTART: {
          await notifyResult('container-restart', `Restart Container ${payload.containerId}`, () =>
            podman.restartContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_PAUSE:
        case M.CONTAINER_UNPAUSE: {
          if (engine !== 'podman') {
            throw new Error('Container pause and resume require Podman mode.');
          }
          const pause = msg.command === M.CONTAINER_PAUSE;
          await notifyResult(
            pause ? 'container-pause' : 'container-unpause',
            `${pause ? 'Pause' : 'Resume'} Container ${payload.containerId}`,
            () => pause
              ? podman.pauseContainer(payload.containerId)
              : podman.unpauseContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_BATCH: {
          await runBatch('container', payload);
          break;
        }
        case M.CONTAINER_REMOVE: {
          await notifyResult('container-remove', `Remove Container ${payload.containerId}`, () =>
            podman.removeContainer(payload.containerId, true)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_TERMINAL: {
          podman.openContainerTerminal(payload.containerId, payload.name);
          break;
        }
        case M.CONTAINER_LOGS: {
          const cid = payload.containerId;
          if (!cid) {
            break;
          }
          const res = await podman.getContainerLogHistory(cid, 350);
          if (!res.success) {
            throw new Error(res.stderr || `Failed to read container logs: ${cid}`);
          }
          const entries = `${res.stdout}\n${res.stderr}`
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0)
            .map((line) => logProvider.parseLine(payload.name || cid, line));
          studioPanel.postMessage({ command: A.LOG_HISTORY, payload: entries });
          break;
        }
        case M.CONTAINER_LOGS_EXTERNAL: {
          await podman.openLogsExternal(payload.containerId, payload.name, payload.mode);
          break;
        }

        // Images & Prune
        case M.IMAGES_LIST: {
          const images = await podman.listImages();
          studioPanel.postMessage({ command: A.IMAGES_UPDATE, payload: images });
          break;
        }
        case M.IMAGE_PULL: {
          if (!payload.imageName?.trim()) {
            break;
          }
          await notifyResult('pulling', `Pull Image ${payload.imageName}`, () =>
            podman.pullImage(payload.imageName)
          );
          const images = await podman.listImages();
          studioPanel.postMessage({ command: A.IMAGES_UPDATE, payload: images });
          break;
        }
        case M.IMAGE_BUILD: {
          const ok = await notifyResult('image-build', `Build Image ${payload.tag}`, () =>
            podman.buildImage(payload.dockerfile, payload.tag, payload.contextDir)
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.IMAGE_PUSH: {
          await notifyResult(
            'image-push',
            `Push Image ${payload.targetTag || payload.sourceImage}`,
            () => podman.pushImage(payload.sourceImage, payload.targetTag)
          );
          break;
        }
        case M.IMAGE_REMOVE: {
          if (!(await confirmPodmanAction(
            bt('confirmRemoveImage', { name: String(payload.imageId) }),
            bt('podmanInUseWarning')
          ))) {
            break;
          }
          await notifyResult('image-remove', `Remove Image ${payload.imageId}`, () =>
            podman.removeImage(payload.imageId, engine === 'docker')
          );
          await refreshAllStudioData();
          break;
        }
        case M.IMAGE_DOCKERFILE_PICK: {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: wsRoot,
            openLabel: bt('selectContainerfileLabel'),
          });
          if (picked?.[0]) {
            studioPanel.postMessage({
              command: A.DOCKERFILE_SELECTED,
              payload: {
                dockerfile: picked[0].fsPath,
                contextDir: path.dirname(picked[0].fsPath),
              },
            });
          }
          break;
        }
        case M.PRUNE_IMAGES: {
          if (!(await confirmPodmanAction(bt('confirmPruneDangling')))) {
            break;
          }
          await notifyResult('prune-images', 'Prune Dangling Images', () =>
            podman.pruneDanglingImages()
          );
          await refreshAllStudioData();
          break;
        }
        case M.PRUNE_ALL_IMAGES: {
          if (!(await confirmPodmanAction(bt('confirmPruneUnused')))) {
            break;
          }
          await notifyResult('prune-all-images', 'Prune All Unused Images', () =>
            podman.pruneAllUnusedImages()
          );
          await refreshAllStudioData();
          break;
        }
        case M.PRUNE_BUILDER_CACHE: {
          if (!(await confirmPodmanAction(
            bt('confirmPruneBuilder'),
            bt('podmanBuildCacheWarning')
          ))) {
            break;
          }
          await notifyResult('prune-builder', `Clear ${engineLabel} Builder Cache`, () =>
            podman.pruneBuilderCache()
          );
          await refreshAllStudioData();
          break;
        }
        case M.PRUNE_VOLUMES: {
          if (!(await confirmPodmanAction(bt('confirmPruneVolumes')))) {
            break;
          }
          await notifyResult('prune-volumes', 'Prune Unused Volumes', () =>
            podman.pruneVolumes()
          );
          await refreshAllStudioData();
          break;
        }

        // Networks
        case M.NETWORKS_LIST: {
          const nets = await podman.listNetworks();
          studioPanel.postMessage({ command: A.NETWORKS_UPDATE, payload: nets });
          break;
        }
        case M.NETWORK_CREATE: {
          const ok = await notifyResult('network-create', `Create Network ${payload.name}`, () =>
            podman.createNetwork(payload)
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.NETWORK_REMOVE: {
          if (!(await confirmPodmanAction(
            bt('confirmRemoveNetwork', { name: String(payload.networkName) }),
            bt('podmanInUseWarning')
          ))) {
            break;
          }
          await notifyResult('network-remove', `Remove Network ${payload.networkName}`, () =>
            podman.removeNetwork(payload.networkName, engine === 'docker')
          );
          await refreshAllStudioData();
          break;
        }

        // Volumes
        case M.VOLUMES_LIST: {
          const vols = await podman.listVolumes();
          studioPanel.postMessage({ command: A.VOLUMES_UPDATE, payload: vols });
          break;
        }
        case M.VOLUME_CREATE: {
          const ok = await notifyResult('volume-create', `Create Volume ${payload.name}`, () =>
            podman.createVolume(payload.name, payload.driver, payload.labels)
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.VOLUME_REMOVE: {
          if (!(await confirmPodmanAction(
            bt('confirmRemoveVolume', { name: String(payload.volumeName) }),
            bt('podmanInUseWarning')
          ))) {
            break;
          }
          await notifyResult('volume-remove', `Remove Volume ${payload.volumeName}`, () =>
            podman.removeVolume(payload.volumeName, engine === 'docker')
          );
          await refreshAllStudioData();
          break;
        }

        // Compose Stack
        case M.COMPOSE_FILES_LIST: {
          await fileDetector.scan();
          studioPanel.postMessage({
            command: A.COMPOSE_FILES_UPDATE,
            payload: getComposeFileList(),
          });
          break;
        }
        case M.COMPOSE_FILE_SELECT: {
          if (payload.file && fs.existsSync(payload.file)) {
            activeComposeFile = payload.file;
            statusProvider.startPolling(payload.file, getConfig().pollingInterval);
            sendComposeState();
          }
          break;
        }
        case M.COMPOSE_FILE_PICK: {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Compose YAML': ['yml', 'yaml'] },
            openLabel: bt('selectComposeLabel'),
          });
          if (picked?.[0]) {
            activeComposeFile = picked[0].fsPath;
            await fileDetector.registerFile(activeComposeFile);
            statusProvider.startPolling(activeComposeFile, getConfig().pollingInterval);
            sendComposeState();
          }
          break;
        }
        case M.COMPOSE_DIRECTORY_PICK: {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: wsRoot,
            openLabel: bt('selectComposeDirLabel'),
          });
          if (picked?.[0]) {
            studioPanel.postMessage({
              command: A.COMPOSE_DIRECTORY_SELECTED,
              payload: { directory: formatSelectedDir(picked[0].fsPath) },
              requestId: msg.requestId,
            });
          }
          break;
        }
        case M.COMPOSE_IMAGE_SEARCH: {
          const q = String(payload.query || '').trim();
          if (!q) {
            studioPanel.postMessage({
              command: A.COMPOSE_IMAGE_RESULTS,
              payload: { results: [] },
            });
            break;
          }
          const current = getConfig();
          const provider =
            payload.registryType === 'configured'
              ? current.registryProvider
              : payload.registryType || current.registryProvider;
          const regUrl = String(payload.registryUrl || current.registryUrl || '');
          const results = await searchImages(provider, regUrl, q);
          studioPanel.postMessage({ command: A.COMPOSE_IMAGE_RESULTS, payload: { results } });
          break;
        }
        case M.COMPOSE_FILE_CREATE: {
          const targetPath = resolveComposeTarget(payload.directory, payload.fileName);
          if (fs.existsSync(targetPath)) {
            throw new Error(bt('fileAlreadyExists', { path: targetPath }));
          }
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });

          const includeSvc = Boolean(payload.includeSampleService);
          const svcName = String(payload.serviceName || 'app').trim() || 'app';
          const includeNet = Boolean(payload.includeNetwork);
          const includeVol = Boolean(payload.includeVolume);
          const netName = String(payload.networkName || 'app-net').trim() || 'app-net';
          const volName = String(payload.volumeName || 'app-data').trim() || 'app-data';
          const sourceMode = payload.serviceSource === 'build' ? 'build' : 'image';
          const defaultDockerfile = engine === 'podman' ? 'Containerfile' : 'Dockerfile';
          const ports = Array.isArray(payload.ports)
            ? payload.ports.map((p: any) => String(p).trim()).filter(Boolean)
            : [];
          const volSpecs = parseLines(payload.volumesText);
          const allVols = [...volSpecs, ...(includeVol ? [`${volName}:/data`] : [])];
          const envObj = parseEnvText(payload.environmentText);
          const depObj = parseDependsText(payload.dependsText);
          const hc = payload.healthcheck
            ? {
                test: ['CMD-SHELL', String(payload.healthcheck.test || '').trim()],
                ...(payload.healthcheck.interval?.trim()
                  ? { interval: String(payload.healthcheck.interval).trim() }
                  : {}),
                ...(payload.healthcheck.timeout?.trim()
                  ? { timeout: String(payload.healthcheck.timeout).trim() }
                  : {}),
                ...(payload.healthcheck.retries?.trim()
                  ? { retries: Number(payload.healthcheck.retries) }
                  : {}),
                ...(payload.healthcheck.startPeriod?.trim()
                  ? { start_period: String(payload.healthcheck.startPeriod).trim() }
                  : {}),
              }
            : undefined;

          const svcDef = includeSvc
            ? {
                ...(sourceMode === 'build'
                  ? {
                      build: {
                        context: String(payload.buildContext || '.').trim() || '.',
                        dockerfile:
                          String(payload.buildDockerfile || defaultDockerfile).trim() ||
                          defaultDockerfile,
                      },
                      ...(payload.image?.trim() ? { image: String(payload.image).trim() } : {}),
                    }
                  : {
                      image:
                        String(payload.image || 'docker.io/library/nginx:alpine').trim() ||
                        'docker.io/library/nginx:alpine',
                    }),
                ...(payload.containerName?.trim()
                  ? { container_name: String(payload.containerName).trim() }
                  : {}),
                ...(ports.length > 0 ? { ports } : {}),
                ...(envObj ? { environment: envObj } : {}),
                ...(allVols.length > 0 ? { volumes: allVols } : {}),
                ...(includeNet ? { networks: [netName] } : {}),
                ...(depObj ? { depends_on: depObj } : {}),
                ...(payload.commandText?.trim()
                  ? { command: String(payload.commandText).trim() }
                  : {}),
                ...(payload.restartPolicy?.trim()
                  ? { restart: String(payload.restartPolicy).trim() }
                  : {}),
                ...(hc ? { healthcheck: hc } : {}),
              }
            : {};

          const namedVolumes = Array.from(
            new Set([
              ...volSpecs.map(namedVolumeFromMount).filter((v): v is string => Boolean(v)),
              ...(includeVol ? [volName] : []),
            ])
          );

          const doc = {
            services: includeSvc ? { [svcName]: svcDef } : {},
            ...(includeNet ? { networks: { [netName]: { driver: 'bridge' } } } : {}),
            ...(namedVolumes.length > 0
              ? { volumes: Object.fromEntries(namedVolumes.map((v) => [v, {}])) }
              : {}),
          };

          fs.writeFileSync(targetPath, yamlService.stringify(doc), 'utf-8');
          activeComposeFile = targetPath;
          await fileDetector.registerFile(targetPath);
          statusProvider.startPolling(targetPath, getConfig().pollingInterval);
          sendComposeState();
          vscode.window.showInformationMessage(
            bt('composeCreatedToast', { file: path.basename(targetPath) })
          );
          break;
        }
        case M.STACK_START:
        case M.STACK_UP: {
          if (!composeFile) {
            break;
          }
          await notifyResult('start', `${engineLabel} Compose Up`, () =>
            podman.composeUp(composeFile, payload)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_STOP: {
          if (!composeFile) {
            break;
          }
          await notifyResult('stop', `${engineLabel} Compose Stop`, () =>
            podman.composeStop(composeFile, payload?.services)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_DOWN: {
          if (!composeFile) {
            break;
          }
          const services = Array.isArray(payload?.services) ? payload.services : [];
          if (!(await confirmPodmanAction(
            services.length > 0
              ? bt('confirmComposeServiceDown', { services: services.join(', ') })
              : bt('confirmComposeDown'),
            payload.removeVolumes ? bt('confirmComposeVolumes') : undefined
          ))) {
            break;
          }
          if (Array.isArray(payload?.services) && payload.services.length > 0) {
            const doc = yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
            await notifyResult('down', `Remove Service ${payload.services.join(', ')}`, () =>
              podman.composeRemoveServices(composeFile, payload.services, doc)
            );
          } else {
            await notifyResult('down', `${engineLabel} Compose Down`, () =>
              podman.composeDown(composeFile, payload)
            );
          }
          await refreshAllStudioData();
          break;
        }
        case M.STACK_RESTART: {
          if (!composeFile) {
            break;
          }
          await notifyResult('restart', `${engineLabel} Compose Restart`, () =>
            podman.composeRestart(composeFile, payload?.services)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_BUILD: {
          if (!composeFile) {
            break;
          }
          await notifyResult('build', `${engineLabel} Compose Build & Up`, () =>
            podman.composeBuild(composeFile, payload?.services)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_SCALE: {
          if (!composeFile || !payload.service || payload.replicas === undefined) {
            break;
          }
          const replicas = typeof payload.replicas === 'number'
            ? payload.replicas
            : typeof payload.replicas === 'string' && /^\d+$/.test(payload.replicas.trim())
              ? Number(payload.replicas.trim())
              : NaN;
          let expectedContainerIds: string[] | undefined;
          let expectedComposeContent: string | undefined;
          if (engine === 'podman') {
            if (getConfig().engine !== 'podman') {
              throw new Error('The active engine changed; refresh before scaling.');
            }
            if (typeof payload.service !== 'string' ||
                !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(payload.service) ||
                !Number.isSafeInteger(replicas) || replicas < 0) {
              throw new Error('Compose scaling requires a valid service name and a non-negative integer.');
            }
            const initialSettings = getPodmanComposeSettingsKey();
            expectedComposeContent = fs.readFileSync(composeFile, 'utf-8');
            const doc = yamlService.parse(expectedComposeContent);
            if (!doc.services || !Object.prototype.hasOwnProperty.call(doc.services, payload.service)) {
              throw new Error('The requested Compose service no longer exists. Refresh the project.');
            }
            const current = (await podman.composePs(composeFile, doc))
              .filter((container) => container.service === payload.service);
            expectedContainerIds = current.map((container) => container.fullId);
            if (getPodmanComposeSettingsKey() !== initialSettings ||
                getActiveComposeFile() !== composeFile ||
                fs.readFileSync(composeFile, 'utf-8') !== expectedComposeContent) {
              throw new Error('Compose settings or the file changed; refresh before scaling.');
            }
            if (current.length > replicas && !(await confirmPodmanAction(
              bt('confirmScaleDown', {
                service: String(payload.service),
                count: current.length - replicas,
              }),
              bt('confirmScaleDataWarning')
            ))) {
              break;
            }
            if (getPodmanComposeSettingsKey() !== initialSettings ||
                getActiveComposeFile() !== composeFile ||
                fs.readFileSync(composeFile, 'utf-8') !== expectedComposeContent) {
              throw new Error('Compose settings or the file changed; refresh before scaling.');
            }
          }
          await notifyResult('scale', `Scale ${payload.service}`, () =>
            podman.composeScale(
              composeFile, payload.service, replicas, undefined, expectedContainerIds, expectedComposeContent
            )
          );
          await refreshAllStudioData();
          break;
        }
        case M.LOGS_START: {
          if (!composeFile || !payload.service) {
            break;
          }
          const svc = String(payload.service);
          logProvider.clearHistory(svc);
          studioPanel.postMessage({
            command: A.LOG_HISTORY,
            payload: { service: svc, entries: [] },
          });
          await logProvider.startComposeStreaming(composeFile, svc);
          break;
        }
        case M.LOGS_STOP: {
          if (payload.service) {
            logProvider.stopStreaming(String(payload.service));
          }
          break;
        }
        case M.SERVICE_ADD: {
          if (!composeFile || !payload.name) {
            break;
          }
          const raw = fs.readFileSync(composeFile, 'utf-8');
          const doc = yamlService.parse(raw);
          const next = yamlService.addService(doc, payload);
          fs.writeFileSync(composeFile, yamlService.stringify(next), 'utf-8');
          sendComposeState();
          break;
        }
        case M.SERVICE_UPDATE: {
          if (!composeFile || !payload.name) {
            break;
          }
          await ensureServiceStopped(payload.name);
          const raw = fs.readFileSync(composeFile, 'utf-8');
          const doc = yamlService.parse(raw);
          const next = payload.definitionYaml
            ? {
                ...doc,
                services: {
                  ...doc.services,
                  [payload.name]: yamlService.parseServiceFragment(
                    payload.name,
                    payload.definitionYaml
                  ),
                },
              }
            : yamlService.updateService(doc, payload.name, payload.changes || {});
          fs.writeFileSync(composeFile, yamlService.stringify(next), 'utf-8');
          sendComposeState();
          break;
        }
        case M.SERVICE_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          await ensureServiceStopped(payload.name);
          const raw = fs.readFileSync(composeFile, 'utf-8');
          const doc = yamlService.parse(raw);
          const next = yamlService.removeService(doc, payload.name);
          fs.writeFileSync(composeFile, yamlService.stringify(next), 'utf-8');
          sendComposeState();
          break;
        }
        case M.COMPOSE_RAW_SAVE: {
          if (!composeFile || typeof payload.rawYaml !== 'string') {
            break;
          }
          await ensureAllServicesStopped();
          const issues = yamlService.validate(payload.rawYaml);
          const fatal = issues.find((i) => i.severity === 'error');
          if (fatal) {
            throw new Error(`YAML Error: ${fatal.message}`);
          }
          fs.writeFileSync(composeFile, payload.rawYaml, 'utf-8');
          sendComposeState();
          studioPanel.postMessage({
            command: A.NOTIFICATION,
            payload: { type: 'success', message: bt('yamlSavedToast') },
          });
          break;
        }
        case M.COMPOSE_NETWORK_ADD: {
          if (!composeFile || !payload.name) {
            break;
          }
          const doc = yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
          doc.networks = {
            ...(doc.networks ?? {}),
            [payload.name]: {
              ...(payload.driver ? { driver: payload.driver } : {}),
              ...(payload.external !== undefined ? { external: Boolean(payload.external) } : {}),
            },
          };
          fs.writeFileSync(composeFile, yamlService.stringify(doc), 'utf-8');
          sendComposeState();
          break;
        }
        case M.COMPOSE_NETWORK_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          const doc = yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
          const { [payload.name]: _rem, ...rest } = doc.networks ?? {};
          doc.networks = rest;
          fs.writeFileSync(composeFile, yamlService.stringify(doc), 'utf-8');
          sendComposeState();
          break;
        }
        case M.COMPOSE_VOLUME_ADD: {
          if (!composeFile || !payload.name) {
            break;
          }
          const doc = yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
          doc.volumes = {
            ...(doc.volumes ?? {}),
            [payload.name]: {
              ...(payload.driver ? { driver: payload.driver } : {}),
              ...(payload.external !== undefined ? { external: Boolean(payload.external) } : {}),
            },
          };
          fs.writeFileSync(composeFile, yamlService.stringify(doc), 'utf-8');
          sendComposeState();
          break;
        }
        case M.COMPOSE_VOLUME_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          const doc = yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
          const { [payload.name]: _rem, ...rest } = doc.volumes ?? {};
          doc.volumes = rest;
          fs.writeFileSync(composeFile, yamlService.stringify(doc), 'utf-8');
          sendComposeState();
          break;
        }
        case M.COMPOSE_GET: {
          sendComposeState();
          break;
        }
        case M.STATUS_GET: {
          const statuses = await statusProvider.poll();
          studioPanel.postMessage({ command: A.CONTAINERS_UPDATE, payload: statuses });
          break;
        }

        // Settings & Registry
        case M.SETTINGS_GET: {
          await sendSettingsState();
          break;
        }
        case M.SETTINGS_SET_LANGUAGE: {
          const lang = (payload.language || 'auto') as LanguageSetting;
          await updateLanguageSetting(lang);
          statusBar.refreshLocalization();
          launcherProvider.refreshLocalization();
          await sendSettingsState();
          break;
        }
        case M.SETTINGS_SET_ENGINE: {
          const nextEngine: ContainerEngine = payload.engine === 'podman' ? 'podman' : 'docker';
          await updateEngineSetting(nextEngine);
          statusBar.refreshLocalization();
          launcherProvider.refreshLocalization();
          await sendSettingsState();
          await refreshAllStudioData();
          studioPanel.postMessage({
            command: A.NOTIFICATION,
            payload: {
              type: 'success',
              message: bt('engineSwitchedToast', { engine: getEngineLabel(nextEngine) }),
            },
          });
          break;
        }
        case M.SETTINGS_SAVE: {
          const target = vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
          const wsCfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
          if (payload.language !== undefined) {
            await updateLanguageSetting(payload.language as LanguageSetting);
          }
          if (payload.engine !== undefined) {
            await updateEngineSetting(payload.engine === 'podman' ? 'podman' : 'docker');
          }
          const keys: Array<keyof StudioConfig> = [
            'dockerPath',
            'podmanPath',
            'composePath',
            'composeCommandStyle',
            'inPod',
            'machineName',
            'pollingInterval',
            'logBufferSize',
            'autoDetectFiles',
            'confirmDeletions',
            'logsOutput',
            'enablePushCommand',
            'pushDefaultRegistry',
            'registryProvider',
            'registryUrl',
            'registryAuthType',
            'registryUsername',
            'registryAutoLogin',
          ];
          for (const k of keys) {
            if (payload[k] !== undefined) {
              await wsCfg.update(k, payload[k], target);
            }
          }
          if (payload.registrySecret) {
            await context.secrets.store(SECRET_KEY, String(payload.registrySecret));
          }
          const activeCfg = getConfig();
          const cmd = activeCfg.engine;
          const effectiveSecret =
            payload.registrySecret || (await context.secrets.get(SECRET_KEY));
          const autoLogin =
            payload.registryAutoLogin !== undefined
              ? Boolean(payload.registryAutoLogin)
              : activeCfg.registryAutoLogin;

          if (autoLogin && effectiveSecret && activeCfg.registryAuthType !== 'bearer') {
            const username =
              activeCfg.registryUsername || (activeCfg.registryProvider === 'ecr' ? 'AWS' : '');
            const host = defaultHostForProvider(
              activeCfg.registryProvider,
              activeCfg.registryUrl || ''
            );
            if (username && host) {
              const loginRes = await podman.loginRegistry(
                host, username, effectiveSecret, activeCfg.engine
              );
              if (!loginRes.success) {
                throw new Error(
                  bt('settingsSavedLoginFailed', { cmd, err: loginRes.stderr })
                );
              }
            }
          }
          statusBar.refreshLocalization();
          launcherProvider.refreshLocalization();
          await sendSettingsState();
          await refreshAllStudioData();
          studioPanel.postMessage({
            command: A.NOTIFICATION,
            payload: { type: 'success', message: bt('settingsSavedToast') },
          });
          vscode.window.showInformationMessage(bt('settingsSavedToast'));
          break;
        }
        case M.SETTINGS_TEST: {
          try {
            const merged = { ...getConfig(), ...payload };
            const cmd = merged.engine === 'podman' ? 'podman' : 'docker';
            const secret =
              payload.registrySecret || (await context.secrets.get(SECRET_KEY)) || '';
            const host = defaultHostForProvider(merged.registryProvider, merged.registryUrl || '');
            if (merged.registryAutoLogin && merged.registryAuthType !== 'bearer' && secret) {
              const username =
                merged.registryUsername || (merged.registryProvider === 'ecr' ? 'AWS' : '');
              if (!username) {
                throw new Error(bt('provideUsernameForLogin', { cmd }));
              }
              if (!host && cmd === 'podman') {
                throw new Error(bt('provideRegistryUrl'));
              }
              const res = await podman.loginRegistry(host, username, secret, cmd);
              if (!res.success) {
                throw new Error(res.stderr || `${cmd} login failed.`);
              }
              const okMsg = { ok: true, message: bt('engineLoginSuccess', { cmd, host }) };
              studioPanel.postMessage({ command: A.SETTINGS_TEST_RESULT, payload: okMsg });
              break;
            }
            if (merged.registryProvider === 'quay' && !merged.registryUrl) {
              await searchImages('quay', '', 'podman');
              studioPanel.postMessage({
                command: A.SETTINGS_TEST_RESULT,
                payload: { ok: true, message: bt('quayOk') },
              });
              break;
            }
            if (merged.registryProvider === 'dockerhub' && !merged.registryUrl) {
              await searchImages('dockerhub', '', 'alpine');
              studioPanel.postMessage({
                command: A.SETTINGS_TEST_RESULT,
                payload: { ok: true, message: bt('dockerHubOk') },
              });
              break;
            }
            if (!host) {
              throw new Error(bt('provideRegistryUrl'));
            }
            await httpGetJson(
              `https://${host}/v2/_catalog?n=1`,
              buildAuthHeaders(merged.registryAuthType, merged.registryUsername, secret)
            );
            studioPanel.postMessage({
              command: A.SETTINGS_TEST_RESULT,
              payload: { ok: true, message: bt('registryOk', { host }) },
            });
          } catch (err: any) {
            studioPanel.postMessage({
              command: A.SETTINGS_TEST_RESULT,
              payload: { ok: false, message: err?.message || String(err) },
            });
          }
          break;
        }
        case M.SETTINGS_DISCONNECT: {
          const merged = { ...getConfig(), ...payload };
          const cmd = merged.engine === 'podman' ? 'podman' : 'docker';
          const host = defaultHostForProvider(merged.registryProvider, merged.registryUrl || '');
          const shouldLogout = Boolean(merged.registryAutoLogin && host);
          try {
            await disconnectRegistryCredentials(podman, context.secrets, host, cmd, shouldLogout);
            await sendSettingsState();
            studioPanel.postMessage({
              command: A.SETTINGS_TEST_RESULT,
              payload: {
                ok: true,
                message: shouldLogout
                  ? bt('registryDisconnected', { cmd })
                  : bt('registryCredentialsRemoved'),
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            studioPanel.postMessage({
              command: A.SETTINGS_TEST_RESULT,
              payload: { ok: false, message },
            });
            reportError(error);
          }
          break;
        }
        case M.SETTINGS_RESET_PATHS: {
          await resetEnginePaths();
          await sendSettingsState();
          vscode.window.showInformationMessage(bt('pathsResetToast'));
          break;
        }
        case M.OPEN_EXTERNAL: {
          if (payload.url) {
            await vscode.env.openExternal(vscode.Uri.parse(String(payload.url)));
          }
          break;
        }
        case M.OPEN_VSCODE_SETTINGS: {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:ItaloAlmeida.docker-and-podman-studio'
          );
          break;
        }
      }
    } catch (err: unknown) {
      reportError(err);
    }
  });

  // Push live status & log updates to Webview
  statusProvider.onStatusChange((containers) => {
    studioPanel.postMessage({ command: A.CONTAINERS_UPDATE, payload: containers });
  });
  statusProvider.onError((message) => reportError(message));
  logProvider.onLogLine((entry) => {
    studioPanel.postMessage({ command: A.LOG_LINE, payload: entry });
  });
  logProvider.onError((message) => reportError(message));

  const cfgDisposable = onConfigChange(() => {
    const updated = getConfig();
    const currentFile = getActiveComposeFile();
    if (currentFile) {
      statusProvider.startPolling(currentFile, updated.pollingInterval);
    }
    statusBar.refreshLocalization();
    launcherProvider.refreshLocalization();
    void sendSettingsState();
    void refreshAllStudioData();
  });

  const completionDisp = vscode.languages.registerCompletionItemProvider(
    COMPOSE_DOCUMENT_SELECTOR,
    new ComposeCompletionProvider(),
    '.',
    ':',
    ' '
  );
  const diagnosticsDisp = new ComposeDiagnosticsProvider(yamlService);
  const nativeCommands = new NativeCommandsManager(
    podman,
    fileDetector,
    statusProvider,
    refreshAllStudioData
  );
  nativeCommands.register(context);

  const openPanelDisp = vscode.commands.registerCommand(
    'dockerPodmanStudio.openPanel',
    async () => {
      studioPanel.createOrShowPanel();
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
      await vscode.commands.executeCommand('workbench.action.closePanel');
      setTimeout(async () => {
        await refreshAllStudioData();
        await sendSettingsState();
      }, 350);
    }
  );

  const launcherViewDisp = vscode.window.registerWebviewViewProvider(
    StudioLauncherViewProvider.viewType,
    launcherProvider
  );

  // Initial background check for active engine status badge
  void refreshStatusBarConnection();

  context.subscriptions.push(
    statusBar,
    fileDetector,
    statusProvider,
    logProvider,
    studioPanel,
    cfgDisposable,
    completionDisp,
    diagnosticsDisp,
    nativeCommands,
    openPanelDisp,
    launcherViewDisp,
    output
  );
}

export function deactivate(): void {}
