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
import { ComposeFileDetector, mergeComposeFileList } from './services/composeDetector';
import { assertComposeEditBase, composeEditStatuses } from './services/composeEdit';
import { LogProvider } from './services/logProvider';
import { OperationProgress } from './services/operationProgress';
import { PodmanService } from './services/podmanService';
import { StatusProvider } from './services/statusProvider';
import { YamlService } from './services/yamlService';
import { buildComposeDocument, serializeComposeBuilder } from './shared/composeBuilder';
import { composeLogKey } from './shared/composeLogs';
import { appendOutputTail, OperationEvent } from './shared/operationFeedback';
import {
  InboundCommand as M,
  OutboundCommand as A,
  ComposeDocument,
  ComposeProjectOptions,
  PodmanBatchResource,
  RemovableResource,
  ResourceRemovalTarget,
  ServiceStatus,
} from './types';
import { summarizeFailure } from './ui/messageUtil';
import { StatusBarManager, withStatus } from './ui/statusBarManager';
import {
  StudioLauncherViewProvider,
  StudioWebviewPanel,
} from './ui/webviewProvider';
import { NativeCommandsManager } from './wizards/nativeWizards';

const ACTIVE_STATES = new Set(['running', 'unhealthy', 'starting', 'stopping', 'restarting']);

function isActiveComposeStatus(status: ServiceStatus, engine: ContainerEngine): boolean {
  return ACTIVE_STATES.has(status) || status === 'paused';
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

export function resolveRegistrySearch(
  selection: string | undefined,
  customUrl: string | undefined,
  configured: { registryProvider: string; registryUrl: string }
): { provider: string; registryUrl: string } {
  const explicitProvider = selection && selection !== 'configured' ? selection : undefined;
  return {
    provider: explicitProvider || configured.registryProvider,
    registryUrl: selection === 'custom'
      ? String(customUrl || '')
      : explicitProvider ? '' : configured.registryUrl || '',
  };
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

export function httpGetJson(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  timeoutMs = 20_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const rejectRequest = (error: unknown) => {
      if (deadline) clearTimeout(deadline);
      reject(error);
    };
    const request = https.get(
      url,
      {
        timeout: timeoutMs,
        signal,
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
        res.on('error', rejectRequest);
        res.on('aborted', () => rejectRequest(new Error('Registry response was interrupted.')));
        res.on('end', () => {
          if (deadline) clearTimeout(deadline);
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Registry HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Registry returned invalid JSON.'));
          }
        });
      }
    );
    const timeout = () => request.destroy(new Error(`Registry request timed out after ${timeoutMs / 1000} seconds.`));
    deadline = setTimeout(timeout, timeoutMs);
    request.on('timeout', timeout);
    request.on('error', rejectRequest);
  });
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
  const progress = new OperationProgress(
    (command, payload) => studioPanel.postMessage({ command, payload }),
    (text) => output.append(text)
  );

  let activeComposeFile: string | undefined;
  let activeComposeWatchers: vscode.FileSystemWatcher[] = [];
  let watchedComposeKey = '';
  let resolvedCompose: {
    file: string;
    revision: string;
    document?: ComposeDocument;
    error?: string;
  } | undefined;
  let pendingComposeResolution: { file: string; revision: string } | undefined;
  let refreshGeneration = 0;
  let imageSearchGeneration = 0;
  let imageSearchController: AbortController | undefined;
  let lastRefreshError = '';
  let settingsWriteDepth = 0;
  let configChangeGeneration = 0;
  let configRefreshPending = false;
  let configRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const listGenerations = new Map<string, number>();
  const composeOptionsKey = 'composeProjectOptions';
  const storedComposeOptions: Record<string, ComposeProjectOptions> =
    context.workspaceState.get<Record<string, ComposeProjectOptions>>(composeOptionsKey, {});
  for (const [file, options] of Object.entries(storedComposeOptions)) {
    try {
      podman.setComposeProjectOptions(file, options, false);
    } catch (error) {
      const message = `Could not restore Compose options for ${file}: ${error instanceof Error ? error.message : String(error)}`;
      output.appendLine(`[${new Date().toISOString()}] ${message}`);
      void vscode.window.showWarningMessage(message);
    }
  }

  function cancelImageSearch(): number {
    imageSearchGeneration++;
    imageSearchController?.abort();
    imageSearchController = undefined;
    return imageSearchGeneration;
  }
  context.subscriptions.push(studioPanel.onDidClose(() => cancelImageSearch()));

  function nextListGeneration(command: string): number {
    const generation = (listGenerations.get(command) || 0) + 1;
    listGenerations.set(command, generation);
    return generation;
  }

  function engineContextKey(): string {
    const current = getConfig();
    return JSON.stringify([
      current.engine,
      current.engine === 'podman' ? current.podmanPath : current.dockerPath,
    ]);
  }

  function boundedDetails(details: string): string {
    const tail = appendOutputTail('', details);
    return tail.truncated ? `${bt('detailsTruncated')}\n\n${tail.text}` : tail.text;
  }

  function reportError(error: unknown, operation?: string, errorCode?: string, summary?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof Error ? error.stack || message : message;
    const userMessage = summary || summarizeFailure(message, errorCode, operation);
    output.appendLine(`[${new Date().toISOString()}] ${operation ? `${operation}:\n` : ''}${details}`);
    studioPanel.postMessage({
      command: A.ERROR,
      payload: { message: userMessage, details: boundedDetails(details) },
    });
    if (!studioPanel.isVisible()) {
      const openOutput = bt('openOperationOutput');
      void Promise.resolve(vscode.window.showErrorMessage(userMessage, openOutput)).then((choice) => {
        if (choice === openOutput) output.show(true);
      }).catch((failure: unknown) => {
        output.appendLine(`[${new Date().toISOString()}] Could not show error details: ${String(failure)}`);
      });
    }
  }

  async function withStudioProgress<T>(
    key: string,
    label: string,
    task: (report: (event: OperationEvent) => void) => Promise<T>
  ): Promise<T> {
    const id = progress.start(key, label);
    try {
      return await task((event) => progress.report(id, event));
    } finally {
      progress.end(id);
    }
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
      return mergeComposeFileList(detected, activeComposeFile);
    }
    return detected;
  }

  function getActiveComposeFile(): string | undefined {
    if (!activeComposeFile || !fs.existsSync(activeComposeFile)) {
      const previous = activeComposeFile;
      activeComposeFile = fileDetector.getFiles()[0];
      if (activeComposeFile !== previous) {
        if (activeComposeFile) {
          statusProvider.startPolling(activeComposeFile, getConfig().pollingInterval);
        } else {
          statusProvider.clearActiveFile();
        }
      }
    }
    return activeComposeFile;
  }

  function sendComposeState(): void {
    const file = getActiveComposeFile();
    let snapshot: ReturnType<PodmanService['getComposeProjectSnapshot']> | undefined;
    let snapshotError: unknown;
    if (file) {
      try {
        snapshot = podman.getComposeProjectSnapshot(file);
      } catch (error) {
        snapshotError = error;
      }
    }
    try {
      watchActiveComposeFile(file, snapshot?.dependencies.files.map((dependency) => dependency.path));
    } catch (error) {
      reportError(error);
    }
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
    let rawYaml: string;
    try {
      rawYaml = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      reportError(error);
      return;
    }
    let document: ComposeDocument = { services: {} };
    let serviceFragments: Record<string, string> = {};
    let parseError: string | null = null;
    try {
      ({ document, serviceFragments } = yamlService.parseWithServiceFragments(rawYaml));
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    const options = snapshot?.options ?? podman.getComposeProjectOptions(file);
    const customized = snapshot?.customized ?? false;
    const dependenciesIncomplete = snapshot?.dependencies.incomplete ?? false;
    const revision = snapshot?.revision ?? null;
    let projectError: string | null = snapshotError
      ? snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
      : null;
    const cached = resolvedCompose?.file === file && resolvedCompose.revision === revision
      ? resolvedCompose : undefined;
    if (customized && cached?.document) {
      document = cached.document;
    }
    projectError ||= customized ? cached?.error || null : null;
    const resolving = Boolean(customized && revision && !parseError && !projectError && !cached);
    studioPanel.postMessage({
      command: A.COMPOSE_UPDATE,
      payload: {
        document, activeFile: file, rawYaml, serviceFragments, parseError,
        projectOptions: options, projectRevision: revision, projectError,
        projectResolving: resolving, projectCustomized: customized, dependenciesIncomplete,
      },
    });
    if (resolving && revision &&
        (pendingComposeResolution?.file !== file || pendingComposeResolution.revision !== revision)) {
      const pending = { file, revision };
      pendingComposeResolution = pending;
      void podman.resolveComposeDocument(file).then((resolved) => {
        if (pendingComposeResolution !== pending || getActiveComposeFile() !== file ||
            podman.getComposeProjectRevision(file) !== revision) {
          if (pendingComposeResolution === pending) {
            pendingComposeResolution = undefined;
            sendComposeState();
          }
          return;
        }
        resolvedCompose = { file, revision, document: resolved };
        sendComposeState();
      }).catch((error: unknown) => {
        if (pendingComposeResolution !== pending || getActiveComposeFile() !== file) return;
        let currentRevision: string;
        try {
          currentRevision = podman.getComposeProjectRevision(file);
        } catch {
          sendComposeState();
          return;
        }
        if (currentRevision !== revision) {
          pendingComposeResolution = undefined;
          sendComposeState();
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        resolvedCompose = { file, revision, error: message };
        reportError(message);
        sendComposeState();
      }).finally(() => {
        if (pendingComposeResolution === pending) pendingComposeResolution = undefined;
      });
    }
  }

  function watchActiveComposeFile(file?: string, watchedFiles?: string[]): void {
    const files = file ? watchedFiles ?? podman.getComposeProjectWatchedFiles(file) : [];
    const key = JSON.stringify([file, files]);
    if (watchedComposeKey === key) {
      return;
    }
    activeComposeWatchers.forEach((watcher) => watcher.dispose());
    activeComposeWatchers = [];
    watchedComposeKey = key;
    if (!file) {
      return;
    }
    for (const target of files) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(target), path.basename(target))
      );
      const update = () => {
        if (watchedComposeKey === key && getActiveComposeFile() === file) {
          resolvedCompose = undefined;
          statusProvider.clearActiveFile();
          statusProvider.startPolling(file, getConfig().pollingInterval);
          sendComposeState();
        }
      };
      watcher.onDidChange(update);
      watcher.onDidCreate(update);
      watcher.onDidDelete(update);
      activeComposeWatchers.push(watcher);
    }
  }

  context.subscriptions.push(
    fileDetector.onFilesChanged(() => sendComposeState()),
    { dispose: () => activeComposeWatchers.forEach((watcher) => watcher.dispose()) }
  );
  watchActiveComposeFile(activeComposeFile);

  function readComposeEditBase(file: string | undefined, payload: any): string {
    assertComposeProjectContext(file, payload);
    const content = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    const normalized = file && path.normalize(file);
    const dirtyEditor = Boolean(normalized && vscode.workspace.textDocuments.some((document) => {
      const documentPath = path.normalize(document.fileName);
      return document.isDirty && (process.platform === 'win32'
        ? documentPath.toLowerCase() === normalized.toLowerCase()
        : documentPath === normalized);
    }));
    assertComposeEditBase({
      activeFile: getActiveComposeFile(),
      requestedFile: payload.file,
      expectedContent: payload.baseYaml,
      currentContent: content,
      dirtyEditor,
    });
    if (file !== getActiveComposeFile()) {
      throw new Error('The active Compose file changed. Refresh and retry the edit.');
    }
    return content;
  }

  function hasDirtyProjectEditor(files: string[]): boolean {
    const paths = new Set(files.map((file) => {
      const normalized = path.normalize(file);
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }));
    return vscode.workspace.textDocuments.some((document) => {
      const normalized = path.normalize(document.fileName);
      return document.isDirty && paths.has(
        process.platform === 'win32' ? normalized.toLowerCase() : normalized
      );
    });
  }

  function assertComposeProjectContext(
    file: string | undefined,
    payload: any,
    allowDirtyEditors = false
  ): asserts file is string {
    if (!file || payload.file !== file || getActiveComposeFile() !== file ||
        payload.engine !== getConfig().engine ||
        typeof payload.projectRevision !== 'string' ||
        podman.getComposeProjectRevision(file) !== payload.projectRevision) {
      throw new Error('The active Compose project, settings, or files changed. Refresh and try again.');
    }
    if (!allowDirtyEditors && hasDirtyProjectEditor(podman.getComposeProjectWatchedFiles(file))) {
      throw new Error('Save or discard unsaved VS Code changes in the Compose project files before continuing.');
    }
  }

  function assertVisualComposeEditAllowed(file: string): void {
    if (podman.hasCustomComposeProject(file)) {
      throw new Error('Visual edits are disabled for a resolved project with overrides, profiles, an environment file, includes, or extends. Edit the base YAML explicitly.');
    }
  }

  function saveComposeEdit(file: string, payload: any, content: string, requestId?: string): void {
    readComposeEditBase(file, payload);
    fs.writeFileSync(file, content, 'utf-8');
    sendComposeState();
    if (requestId) {
      studioPanel.postMessage({
        command: A.COMPOSE_EDIT_SAVED,
        payload: { file },
        requestId,
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
    return withStudioProgress('refresh-all', bt('refreshingStudio'), () =>
      refreshStudioData(selectedCompose)
    );
  }

  async function refreshStudioData(selectedCompose?: string): Promise<void> {
    const currentCfg = getConfig();
    const initialContext = engineContextKey();
    const generation = ++refreshGeneration;
    if (selectedCompose && fs.existsSync(selectedCompose)) {
      activeComposeFile = selectedCompose;
      statusProvider.startPolling(selectedCompose, currentCfg.pollingInterval);
    }

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
    const listVersions = commands.map(nextListGeneration);
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
    if (generation !== refreshGeneration || engineContextKey() !== initialContext) {
      return;
    }
    const [sysInfo] = results;
    statusBar.updateMachineBadge(
      sysInfo.status === 'fulfilled' && Boolean(sysInfo.value.engineVersion)
    );

    if (studioPanel.isVisible()) {
      results.forEach((result, index) => {
        if (listGenerations.get(commands[index]) !== listVersions[index]) return;
        if (result.status === 'fulfilled') {
          studioPanel.postMessage({ command: commands[index], payload: result.value, engine: currentCfg.engine });
        } else {
          studioPanel.postMessage({
            command: commands[index], payload: index === 0 ? null : [], engine: currentCfg.engine,
          });
        }
      });
      const failures = results.flatMap((result, index) => {
        if (result.status !== 'rejected' || listGenerations.get(commands[index]) !== listVersions[index]) return [];
        const reason = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        return [`${commands[index]}: ${reason}`];
      });
      if (failures.length) {
        const message = failures.join('\n');
        if (message !== lastRefreshError) {
          lastRefreshError = message;
          reportError(message);
        }
      } else {
        lastRefreshError = '';
      }
      try {
        await fileDetector.scan();
        if (generation !== refreshGeneration || engineContextKey() !== initialContext) return;
        sendComposeState();
        const composeStatuses = await statusProvider.poll();
        if (generation !== refreshGeneration || engineContextKey() !== initialContext) return;
        studioPanel.postMessage({
          command: A.CONTAINERS_UPDATE, payload: composeStatuses, engine: currentCfg.engine,
        });
      } catch (error) {
        reportError(error);
      }
    }
  }

  async function sendSettingsState(): Promise<void> {
    const hasRegistrySecret = Boolean(await context.secrets.get(SECRET_KEY));
    const current = getConfig();
    const resolvedLanguage = resolveBackendLocale(current.language);
    studioPanel.postMessage({
      command: A.SETTINGS_UPDATE,
      payload: {
        ...current,
        extensionVersion: context.extension.packageJSON.version,
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

  async function searchImages(
    provider: string, registryUrl: string, query: string, signal?: AbortSignal
  ) {
    const q = encodeURIComponent(query.trim());
    if (provider === 'quay' && !registryUrl) {
      const data = await httpGetJson(`https://quay.io/api/v1/find/repositories?query=${q}`, {}, signal);
      return (data.results ?? []).slice(0, 12).map((r: any) => ({
        name: `quay.io/${r.namespace?.name || r.namespace}/${r.name}:latest`,
        description: r.description || 'Quay.io repository',
        source: 'Quay.io',
      }));
    }
    if (provider === 'dockerhub' && !registryUrl) {
      const data = await httpGetJson(
        `https://hub.docker.com/v2/search/repositories/?query=${q}&page_size=12`, {}, signal
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

    const host = defaultHostForProvider(provider, registryUrl);
    if (!host) {
      throw new Error(bt('provideRegistryUrl'));
    }
    const currentCfg = getConfig();
    const secret = await context.secrets.get(SECRET_KEY);
    const headers = buildAuthHeaders(
      currentCfg.registryAuthType,
      currentCfg.registryUsername,
      secret
    );
    const data = await httpGetJson(`https://${host}/v2/_catalog?n=100`, headers, signal);
    return (data.repositories ?? [])
      .filter((name: string) => name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 12)
      .map((name: string) => ({
        name: `${host}/${name}:latest`,
        description: 'OCI Registry Catalog',
        source: host,
      }));
  }

  async function currentComposeStatuses(allowInvalid = false) {
    const file = getActiveComposeFile();
    if (!file) {
      throw new Error('No active Compose file.');
    }
    const engine = getConfig().engine;
    const revision = podman.getComposeProjectRevision(file);
    let doc: ComposeDocument;
    try {
      doc = yamlService.parse(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
      if (!allowInvalid) throw error;
      const active = (await podman.listAllContainers())
        .filter((container) => !container.isInfra && isActiveComposeStatus(container.state, engine));
      if (getActiveComposeFile() !== file || podman.getComposeProjectRevision(file) !== revision) {
        throw new Error('The Compose project changed while checking running containers.');
      }
      if (active.length) {
        throw new Error('Cannot safely verify this invalid Compose file while containers are active. Stop them or repair the file in the VS Code editor first.');
      }
      return [];
    }
    const [statuses, containers] = await Promise.all([
      podman.composePs(file, doc),
      podman.listAllContainers(),
    ]);
    if (getActiveComposeFile() !== file || podman.getComposeProjectRevision(file) !== revision) {
      throw new Error('The Compose project changed while checking running containers.');
    }
    return composeEditStatuses(podman.getComposeProjectWatchedFiles(file), statuses, containers);
  }

  async function ensureServiceStopped(serviceName: string): Promise<void> {
    const engine = getConfig().engine;
    const found = (await currentComposeStatuses())
      .find((c) => (!c.service || c.service === serviceName) && isActiveComposeStatus(c.status, engine));
    if (found) {
      throw new Error(bt('stopServiceBeforeEdit', { service: serviceName }));
    }
  }

  async function ensureAllServicesStopped(): Promise<void> {
    const engine = getConfig().engine;
    const active = (await currentComposeStatuses(true))
      .filter((c) => isActiveComposeStatus(c.status, engine))
      .map((c) => c.service || '(unknown service)');
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
      errorCode?: string;
      completed?: number;
      total?: number;
    }>,
    options?: { includeOutput?: boolean; requestId?: string }
  ): Promise<boolean> {
    const success = await withStudioProgress(opKey, label, async (report) => {
      const res = await withStatus(label, () => podman.withCommandProgress(report, task));
      if (!res.success) {
        const details = [res.stderr?.trim(), res.stdout?.trim()].filter(Boolean).join('\n') ||
          bt('engineFailedDefault', { engine: getEngineLabel() });
        reportError(details, label, res.errorCode, summarizeFailure(details, res.errorCode, label, res));
        return false;
      }
      const details = options?.includeOutput
        ? [res.stdout?.trim(), res.stderr?.trim()].filter(Boolean).join('\n')
        : '';
      if (details) {
        output.appendLine(`[${new Date().toISOString()}] ${label}:\n${details}`);
      }
      studioPanel.postMessage({
        command: A.NOTIFICATION,
        payload: {
          type: 'success',
          message: bt('opCompleted', { op: label }),
          ...(details ? { details: boundedDetails(details) } : {}),
        },
      });
      if (!studioPanel.isVisible()) {
        void vscode.window.showInformationMessage(bt('opCompleted', { op: label }));
      }
      return true;
    });
    if (options?.requestId) {
      studioPanel.postMessage({
        command: A.ACTION_RESULT, requestId: options.requestId, payload: { success },
      });
    }
    return success;
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
        completed: results.length - failures.length,
        total: ids.length,
        errorCode: failures.find((item) => item.result.errorCode === 'ETIMEDOUT')?.result.errorCode ??
          failures[0]?.result.errorCode,
        stdout: '',
        stderr: failures.length
          ? [
              bt('batchPartialFailure', {
                completed: results.length - failures.length,
                total: ids.length,
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

  function resourceLabel(resource: RemovableResource): string {
    return bt(resource === 'image' ? 'batchImages' : resource === 'volume' ? 'batchVolumes' : 'batchNetworks');
  }

  async function removeSelectedResources(
    resource: RemovableResource,
    targets: ResourceRemovalTarget[],
    expectedEngine: ContainerEngine
  ): Promise<void> {
    if (!Array.isArray(targets) || targets.length === 0 ||
        targets.some((item) => !item || typeof item.name !== 'string' ||
          typeof item.identity !== 'string') ||
        (expectedEngine !== 'podman' && expectedEngine !== 'docker')) {
      throw new Error('Invalid resource selection. Refresh and try again.');
    }
    const cfg = getConfig();
    const contextKey = () => {
      const current = getConfig();
      return JSON.stringify([
        current.engine,
        current.engine === 'podman' ? current.podmanPath : current.dockerPath,
      ]);
    };
    const initialContext = contextKey();
    if (cfg.engine !== expectedEngine) {
      throw new Error('The active engine changed. Refresh and try again.');
    }
    const unique = Array.from(new Map(targets.map((target) => [target.name, target])).values());
    if (unique.length !== targets.length) {
      throw new Error('Duplicate resource selection. Refresh and try again.');
    }
    const names = unique.map((item) => item.name).join('\n');
    const resourceName = resourceLabel(resource);
    const yes = bt('yes');
    const confirmed = await vscode.window.showWarningMessage(
      bt('confirmSelectedResources', { count: unique.length, resource: resourceName }),
      {
        modal: true,
        detail: bt(resource === 'volume' ? 'confirmSelectedVolumesDetail' : 'confirmSelectedResourcesDetail', { names }),
      },
      yes
    );
    if (confirmed !== yes) {
      return;
    }
    if (contextKey() !== initialContext) {
      throw new Error('The active engine or executable changed. Refresh and try again.');
    }

    const label = bt('batchOperation', {
      action: bt('batchRemove'),
      count: unique.length,
      resource: resourceName,
    });
    try {
      await notifyResult(`${resource}-remove-batch`, label, async () => {
        const results = await podman.removeResourceSelection(resource, unique, expectedEngine);
        const failures = results.filter((item) => !item.result.success);
        const successes = results.filter((item) => item.result.success);
        return {
          success: failures.length === 0,
          completed: successes.length,
          total: unique.length,
          errorCode: failures.find((item) => item.result.errorCode === 'ETIMEDOUT')?.result.errorCode ??
            failures[0]?.result.errorCode,
          stdout: bt('removedResources', {
            count: successes.length,
            resource: resourceName,
            names: successes.map((item) => item.name).join('\n'),
          }),
          stderr: failures.length
            ? [
                bt('batchPartialFailure', { completed: successes.length, total: unique.length }),
                ...failures.map((item) =>
                  `${item.name}: ${(item.result.stderr || item.result.stdout || `exit code ${item.result.exitCode}`).trim()}`
                ),
              ].join('\n')
            : '',
        };
      }, { includeOutput: true });
    } finally {
      await refreshAllStudioData();
    }
  }

  async function cleanupUnusedResources(resource: 'volume' | 'network'): Promise<void> {
    const engine = getConfig().engine;
    const initialContext = engineContextKey();
    const targets = await withStudioProgress(
      `inspect-${resource}`,
      bt('loadingResources', { resource: resourceLabel(resource) }),
      async () => resource === 'volume'
        ? (await podman.listVolumes())
            .filter((volume) => volume.usage === 'unused')
            .map((volume) => ({ name: volume.name, identity: volume.created }))
        : (await podman.listNetworks())
            .filter((network) => network.usage === 'unused' && !network.protected)
            .map((network) => ({ name: network.name, identity: network.fullId }))
    );
    if (engineContextKey() !== initialContext) {
      throw new Error('The active engine or executable changed. Refresh and try again.');
    }
    if (targets.length === 0) {
      studioPanel.postMessage({
        command: A.NOTIFICATION,
        payload: { type: 'info', message: bt('noUnusedResources', { resource: resourceLabel(resource) }) },
      });
      return;
    }
    if (targets.some((target) => !target.identity)) {
      throw new Error('Some unused resources could not be identified safely. Refresh and try again.');
    }
    await removeSelectedResources(resource, targets, engine);
  }

  async function refreshResourceList(
    resource: string,
    command: string,
    task: () => Promise<unknown[]>
  ): Promise<void> {
    const engine = getConfig().engine;
    const initialContext = engineContextKey();
    const generation = nextListGeneration(command);
    const isCurrent = () =>
      listGenerations.get(command) === generation && engineContextKey() === initialContext;
    await withStudioProgress(`list-${command.split(':')[0]}`, bt('loadingResources', { resource }), async () => {
      try {
        const items = await task();
        if (isCurrent()) {
          studioPanel.postMessage({ command, payload: items, engine });
        }
      } catch (error) {
        if (isCurrent()) {
          studioPanel.postMessage({ command, payload: [], engine });
          throw error;
        }
      }
    });
  }

  async function runComposeServiceBatch(payload: any, composeFile?: string): Promise<void> {
    const cfg = getConfig();
    const settingsKey = () => {
      const current = getConfig();
      return JSON.stringify([
        current.engine, current.dockerPath, current.podmanPath,
        current.composePath, current.composeCommandStyle, current.inPod,
      ]);
    };
    const initialSettings = settingsKey();
    if (!composeFile || payload.file !== composeFile || payload.engine !== cfg.engine ||
        !['up', 'stop', 'restart', 'down', 'build', 'rebuild', 'build-up'].includes(payload.action) ||
        typeof payload.rawYaml !== 'string' ||
        !Array.isArray(payload.services) || payload.services.length === 0 ||
        payload.services.some((service: unknown) =>
          typeof service !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(service)) ||
        new Set(payload.services).size !== payload.services.length) {
      throw new Error('Invalid Compose selection or the active project changed. Refresh and try again.');
    }
    const services: string[] = payload.services;
    const allowDirtyEditors = payload.action === 'stop' || payload.action === 'down';
    assertComposeProjectContext(composeFile, payload, allowDirtyEditors);
    const content = fs.readFileSync(composeFile, 'utf-8');
    if (content !== payload.rawYaml) {
      throw new Error('The Compose file changed. Refresh and try again.');
    }
    const doc = podman.hasCustomComposeProject(composeFile)
      ? await podman.resolveComposeDocument(composeFile)
      : yamlService.parse(content);
    assertComposeProjectContext(composeFile, payload, allowDirtyEditors);
    if (services.some((service) => !Object.prototype.hasOwnProperty.call(doc.services || {}, service))) {
      throw new Error('A selected Compose service no longer exists. Refresh and try again.');
    }
    if (['build', 'rebuild', 'build-up'].includes(payload.action) &&
        services.some((service) => !doc.services[service]?.build)) {
      throw new Error('Every selected service must have a build configuration.');
    }
    if (payload.action === 'down') {
      const yes = bt('yes');
      const choice = await vscode.window.showWarningMessage(
        bt('confirmComposeServiceDown', { services: services.join(', ') }),
        { modal: true, detail: bt('confirmServiceContainerRemoval') },
        yes
      );
      if (choice !== yes) {
        return;
      }
    }
    assertComposeProjectContext(composeFile, payload, allowDirtyEditors);
    if (settingsKey() !== initialSettings || fs.readFileSync(composeFile, 'utf-8') !== content) {
      throw new Error('Compose settings or file changed. Refresh and try again.');
    }
    const action = payload.action as 'up' | 'stop' | 'restart' | 'down' | 'build' | 'rebuild' | 'build-up';
    const label = bt('batchOperation', {
      action: bt(action === 'up' ? 'batchStart' : action === 'stop' ? 'batchStop' :
        action === 'restart' ? 'batchRestart' : action === 'build' ? 'batchBuild' :
        action === 'rebuild' ? 'batchRebuild' : action === 'build-up' ? 'batchBuildUp' : 'batchRemove'),
      count: services.length,
      resource: bt('batchServices'),
    });
    try {
      await notifyResult(`compose-${action}-batch`, label, () => {
        if (action === 'up') return podman.composeUp(composeFile, { services });
        if (action === 'stop') return podman.composeStop(composeFile, services);
        if (action === 'restart') return podman.composeRestart(composeFile, services);
        if (action === 'build') return podman.composeBuild(composeFile, services);
        if (action === 'rebuild') return podman.composeBuild(composeFile, services, undefined, { noCache: true });
        if (action === 'build-up') return podman.composeBuildUp(composeFile, services);
        return podman.composeRemoveServices(composeFile, services, doc, content);
      }, { includeOutput: action === 'down' || action === 'build' || action === 'rebuild' || action === 'build-up' });
    } finally {
      await refreshAllStudioData();
    }
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
          const info = await withStudioProgress('system-info', bt('loadingSystemInfo'), () =>
            podman.getSystemInfo()
          );
          studioPanel.postMessage({ command: A.SYSTEM_INFO_UPDATE, payload: info, engine });
          break;
        }
        case M.DISK_USAGE_GET: {
          const df = await withStudioProgress('disk-usage', bt('loadingDiskUsage'), () =>
            podman.getDiskUsage()
          );
          studioPanel.postMessage({ command: A.DISK_USAGE_UPDATE, payload: df, engine });
          break;
        }

        // Docker Contexts
        case M.DOCKER_CONTEXTS_LIST: {
          await refreshResourceList('Docker contexts', A.DOCKER_CONTEXTS_UPDATE, () => podman.listDockerContexts());
          break;
        }
        case M.DOCKER_CONTEXT_USE: {
          if (!payload.name?.trim()) {
            break;
          }
          await notifyResult(
            'context-use',
            bt('actionContextUse', { name: String(payload.name) }),
            () => podman.useDockerContext(String(payload.name))
          );
          await refreshAllStudioData();
          break;
        }

        // Podman Machines
        case M.MACHINES_LIST: {
          await refreshResourceList('Podman machines', A.MACHINES_UPDATE, () => podman.listMachines());
          break;
        }
        case M.MACHINE_START: {
          await notifyResult(
            'machine-start',
            bt('actionMachineStart', { name: String(payload.name || '') }).trim(),
            () => podman.startMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }
        case M.MACHINE_STOP: {
          await notifyResult(
            'machine-stop',
            bt('actionMachineStop', { name: String(payload.name || '') }).trim(),
            () => podman.stopMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }
        case M.MACHINE_RESTART: {
          await notifyResult(
            'machine-restart',
            bt('actionMachineRestart', { name: String(payload.name || '') }).trim(),
            () => podman.restartMachine(payload.name)
          );
          await refreshAllStudioData();
          break;
        }

        // Pods
        case M.PODS_LIST: {
          await refreshAllStudioData();
          break;
        }
        case M.POD_CREATE: {
          const ok = await notifyResult(
            'pod-create',
            bt('actionPodCreate', { name: String(payload.name || '') }).trim(),
            () => podman.createPod(payload),
            { requestId: msg.requestId }
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.POD_START: {
          await notifyResult('pod-start', bt('actionPodStart', { name: String(payload.podId) }), () =>
            podman.startPod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_STOP: {
          await notifyResult('pod-stop', bt('actionPodStop', { name: String(payload.podId) }), () =>
            podman.stopPod(payload.podId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_RESTART: {
          await notifyResult('pod-restart', bt('actionPodRestart', { name: String(payload.podId) }), () =>
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
          await notifyResult(
            pause ? 'pod-pause' : 'pod-unpause',
            bt(pause ? 'actionPodPause' : 'actionPodResume', { name: String(payload.podId) }),
            () =>
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
          await notifyResult('pod-remove', bt('actionPodRemove', { name: String(payload.podId) }), () =>
            podman.removePod(payload.podId, true)
          );
          await refreshAllStudioData();
          break;
        }
        case M.POD_LOGS: {
          await withStudioProgress('pod-logs', bt('loadingLogs'), async () => {
            const res = await podman.getPodLogs(payload.podId, 300);
            if (!res.success) {
              throw new Error(res.stderr || 'Failed to read Podman pod logs.');
            }
            const entries = `${res.stdout}\n${res.stderr}`
              .split(/\r?\n/)
              .filter((l) => l.trim().length > 0)
              .map((line) => logProvider.parseLine(`pod:${payload.podName || payload.podId}`, line));
            studioPanel.postMessage({ command: A.LOG_HISTORY, payload: entries });
          });
          break;
        }

        // Containers
        case M.CONTAINERS_LIST: {
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_CREATE: {
          const ok = await notifyResult(
            'container-create',
            bt('actionContainerCreate', { name: String(payload.name || payload.image || '') }),
            () => podman.createContainer(payload),
            { requestId: msg.requestId }
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.CONTAINER_START: {
          await notifyResult('container-start', bt('actionContainerStart', { name: String(payload.containerId) }), () =>
            podman.startContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_STOP: {
          await notifyResult('container-stop', bt('actionContainerStop', { name: String(payload.containerId) }), () =>
            podman.stopContainer(payload.containerId)
          );
          await refreshAllStudioData();
          break;
        }
        case M.CONTAINER_RESTART: {
          await notifyResult('container-restart', bt('actionContainerRestart', { name: String(payload.containerId) }), () =>
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
            bt(pause ? 'actionContainerPause' : 'actionContainerResume', { name: String(payload.containerId) }),
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
          await notifyResult('container-remove', bt('actionContainerRemove', { name: String(payload.containerId) }), () =>
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
          await withStudioProgress('container-logs', bt('loadingLogs'), async () => {
            const res = await podman.getContainerLogHistory(cid, 350);
            if (!res.success) {
              throw new Error(res.stderr || `Failed to read container logs: ${cid}`);
            }
            const entries = `${res.stdout}\n${res.stderr}`
              .split(/\r?\n/)
              .filter((l) => l.trim().length > 0)
              .map((line) => logProvider.parseLine(payload.name || cid, line));
            studioPanel.postMessage({ command: A.LOG_HISTORY, payload: entries });
          });
          break;
        }
        case M.CONTAINER_LOGS_EXTERNAL: {
          await podman.openLogsExternal(payload.containerId, payload.name, payload.mode);
          break;
        }

        // Images & Prune
        case M.IMAGES_LIST: {
          await refreshResourceList(resourceLabel('image'), A.IMAGES_UPDATE, () => podman.listImages());
          break;
        }
        case M.IMAGE_PULL: {
          if (!payload.imageName?.trim()) {
            throw new Error('Provide an image name before downloading.');
          }
          await notifyResult('pulling', bt('actionImagePull', { name: String(payload.imageName) }), () =>
            podman.pullImage(payload.imageName),
            { requestId: msg.requestId }
          );
          await refreshResourceList(resourceLabel('image'), A.IMAGES_UPDATE, () => podman.listImages());
          break;
        }
        case M.IMAGE_BUILD: {
          const ok = await notifyResult('image-build', bt('actionImageBuild', { name: String(payload.tag) }), () =>
            podman.buildImage(payload.dockerfile, payload.tag, payload.contextDir),
            { requestId: msg.requestId }
          );
          if (ok) {
            await refreshAllStudioData();
          }
          break;
        }
        case M.IMAGE_PUSH: {
          await notifyResult(
            'image-push',
            bt('actionImagePush', { name: String(payload.targetTag || payload.sourceImage) }),
            () => podman.pushImage(payload.sourceImage, payload.targetTag),
            { requestId: msg.requestId }
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
          await notifyResult('image-remove', bt('actionImageRemove', { name: String(payload.imageId) }), () =>
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
          await notifyResult(
            'prune-images', bt('actionPruneImages'),
            () => podman.pruneDanglingImages(), { includeOutput: true }
          );
          await refreshAllStudioData();
          break;
        }
        case M.PRUNE_ALL_IMAGES: {
          if (!(await confirmPodmanAction(bt('confirmPruneUnused')))) {
            break;
          }
          await notifyResult(
            'prune-all-images', bt('actionPruneAllImages'),
            () => podman.pruneAllUnusedImages(), { includeOutput: true }
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
          await notifyResult(
            'prune-builder', bt('actionPruneBuilder', { engine: engineLabel }),
            () => podman.pruneBuilderCache(), { includeOutput: true }
          );
          await refreshAllStudioData();
          break;
        }
        case M.PRUNE_VOLUMES: {
          await cleanupUnusedResources('volume');
          break;
        }
        case M.PRUNE_NETWORKS: {
          await cleanupUnusedResources('network');
          break;
        }
        case M.RESOURCE_REMOVE_BATCH: {
          if (payload.resource !== 'image' && payload.resource !== 'volume' && payload.resource !== 'network') {
            throw new Error('Invalid resource type.');
          }
          await removeSelectedResources(payload.resource, payload.targets, payload.engine);
          break;
        }

        // Networks
        case M.NETWORKS_LIST: {
          await refreshResourceList(resourceLabel('network'), A.NETWORKS_UPDATE, () => podman.listNetworks());
          break;
        }
        case M.NETWORK_CREATE: {
          const ok = await notifyResult('network-create', bt('actionNetworkCreate', { name: String(payload.name) }), () =>
            podman.createNetwork(payload),
            { requestId: msg.requestId }
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
          await notifyResult('network-remove', bt('actionNetworkRemove', { name: String(payload.networkName) }), () =>
            podman.removeNetwork(payload.networkName, engine === 'docker')
          );
          await refreshAllStudioData();
          break;
        }

        // Volumes
        case M.VOLUMES_LIST: {
          await refreshResourceList(resourceLabel('volume'), A.VOLUMES_UPDATE, () => podman.listVolumes());
          break;
        }
        case M.VOLUME_CREATE: {
          const ok = await notifyResult('volume-create', bt('actionVolumeCreate', { name: String(payload.name) }), () =>
            podman.createVolume(payload.name, payload.driver, payload.labels),
            { requestId: msg.requestId }
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
          await notifyResult('volume-remove', bt('actionVolumeRemove', { name: String(payload.volumeName) }), () =>
            podman.removeVolume(payload.volumeName, engine === 'docker')
          );
          await refreshAllStudioData();
          break;
        }

        // Compose Stack
        case M.STACK_SERVICES_BATCH: {
          await runComposeServiceBatch(payload, composeFile);
          break;
        }
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
        case M.COMPOSE_OPTIONS_PICK: {
          if (!composeFile || payload.file !== composeFile ||
              !['files', 'env'].includes(payload.kind)) {
            throw new Error('The active Compose project changed. Refresh and try again.');
          }
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: payload.kind === 'files',
            defaultUri: vscode.Uri.file(path.dirname(composeFile)),
            ...(payload.kind === 'files' ? { filters: { 'Compose YAML': ['yml', 'yaml'] } } : {}),
          });
          if (picked?.length && getActiveComposeFile() === composeFile) {
            studioPanel.postMessage({
              command: A.COMPOSE_OPTIONS_SELECTED,
              payload: { file: composeFile, kind: payload.kind, paths: picked.map((item) => item.fsPath) },
              requestId: msg.requestId,
            });
          }
          break;
        }
        case M.COMPOSE_OPTIONS_SAVE: {
          if (!composeFile || payload.file !== composeFile || payload.engine !== getConfig().engine ||
              typeof payload.rawYaml !== 'string') {
            throw new Error('The active Compose project changed. Refresh and try again.');
          }
          const previous = podman.getComposeProjectOptions(composeFile);
          const next = podman.validateComposeProjectOptions(composeFile, payload.options);
          const previousKey = JSON.stringify(previous);
          const checkPrevious = () => {
            if (getActiveComposeFile() !== composeFile || getConfig().engine !== payload.engine ||
                JSON.stringify(podman.getComposeProjectOptions(composeFile)) !== previousKey ||
                JSON.stringify(payload.previousOptions) !== previousKey ||
                fs.readFileSync(composeFile, 'utf-8') !== payload.rawYaml ||
                (typeof payload.projectRevision === 'string' &&
                  podman.getComposeProjectRevision(composeFile) !== payload.projectRevision)) {
              throw new Error('The Compose project changed. Refresh and try again.');
            }
            if (hasDirtyProjectEditor([...podman.getComposeProjectWatchedFiles(composeFile),
              ...podman.getComposeProjectWatchedFiles(composeFile, next)])) {
              throw new Error('Save or discard unsaved VS Code changes in the Compose project files before continuing.');
            }
          };
          await withStudioProgress('compose-options', bt('validateComposeConfig'), async () => {
            checkPrevious();
            const nextRevision = podman.getComposeProjectRevision(composeFile, next);
            const doc = await podman.resolveComposeDocument(composeFile, next);
            checkPrevious();
            if (podman.getComposeProjectRevision(composeFile, next) !== nextRevision) {
              throw new Error('A Compose project file changed during validation. Try again.');
            }
            podman.setComposeProjectOptions(composeFile, next);
            const oldStored = storedComposeOptions[composeFile];
            storedComposeOptions[composeFile] = next;
            try {
              await context.workspaceState.update(composeOptionsKey, { ...storedComposeOptions });
            } catch (error) {
              podman.setComposeProjectOptions(composeFile, previous, false);
              if (oldStored) storedComposeOptions[composeFile] = oldStored;
              else delete storedComposeOptions[composeFile];
              throw error;
            }
            resolvedCompose = { file: composeFile, revision: nextRevision, document: doc };
            pendingComposeResolution = undefined;
            if (getActiveComposeFile() === composeFile) {
              statusProvider.clearActiveFile();
              statusProvider.startPolling(composeFile, getConfig().pollingInterval);
              sendComposeState();
            }
            studioPanel.postMessage({
              command: A.COMPOSE_OPTIONS_SAVED,
              payload: { file: composeFile },
              requestId: msg.requestId,
            });
          });
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
          const generation = cancelImageSearch();
          const q = String(payload.query || '').trim();
          if (!q) {
            studioPanel.postMessage({
              command: A.COMPOSE_IMAGE_RESULTS,
              payload: { results: [] },
            });
            break;
          }
          const current = getConfig();
          const { provider, registryUrl } = resolveRegistrySearch(
            payload.registryType, payload.registryUrl, current
          );
          const controller = new AbortController();
          imageSearchController = controller;
          try {
            const results = await withStudioProgress(
              'image-search',
              bt('loadingResources', { resource: resourceLabel('image') }),
              () => searchImages(provider, registryUrl, q, controller.signal)
            );
            if (generation === imageSearchGeneration) {
              studioPanel.postMessage({ command: A.COMPOSE_IMAGE_RESULTS, payload: { results } });
            }
          } catch (error) {
            if (generation === imageSearchGeneration) {
              const message = error instanceof Error ? error.message : String(error);
              const label = bt('loadingResources', { resource: resourceLabel('image') });
              reportError(error, label);
              studioPanel.postMessage({
                command: A.COMPOSE_IMAGE_RESULTS,
                payload: { results: [], error: summarizeFailure(message, undefined, label) },
              });
            } else if (!controller.signal.aborted) {
              output.appendLine(`[${new Date().toISOString()}] Image search: ${String(error)}`);
            }
          } finally {
            if (imageSearchController === controller) imageSearchController = undefined;
          }
          break;
        }
        case M.COMPOSE_FILE_CREATE: {
          const targetPath = resolveComposeTarget(payload.directory, payload.fileName);
          if (fs.existsSync(targetPath)) {
            throw new Error(bt('fileAlreadyExists', { path: targetPath }));
          }
          const yaml = serializeComposeBuilder(payload.spec);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, yaml, { encoding: 'utf-8', flag: 'wx' });
          activeComposeFile = targetPath;
          try {
            await fileDetector.registerFile(targetPath);
          } catch (error) {
            throw new Error(`The file was created at ${targetPath}, but registration failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          statusProvider.startPolling(targetPath, getConfig().pollingInterval);
          sendComposeState();
          studioPanel.postMessage({ command: A.COMPOSE_CREATE_SAVED, requestId: msg.requestId });
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
          readComposeEditBase(composeFile, { ...payload, baseYaml: payload.rawYaml });
          await notifyResult('start', bt('actionComposeUp', { engine: engineLabel }), () =>
            podman.composeUp(composeFile, payload)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_STOP: {
          if (!composeFile) {
            break;
          }
          assertComposeProjectContext(composeFile, payload, true);
          await notifyResult('stop', bt('actionComposeStop', { engine: engineLabel }), () =>
            podman.composeStop(composeFile, payload?.services)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_DOWN: {
          if (!composeFile) {
            break;
          }
          assertComposeProjectContext(composeFile, payload, true);
          const services = Array.isArray(payload?.services) ? payload.services : [];
          if (!(await confirmPodmanAction(
            services.length > 0
              ? bt('confirmComposeServiceDown', { services: services.join(', ') })
              : bt('confirmComposeDown'),
            payload.removeVolumes ? bt('confirmComposeVolumes') : undefined
          ))) {
            break;
          }
          assertComposeProjectContext(composeFile, payload, true);
          if (Array.isArray(payload?.services) && payload.services.length > 0) {
            const doc = podman.hasCustomComposeProject(composeFile)
              ? await podman.resolveComposeDocument(composeFile)
              : yamlService.parse(fs.readFileSync(composeFile, 'utf-8'));
            assertComposeProjectContext(composeFile, payload, true);
            await notifyResult('down', bt('actionServiceRemove', { name: payload.services.join(', ') }), () =>
              podman.composeRemoveServices(composeFile, payload.services, doc)
            );
          } else {
            await notifyResult('down', bt('actionComposeDown', { engine: engineLabel }), () =>
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
          assertComposeProjectContext(composeFile, payload);
          await notifyResult('restart', bt('actionComposeRestart', { engine: engineLabel }), () =>
            podman.composeRestart(composeFile, payload?.services)
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_BUILD: {
          if (!composeFile) {
            break;
          }
          readComposeEditBase(composeFile, { ...payload, baseYaml: payload.rawYaml });
          await notifyResult(payload.noCache ? 'rebuild' : 'build',
            bt(payload.noCache ? 'actionComposeRebuild' : 'actionComposeBuild', { engine: engineLabel }), () =>
            podman.composeBuild(composeFile, payload?.services, undefined, { noCache: payload.noCache === true }),
            { includeOutput: true }
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_BUILD_UP: {
          if (!composeFile) {
            break;
          }
          readComposeEditBase(composeFile, { ...payload, baseYaml: payload.rawYaml });
          await notifyResult('build-up', bt('actionComposeBuildUp', { engine: engineLabel }), () =>
            podman.composeBuildUp(composeFile, payload?.services),
            { includeOutput: true }
          );
          await refreshAllStudioData();
          break;
        }
        case M.STACK_SCALE: {
          if (!composeFile || !payload.service || payload.replicas === undefined) {
            throw new Error('Select a Compose service and a replica count before scaling.');
          }
          assertComposeProjectContext(composeFile, payload);
          const replicas = typeof payload.replicas === 'number'
            ? payload.replicas
            : typeof payload.replicas === 'string' && /^\d+$/.test(payload.replicas.trim())
              ? Number(payload.replicas.trim())
              : NaN;
          let expectedContainerIds: string[] | undefined;
          let expectedComposeContent: string | undefined;
          const approved = await withStudioProgress('scale-check', bt('loadingComposeStatus'), async () => {
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
              const doc = podman.hasCustomComposeProject(composeFile)
                ? await podman.resolveComposeDocument(composeFile)
                : yamlService.parse(expectedComposeContent);
              assertComposeProjectContext(composeFile, payload);
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
              assertComposeProjectContext(composeFile, payload);
              if (current.length > replicas && !(await confirmPodmanAction(
                bt('confirmScaleDown', {
                  service: String(payload.service),
                  count: current.length - replicas,
                }),
                bt('confirmScaleDataWarning')
              ))) {
                return false;
              }
              if (getPodmanComposeSettingsKey() !== initialSettings ||
                  getActiveComposeFile() !== composeFile ||
                  fs.readFileSync(composeFile, 'utf-8') !== expectedComposeContent) {
                throw new Error('Compose settings or the file changed; refresh before scaling.');
              }
              assertComposeProjectContext(composeFile, payload);
            }
            return true;
          });
          if (!approved) {
            if (msg.requestId) {
              studioPanel.postMessage({
                command: A.ACTION_RESULT, requestId: msg.requestId, payload: { success: false },
              });
            }
            break;
          }
          await notifyResult('scale', bt('actionComposeScale', { name: String(payload.service) }), () =>
            podman.composeScale(
              composeFile, payload.service, replicas, undefined, expectedContainerIds, expectedComposeContent
            ),
            { requestId: msg.requestId }
          );
          await refreshAllStudioData();
          break;
        }
        case M.LOGS_START: {
          if (!composeFile || !payload.service) {
            break;
          }
          assertComposeProjectContext(composeFile, payload, true);
          const svc = String(payload.service);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(svc) ||
              (payload.containerId && !/^[a-f0-9]{64}$/i.test(payload.containerId))) {
            throw new Error('Invalid Compose service or replica for logs.');
          }
          const containerId = payload.containerId ? String(payload.containerId) : undefined;
          const key = composeLogKey(composeFile, engine, payload.projectRevision, svc, containerId);
          const entries = logProvider.getHistory(key);
          studioPanel.postMessage({
            command: A.LOG_HISTORY,
            payload: { target: key, entries },
          });
          await logProvider.startComposeStreaming(composeFile, svc, {
            key, containerId,
          });
          break;
        }
        case M.LOGS_STOP: {
          if (payload.file && payload.engine && payload.projectRevision && payload.service) {
            logProvider.stopStreaming(composeLogKey(
              String(payload.file), String(payload.engine), String(payload.projectRevision),
              String(payload.service), payload.containerId ? String(payload.containerId) : undefined
            ));
          }
          break;
        }
        case M.LOGS_CLEAR: {
          if (payload.file && payload.engine && payload.projectRevision && payload.service) {
            logProvider.clearHistory(composeLogKey(
              String(payload.file), String(payload.engine), String(payload.projectRevision),
              String(payload.service), payload.containerId ? String(payload.containerId) : undefined
            ));
          }
          break;
        }
        case M.SERVICE_ADD: {
          if (!composeFile || !payload.spec) {
            throw new Error('The active Compose project or service specification is unavailable.');
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          if (!Array.isArray(payload.spec.services) || payload.spec.services.length !== 1) {
            throw new Error('Exactly one service is required when adding to an existing project.');
          }
          const current = yamlService.parse(raw);
          const generated = buildComposeDocument(payload.spec, current.services);
          const [name, definition] = Object.entries(generated.services)[0];
          const next = yamlService.addServiceToYaml(raw, { name, ...definition }, generated);
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.SERVICE_UPDATE: {
          if (!composeFile || !payload.name) {
            throw new Error('The active Compose project or service is unavailable.');
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          await ensureServiceStopped(payload.name);
          const next = yamlService.updateServiceInYaml(raw, payload.name, payload.definitionYaml);
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.SERVICE_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          await ensureServiceStopped(payload.name);
          const next = yamlService.removeServiceFromYaml(raw, payload.name);
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.COMPOSE_RAW_SAVE: {
          if (!composeFile || typeof payload.rawYaml !== 'string') {
            break;
          }
          readComposeEditBase(composeFile, payload);
          await ensureAllServicesStopped();
          const issues = yamlService.validate(payload.rawYaml);
          const fatal = issues.find((i) => i.severity === 'error');
          if (fatal) {
            throw new Error(`YAML Error: ${fatal.message}`);
          }
          saveComposeEdit(composeFile, payload, payload.rawYaml, msg.requestId);
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
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          const next = yamlService.addResourceToYaml(raw, 'networks', payload.name, {
            ...(payload.driver ? { driver: payload.driver } : {}),
            ...(payload.external !== undefined ? { external: Boolean(payload.external) } : {}),
          });
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.COMPOSE_NETWORK_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          const next = yamlService.removeResourceFromYaml(raw, 'networks', payload.name);
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.COMPOSE_VOLUME_ADD: {
          if (!composeFile || !payload.name) {
            break;
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          const next = yamlService.addResourceToYaml(raw, 'volumes', payload.name, {
            ...(payload.driver ? { driver: payload.driver } : {}),
            ...(payload.external !== undefined ? { external: Boolean(payload.external) } : {}),
          });
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.COMPOSE_VOLUME_REMOVE: {
          if (!composeFile || !payload.name) {
            break;
          }
          assertVisualComposeEditAllowed(composeFile);
          const raw = readComposeEditBase(composeFile, payload);
          const next = yamlService.removeResourceFromYaml(raw, 'volumes', payload.name);
          saveComposeEdit(composeFile, payload, next, msg.requestId);
          break;
        }
        case M.COMPOSE_GET: {
          resolvedCompose = undefined;
          sendComposeState();
          break;
        }
        case M.STATUS_GET: {
          const statuses = await withStudioProgress('compose-status', bt('loadingComposeStatus'), () =>
            statusProvider.poll()
          );
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
          settingsWriteDepth++;
          try {
            const success = await withStudioProgress('settings-save', bt('savingSettings'), async () => {
              if (payload.longOperationTimeoutMinutes !== undefined &&
                  (!Number.isInteger(payload.longOperationTimeoutMinutes) ||
                   payload.longOperationTimeoutMinutes < 5 || payload.longOperationTimeoutMinutes > 720)) {
                throw new Error(bt('invalidLongOperationTimeout'));
              }

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
                'longOperationTimeoutMinutes',
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
              const effectiveSecret = String(
                payload.registrySecret || (await context.secrets.get(SECRET_KEY)) || ''
              );
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
                    const details = (loginRes.stderr || loginRes.stdout || bt('failureGeneric'))
                      .split(effectiveSecret).join('[redacted]');
                    await sendSettingsState();
                    reportError(details, undefined, loginRes.errorCode, bt('settingsSavedLoginIssue', { cmd }));
                    return false;
                  }
                }
              }

              statusBar.refreshLocalization();
              launcherProvider.refreshLocalization();
              const savedConfigGeneration = configChangeGeneration;
              const currentFile = getActiveComposeFile();
              if (currentFile) {
                statusProvider.startPolling(currentFile, getConfig().pollingInterval);
              }
              await sendSettingsState();
              await refreshAllStudioData();
              studioPanel.postMessage({
                command: A.NOTIFICATION,
                payload: { type: 'success', message: bt('settingsSavedToast') },
              });
              if (configChangeGeneration === savedConfigGeneration) configRefreshPending = false;
              return true;
            });
            if (msg.requestId) {
              studioPanel.postMessage({
                command: A.ACTION_RESULT, requestId: msg.requestId, payload: { success },
              });
            }
          } finally {
            settingsWriteDepth--;
            if (configRefreshPending) queueConfigRefresh();
          }
          break;
        }
        case M.SETTINGS_TEST: {
          await withStudioProgress('registry-test', bt('testingRegistry'), async () => {
            let secret = '';
            try {
              const merged = { ...getConfig(), ...payload };
              const cmd = merged.engine === 'podman' ? 'podman' : 'docker';
              secret = payload.registrySecret || (await context.secrets.get(SECRET_KEY)) || '';
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
                return;
              }
              if (merged.registryProvider === 'quay' && !merged.registryUrl) {
                await searchImages('quay', '', 'podman');
                studioPanel.postMessage({
                  command: A.SETTINGS_TEST_RESULT,
                  payload: { ok: true, message: bt('quayOk') },
                });
                return;
              }
              if (merged.registryProvider === 'dockerhub' && !merged.registryUrl) {
                await searchImages('dockerhub', '', 'alpine');
                studioPanel.postMessage({
                  command: A.SETTINGS_TEST_RESULT,
                  payload: { ok: true, message: bt('dockerHubOk') },
                });
                return;
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
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const safeMessage = secret ? message.split(secret).join('[redacted]') : message;
              reportError(safeMessage, bt('testingRegistry'));
              studioPanel.postMessage({
                command: A.SETTINGS_TEST_RESULT,
                payload: { ok: false, message: summarizeFailure(safeMessage, undefined, bt('testingRegistry')) },
              });
            }
          });
          break;
        }
        case M.SETTINGS_DISCONNECT: {
          const success = await withStudioProgress('registry-disconnect', bt('disconnectingRegistry'), async () => {
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
              return true;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              studioPanel.postMessage({
                command: A.SETTINGS_TEST_RESULT,
                payload: { ok: false, message: summarizeFailure(message, undefined, bt('disconnectingRegistry')) },
              });
              reportError(error, bt('disconnectingRegistry'));
              return false;
            }
          });
          if (msg.requestId) {
            studioPanel.postMessage({
              command: A.ACTION_RESULT, requestId: msg.requestId, payload: { success },
            });
          }
          break;
        }
        case M.SETTINGS_RESET_PATHS: {
          await withStudioProgress('settings-reset', bt('resettingPaths'), async () => {
            await resetEnginePaths();
            await sendSettingsState();
            studioPanel.postMessage({
              command: A.NOTIFICATION, payload: { type: 'success', message: bt('pathsResetToast') },
            });
          });
          if (msg.requestId) {
            studioPanel.postMessage({
              command: A.ACTION_RESULT, requestId: msg.requestId, payload: { success: true },
            });
          }
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
        case M.OUTPUT_SHOW: {
          output.show(true);
          break;
        }
        case M.OUTPUT_COPY: {
          if (typeof payload.text === 'string') {
            await vscode.env.clipboard.writeText(payload.text);
          }
          break;
        }
        case M.OPERATIONS_GET: {
          studioPanel.postMessage({ command: A.OPERATION_SNAPSHOT, payload: progress.snapshot() });
          break;
        }
      }
    } catch (err: unknown) {
      if (msg.requestId) {
        studioPanel.postMessage({
          command: A.ACTION_RESULT, requestId: msg.requestId, payload: { success: false },
        });
      }
      if (msg.command === M.COMPOSE_FILE_CREATE && msg.requestId) {
        studioPanel.postMessage({ command: A.COMPOSE_CREATE_FAILED, requestId: msg.requestId });
      }
      if (msg.command === M.COMPOSE_OPTIONS_SAVE && msg.requestId) {
        studioPanel.postMessage({ command: A.COMPOSE_OPTIONS_FAILED, requestId: msg.requestId });
      }
      if ((msg.command === M.SERVICE_ADD || msg.command === M.SERVICE_UPDATE) && msg.requestId) {
        studioPanel.postMessage({ command: A.COMPOSE_EDIT_FAILED, requestId: msg.requestId });
      }
      reportError(err);
    }
  });

  // Push live status & log updates to Webview
  statusProvider.onStatusChange((containers) => {
    studioPanel.postMessage({
      command: A.CONTAINERS_UPDATE, payload: containers, engine: getConfig().engine,
    });
  });
  statusProvider.onError((message) => reportError(message));
  logProvider.onLogLine((entry) => {
    studioPanel.postMessage({ command: A.LOG_LINE, payload: entry });
  });
  logProvider.onError((message) => reportError(message));

  function queueConfigRefresh(): void {
    configChangeGeneration++;
    configRefreshPending = true;
    if (settingsWriteDepth > 0) return;
    if (configRefreshTimer) clearTimeout(configRefreshTimer);
    configRefreshTimer = setTimeout(() => {
      configRefreshTimer = undefined;
      if (settingsWriteDepth > 0) return;
      configRefreshPending = false;
      const updated = getConfig();
      const currentFile = getActiveComposeFile();
      if (currentFile) {
        statusProvider.startPolling(currentFile, updated.pollingInterval);
      }
      statusBar.refreshLocalization();
      launcherProvider.refreshLocalization();
      void Promise.all([sendSettingsState(), refreshAllStudioData()]).catch((error) => reportError(error));
    }, 250);
  }

  const cfgDisposable = onConfigChange(queueConfigRefresh);

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
    refreshAllStudioData,
    withStudioProgress,
    output
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
    { dispose: () => { if (configRefreshTimer) clearTimeout(configRefreshTimer); } },
    completionDisp,
    diagnosticsDisp,
    nativeCommands,
    openPanelDisp,
    launcherViewDisp,
    output
  );
}

export function deactivate(): void {}
