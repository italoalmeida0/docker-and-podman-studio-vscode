import { useEffect } from 'react';
import { create } from 'zustand';
import { createEngineMessageGate, StudioMessage, useVsCodeMessaging } from './vscode';

export type ContainerEngine = 'docker' | 'podman';

export type SupportedLocale =
  | 'en'
  | 'pt-BR'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'ru'
  | 'uk'
  | 'pl'
  | 'tr'
  | 'nl'
  | 'ja'
  | 'ko'
  | 'zh-CN'
  | 'zh-TW'
  | 'hi';

export type LanguageSetting = 'auto' | SupportedLocale;

export function normalizeLocaleCode(raw?: string): SupportedLocale {
  const code = (raw || navigator.language || 'en').toLowerCase();
  if (code.startsWith('pt')) {
    return 'pt-BR';
  }
  if (code.startsWith('es')) {
    return 'es';
  }
  if (code.startsWith('fr')) {
    return 'fr';
  }
  if (code.startsWith('de')) {
    return 'de';
  }
  if (code.startsWith('it')) {
    return 'it';
  }
  if (code.startsWith('ru')) {
    return 'ru';
  }
  if (code.startsWith('uk')) {
    return 'uk';
  }
  if (code.startsWith('pl')) {
    return 'pl';
  }
  if (code.startsWith('tr')) {
    return 'tr';
  }
  if (code.startsWith('nl')) {
    return 'nl';
  }
  if (code.startsWith('ja')) {
    return 'ja';
  }
  if (code.startsWith('ko')) {
    return 'ko';
  }
  if (code === 'zh-tw' || code === 'zh-hk' || code.includes('hant')) {
    return 'zh-TW';
  }
  if (code.startsWith('zh')) {
    return 'zh-CN';
  }
  if (code.startsWith('hi')) {
    return 'hi';
  }
  return 'en';
}

export type ServiceStatus =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'restarting'
  | 'unhealthy'
  | 'paused'
  | 'exited'
  | 'stopped';

export interface PortMapping {
  hostIp?: string;
  host: string;
  container: string;
  protocol: string;
}

export interface ComposeContainerStatus {
  id: string;
  fullId: string;
  name: string;
  service: string;
  replica?: number;
  status: ServiceStatus;
  ports: PortMapping[];
  image: string;
  uptime: string;
  health?: string;
  exitCode?: number;
  podId?: string;
  podName?: string;
}

export interface PodContainerSummary {
  id: string;
  name: string;
  status: string;
  restartCount: number;
}

export interface PodmanPod {
  id: string;
  fullId: string;
  name: string;
  status: string;
  state: ServiceStatus;
  created: string;
  infraId: string;
  networks: string[];
  labels: Record<string, string>;
  containers: PodContainerSummary[];
}

export interface PodmanContainer {
  id: string;
  fullId: string;
  name: string;
  image: string;
  imageId: string;
  status: string;
  state: ServiceStatus;
  ports: string;
  portMappings: PortMapping[];
  created: string;
  podId: string;
  podName: string;
  isCompose: boolean;
  composeProject: string;
  composeService: string;
  composeReplica?: number;
  composeFile: string;
  composeFiles: string[];
  networks: string[];
  mounts: string[];
  command: string;
  isInfra: boolean;
}

export interface PodmanImage {
  id: string;
  fullId: string;
  repository: string;
  tag: string;
  names: string[];
  size: string;
  sizeBytes: number;
  created: string;
  containers: number;
  inUse: boolean;
  dangling: boolean;
  digest: string;
}

export interface PodmanVolume {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
  anonymous: boolean;
  composeProject: string;
  labels: Record<string, string>;
  usage: 'unused' | 'inUse';
}

export interface PodmanSubnet {
  subnet: string;
  gateway: string;
}

export interface PodmanNetwork {
  id: string;
  fullId: string;
  name: string;
  driver: string;
  networkInterface: string;
  created: string;
  subnets: PodmanSubnet[];
  dnsEnabled: boolean;
  internal: boolean;
  ipv6Enabled: boolean;
  composeProject: string;
  usage: 'unused' | 'inUse';
  protected: boolean;
}

export interface PodmanMachine {
  name: string;
  default: boolean;
  running: boolean;
  starting: boolean;
  vmType: string;
  cpus: number;
  memory: string;
  diskSize: string;
  lastUp: string;
  port?: number;
}

export interface DockerContextItem {
  name: string;
  description: string;
  dockerEndpoint: string;
  current: boolean;
  error?: string;
}

export interface PodmanSystemInfo {
  engine: ContainerEngine;
  hostname: string;
  engineVersion: string;
  podmanVersion: string;
  apiVersion: string;
  composeVersion: string;
  os: string;
  kernel: string;
  architecture: string;
  cpus: number;
  memoryTotal: string;
  memoryFree: string;
  storageDriver: string;
  remoteSocket: string;
  containersRunning: number;
  containersStopped: number;
  containersPaused: number;
  containersTotal: number;
  images: number;
  podsTotal: number;
  podsRunning: number;
}

export interface PodmanDiskUsageItem {
  type: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
}

export interface ComposeDocument {
  name?: string;
  version?: string;
  services: Record<string, any>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
  configs?: Record<string, any>;
  secrets?: Record<string, any>;
}

export interface LogEntry {
  service: string;
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export interface ImageSearchResult {
  name: string;
  description: string;
  source: string;
}

export interface StudioSettings {
  engine: ContainerEngine;
  language: LanguageSetting;
  extensionVersion?: string;
  resolvedLanguage?: SupportedLocale;
  vscodeLanguage?: string;
  dockerPath: string;
  podmanPath: string;
  composePath: string;
  composeCommandStyle: 'auto' | 'plugin' | 'standalone' | 'custom';
  inPod: 'default' | 'true' | 'false';
  machineName: string;
  pollingInterval: number;
  logBufferSize: number;
  autoDetectFiles: boolean;
  confirmDeletions: boolean;
  logsOutput: 'studio' | 'outputChannel' | 'terminal';
  enablePushCommand: boolean;
  pushDefaultRegistry: string;
  registryProvider: 'dockerhub' | 'quay' | 'ghcr' | 'acr' | 'ecr' | 'custom';
  registryUrl: string;
  registryAuthType: 'engineCli' | 'basic' | 'bearer';
  registryUsername: string;
  registryAutoLogin: boolean;
  hasRegistrySecret?: boolean;
}

export type PageId =
  | 'dashboard'
  | 'compose'
  | 'containers'
  | 'images'
  | 'volumes'
  | 'networks'
  | 'tools'
  | 'settings';

export interface BannerToast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface StudioState {
  activePage: PageId;
  setActivePage: (page: PageId) => void;

  // Engine & Language state
  engine: ContainerEngine;
  setEnginePreference: (engine: ContainerEngine) => void;
  languageSetting: LanguageSetting;
  resolvedLocale: SupportedLocale;
  vscodeLanguage: string;
  setLanguagePreference: (setting: LanguageSetting, vscodeLang?: string) => void;

  // Compose state
  document: ComposeDocument | null;
  activeFile: string | null;
  rawYaml: string;
  composeFiles: string[];
  composeContainers: ComposeContainerStatus[];
  selectedDirectory: string | null;
  imageResults: ImageSearchResult[];
  imageSearchError: string | null;
  operationInProgress: string | null;
  operationsInProgress: Record<string, number>;
  operationLabels: Record<string, string>;
  operationTokens: Record<string, { key: string; label: string }>;

  // Engine resources
  systemInfo: PodmanSystemInfo | null;
  diskUsage: PodmanDiskUsageItem[];
  dockerContexts: DockerContextItem[];
  machines: PodmanMachine[];
  pods: PodmanPod[];
  allContainers: PodmanContainer[];
  images: PodmanImage[];
  networks: PodmanNetwork[];
  volumes: PodmanVolume[];
  dockerfileSelection: { dockerfile: string; contextDir: string } | null;

  // Logs
  activeLogTarget: string | null;
  logEntries: LogEntry[];
  logFilter: string;

  // Settings
  settings: StudioSettings | null;
  settingsTestResult: { ok: boolean; message: string } | null;

  // Banner/Notifications
  banner: BannerToast | null;

  // Setters
  setComposeUpdate: (
    doc: ComposeDocument | null,
    activeFile: string | null,
    rawYaml: string
  ) => void;
  setComposeFiles: (files: string[]) => void;
  setComposeContainers: (containers: ComposeContainerStatus[]) => void;
  setSelectedDirectory: (dir: string | null) => void;
  setImageResults: (results: ImageSearchResult[]) => void;
  setImageSearchError: (message: string | null) => void;
  beginOperation: (op: string, label?: string, id?: string) => void;
  endOperation: (op: string, id?: string) => void;
  setSystemInfo: (info: PodmanSystemInfo | null) => void;
  setDiskUsage: (items: PodmanDiskUsageItem[]) => void;
  setDockerContexts: (contexts: DockerContextItem[]) => void;
  setMachines: (machines: PodmanMachine[]) => void;
  setPods: (pods: PodmanPod[]) => void;
  setAllContainers: (containers: PodmanContainer[]) => void;
  setImages: (images: PodmanImage[]) => void;
  setNetworks: (networks: PodmanNetwork[]) => void;
  setVolumes: (volumes: PodmanVolume[]) => void;
  setDockerfileSelection: (sel: { dockerfile: string; contextDir: string } | null) => void;
  setActiveLogTarget: (target: string | null) => void;
  setLogHistory: (entries: LogEntry[]) => void;
  appendLogLine: (entry: LogEntry) => void;
  clearLogs: () => void;
  setLogFilter: (filter: string) => void;
  setSettings: (settings: StudioSettings) => void;
  setSettingsTestResult: (res: { ok: boolean; message: string } | null) => void;
  showBanner: (type: 'success' | 'error' | 'info', message: string) => void;
  dismissBanner: () => void;
}

function emptyEngineResources() {
  return {
    systemInfo: null,
    diskUsage: [],
    dockerContexts: [],
    machines: [],
    pods: [],
    allContainers: [],
    images: [],
    networks: [],
    volumes: [],
    composeContainers: [],
  };
}

export const useStudioStore = create<StudioState>((set) => ({
  activePage: 'compose',
  setActivePage: (activePage) => set({ activePage }),

  engine: 'docker',
  setEnginePreference: (engine) =>
    set((state) => ({
      engine,
      settings: state.settings ? { ...state.settings, engine } : state.settings,
      ...(state.engine !== engine ? emptyEngineResources() : {}),
    })),

  languageSetting: 'auto',
  resolvedLocale: normalizeLocaleCode(),
  vscodeLanguage: navigator.language || 'en',
  setLanguagePreference: (languageSetting, vscodeLang) =>
    set((state) => {
      const hostLang = vscodeLang || state.vscodeLanguage || 'en';
      const resolvedLocale: SupportedLocale =
        languageSetting === 'auto' ? normalizeLocaleCode(hostLang) : languageSetting;
      return {
        languageSetting,
        resolvedLocale,
        vscodeLanguage: hostLang,
        settings: state.settings
          ? { ...state.settings, language: languageSetting }
          : state.settings,
      };
    }),

  document: null,
  activeFile: null,
  rawYaml: '',
  composeFiles: [],
  composeContainers: [],
  selectedDirectory: null,
  imageResults: [],
  imageSearchError: null,
  operationInProgress: null,
  operationsInProgress: {},
  operationLabels: {},
  operationTokens: {},

  systemInfo: null,
  diskUsage: [],
  dockerContexts: [],
  machines: [],
  pods: [],
  allContainers: [],
  images: [],
  networks: [],
  volumes: [],
  dockerfileSelection: null,

  activeLogTarget: null,
  logEntries: [],
  logFilter: '',

  settings: null,
  settingsTestResult: null,
  banner: null,

  setComposeUpdate: (document, activeFile, rawYaml) => set({ document, activeFile, rawYaml }),
  setComposeFiles: (composeFiles) => set({ composeFiles }),
  setComposeContainers: (composeContainers) => set({ composeContainers }),
  setSelectedDirectory: (selectedDirectory) => set({ selectedDirectory }),
  setImageResults: (imageResults) => set({ imageResults }),
  setImageSearchError: (imageSearchError) => set({ imageSearchError }),
  beginOperation: (op, label, id) =>
    set((state) => {
      if (id && state.operationTokens[id]) {
        return state;
      }
      return {
        operationsInProgress: {
          ...state.operationsInProgress,
          [op]: (state.operationsInProgress[op] || 0) + 1,
        },
        operationLabels: { ...state.operationLabels, [op]: label || op },
        operationTokens: id
          ? { ...state.operationTokens, [id]: { key: op, label: label || op } }
          : state.operationTokens,
        operationInProgress: state.operationInProgress || op,
      };
    }),
  endOperation: (op, id) =>
    set((state) => {
      if (id && state.operationTokens[id]?.key !== op) {
        return state;
      }
      const operationsInProgress = { ...state.operationsInProgress };
      const operationLabels = { ...state.operationLabels };
      const operationTokens = { ...state.operationTokens };
      if (id) {
        delete operationTokens[id];
      }
      if ((operationsInProgress[op] || 0) > 1) {
        operationsInProgress[op]--;
        const remaining = Object.values(operationTokens).find((token) => token.key === op);
        if (remaining) {
          operationLabels[op] = remaining.label;
        }
      } else {
        delete operationsInProgress[op];
        delete operationLabels[op];
      }
      return {
        operationsInProgress,
        operationLabels,
        operationTokens,
        operationInProgress: Object.keys(operationsInProgress)[0] || null,
      };
    }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setDiskUsage: (diskUsage) => set({ diskUsage }),
  setDockerContexts: (dockerContexts) => set({ dockerContexts }),
  setMachines: (machines) => set({ machines }),
  setPods: (pods) => set({ pods }),
  setAllContainers: (allContainers) => set({ allContainers }),
  setImages: (images) => set({ images }),
  setNetworks: (networks) => set({ networks }),
  setVolumes: (volumes) => set({ volumes }),
  setDockerfileSelection: (dockerfileSelection) => set({ dockerfileSelection }),
  setActiveLogTarget: (activeLogTarget) => set({ activeLogTarget }),
  setLogHistory: (logEntries) => set({ logEntries }),
  appendLogLine: (entry) =>
    set((state) => ({
      logEntries: [...state.logEntries.slice(-1999), entry],
    })),
  clearLogs: () => set({ logEntries: [] }),
  setLogFilter: (logFilter) => set({ logFilter }),
  setSettings: (settings) =>
    set((state) => {
      const langSetting = settings.language || 'auto';
      const hostLang = settings.vscodeLanguage || state.vscodeLanguage || 'en';
      const resolvedLocale: SupportedLocale =
        settings.resolvedLanguage ||
        (langSetting === 'auto' ? normalizeLocaleCode(hostLang) : langSetting);
      const nextEngine: ContainerEngine = settings.engine === 'podman' ? 'podman' : 'docker';
      return {
        settings: { ...settings, engine: nextEngine },
        engine: nextEngine,
        languageSetting: langSetting,
        vscodeLanguage: hostLang,
        resolvedLocale,
        ...(state.engine !== nextEngine ? emptyEngineResources() : {}),
      };
    }),
  setSettingsTestResult: (settingsTestResult) => set({ settingsTestResult }),
  showBanner: (type, message) =>
    set((state) =>
      state.banner?.type === 'error' && type !== 'error'
        ? state
        : { banner: { id: Date.now(), type, message } }
    ),
  dismissBanner: () => set({ banner: null }),
}));

export function useStudioMessageBridge(): void {
  const { postMessage, onMessage } = useVsCodeMessaging();
  const store = useStudioStore();

  useEffect(() => {
    const gate = createEngineMessageGate();
    const handleMessage = (msg: StudioMessage) => {
      const current = useStudioStore.getState();
      if (!gate.shouldHandle(msg, current.engine, Boolean(current.settings))) {
        return;
      }
      const p = msg.payload;
      switch (msg.command) {
        case 'compose:update':
          store.setComposeUpdate(p?.document ?? null, p?.activeFile ?? null, p?.rawYaml ?? '');
          break;
        case 'compose:files:update':
          store.setComposeFiles(Array.isArray(p) ? p : []);
          break;
        case 'containers:update':
          store.setComposeContainers(Array.isArray(p) ? p : []);
          break;
        case 'compose:directory:selected':
          if (p?.directory) {
            store.setSelectedDirectory(String(p.directory));
          }
          break;
        case 'compose:image:results':
          store.setImageResults(Array.isArray(p?.results) ? p.results : []);
          store.setImageSearchError(typeof p?.error === 'string' ? p.error : null);
          break;
        case 'operation:start':
          if (p && typeof p === 'object' && typeof p.key === 'string') {
            store.beginOperation(p.key, typeof p.label === 'string' ? p.label : undefined,
              typeof p.id === 'string' ? p.id : undefined);
          } else {
            store.beginOperation(String(p || 'busy'));
          }
          break;
        case 'operation:end':
          if (p && typeof p === 'object' && typeof p.key === 'string') {
            store.endOperation(p.key, typeof p.id === 'string' ? p.id : undefined);
          } else {
            store.endOperation(String(p || 'busy'));
          }
          break;
        case 'notification':
          if (p?.message) {
            store.showBanner(p.type || 'success', String(p.message));
          }
          break;
        case 'error':
          if (p?.message) {
            store.showBanner('error', String(p.message));
          }
          break;
        case 'system:info:update':
          store.setSystemInfo(p ?? null);
          break;
        case 'system:df:update':
          store.setDiskUsage(Array.isArray(p) ? p : []);
          break;
        case 'contexts:update':
          store.setDockerContexts(Array.isArray(p) ? p : []);
          break;
        case 'machines:update':
          store.setMachines(Array.isArray(p) ? p : []);
          break;
        case 'pods:update':
          store.setPods(Array.isArray(p) ? p : []);
          break;
        case 'all:containers:update':
          store.setAllContainers(Array.isArray(p) ? p : []);
          break;
        case 'images:update':
          store.setImages(Array.isArray(p) ? p : []);
          break;
        case 'networks:update':
          store.setNetworks(Array.isArray(p) ? p : []);
          break;
        case 'volumes:update':
          store.setVolumes(Array.isArray(p) ? p : []);
          break;
        case 'image:dockerfile:selected':
          if (p?.dockerfile) {
            store.setDockerfileSelection({
              dockerfile: String(p.dockerfile),
              contextDir: String(p.contextDir || '.'),
            });
          }
          break;
        case 'log:history':
          if (Array.isArray(p)) {
            store.setLogHistory(p);
          } else if (Array.isArray(p?.entries)) {
            store.setLogHistory(p.entries);
          }
          break;
        case 'log:line':
          if (p) {
            store.appendLogLine(p);
          }
          break;
        case 'settings:update':
          if (p) {
            store.setSettings(p);
            for (const queued of gate.drain(useStudioStore.getState().engine)) {
              handleMessage(queued);
            }
          }
          break;
        case 'settings:test:result':
          if (p) {
            store.setSettingsTestResult({
              ok: Boolean(p.ok),
              message: String(p.message || ''),
            });
          }
          break;
      }
    };
    const unsubscribe = onMessage(handleMessage);

    postMessage('dashboard:get');
    postMessage('settings:get');

    return unsubscribe;
  }, [onMessage, postMessage]);
}
