import { useEffect } from 'react';
import { create } from 'zustand';
import {
  appendOutputTail,
  OperationSnapshot,
} from '../../src/shared/operationFeedback';
import { FailurePresentation } from '../../src/shared/failureMessages';
import type { OperationLabel } from './operationLabels';
import { ComposeDraft, ComposeServiceDraft, syncComposeDraft } from './composeDrafts';
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
  state?: ServiceStatus;
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
  health?: string;
  exitCode?: number;
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

export interface ComposeProjectOptions {
  files: string[];
  profiles: string[];
  envFile?: string;
}

interface ComposeProjectState {
  options: ComposeProjectOptions | null;
  revision: string | null;
  error: string | null;
  resolving: boolean;
  customized: boolean;
  dependenciesIncomplete: boolean;
}

interface PendingComposeEdit {
  file: string;
  kind: 'service' | 'builder' | 'raw';
  name: string;
  base: string;
  snapshot?: string;
}

export interface LogEntry {
  service: string;
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  target?: string;
  sourceTimestamp?: boolean;
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
  longOperationTimeoutMinutes: number;
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
  engine?: ContainerEngine;
  details?: string;
  scope?: string;
  failure?: FailurePresentation;
  operation?: OperationLabel;
}

export interface StudioOperation {
  id: string;
  key: string;
  label: string;
  labelLocale?: SupportedLocale;
  startedAt: number;
  output: string;
  outputTruncated: boolean;
  lastOutputAt?: number;
  completed?: number;
  total?: number;
  current?: string;
}

function operationFromSnapshot(snapshot: OperationSnapshot): StudioOperation {
  const now = Date.now();
  return {
    ...snapshot,
    startedAt: now - Math.max(0, snapshot.elapsedMs || 0),
    lastOutputAt: snapshot.lastOutputElapsedMs === undefined
      ? undefined
      : now - Math.max(0, snapshot.lastOutputElapsedMs),
  };
}

let nextBannerId = 0;

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
  composeParseError: string | null;
  composeProject: ComposeProjectState;
  serviceFragments: Record<string, string>;
  composeDrafts: Record<string, ComposeDraft>;
  composeServiceDrafts: Record<string, ComposeServiceDraft>;
  pendingComposeEdits: Record<string, PendingComposeEdit>;
  composeFiles: string[];
  composeContainers: ComposeContainerStatus[];
  selectedDirectory: string | null;
  imageResults: ImageSearchResult[];
  imageSearchError: string | null;
  imageSearchFailure: FailurePresentation | null;
  operationInProgress: string | null;
  operationsInProgress: Record<string, number>;
  operationLabels: Record<string, string>;
  operationTokens: Record<string, StudioOperation>;

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
  settingsTestResult: { ok: boolean; message: string; failure?: FailurePresentation } | null;

  // Banner/Notifications
  banners: BannerToast[];
  pausedBanners: Record<number, number>;

  // Setters
  setComposeUpdate: (
    doc: ComposeDocument | null,
    activeFile: string | null,
    rawYaml: string,
    parseError: string | null,
    serviceFragments: Record<string, string>,
    project?: ComposeProjectState
  ) => void;
  setComposeDraft: (file: string, draft: ComposeDraft) => void;
  setComposeServiceDraft: (file: string, draft: ComposeServiceDraft | null) => void;
  beginComposeEdit: (requestId: string, edit: PendingComposeEdit) => void;
  finishComposeEdit: (requestId: string, savedFile?: string) => void;
  setComposeFiles: (files: string[]) => void;
  setComposeContainers: (containers: ComposeContainerStatus[]) => void;
  setSelectedDirectory: (dir: string | null) => void;
  setImageResults: (results: ImageSearchResult[]) => void;
  setImageSearchError: (message: string | null, failure?: FailurePresentation) => void;
  beginOperation: (op: string, label?: string, id?: string, snapshot?: OperationSnapshot) => void;
  endOperation: (op: string, id?: string) => void;
  setOperationSnapshot: (operations: OperationSnapshot[]) => void;
  appendOperationOutput: (id: string, text: string, truncated?: boolean) => void;
  setOperationStep: (id: string, completed: number, total: number, current?: string) => void;
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
  setSettingsTestResult: (res: { ok: boolean; message: string; failure?: FailurePresentation } | null) => void;
  showBanner: (type: 'success' | 'error' | 'info', message: string, details?: string, scope?: string, failure?: FailurePresentation, operation?: OperationLabel, engine?: ContainerEngine) => void;
  dismissBanner: (id?: number) => void;
  resolveBannerScope: (scope: string) => void;
  pauseBanner: (id: number) => void;
  resumeBanner: (id: number) => void;
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

function resetEngineContext(state: StudioState) {
  const banners = state.banners.filter((banner) => !banner.engine);
  const retained = new Set(banners.map((banner) => banner.id));
  const pausedBanners = Object.fromEntries(
    Object.entries(state.pausedBanners).filter(([id]) => retained.has(Number(id)))
  );
  return {
    ...emptyEngineResources(),
    banners,
    pausedBanners,
    settingsTestResult: null,
    imageResults: [],
    imageSearchError: null,
    imageSearchFailure: null,
    composeProject: {
      ...state.composeProject,
      revision: null,
      error: null,
      resolving: Boolean(state.activeFile),
      dependenciesIncomplete: false,
    },
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
      ...(state.engine !== engine ? resetEngineContext(state) : {}),
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
  composeParseError: null,
  composeProject: { options: null, revision: null, error: null, resolving: false, customized: false, dependenciesIncomplete: false },
  serviceFragments: {},
  composeDrafts: {},
  composeServiceDrafts: {},
  pendingComposeEdits: {},
  composeFiles: [],
  composeContainers: [],
  selectedDirectory: null,
  imageResults: [],
  imageSearchError: null,
  imageSearchFailure: null,
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
  banners: [],
  pausedBanners: {},

  setComposeUpdate: (document, activeFile, rawYaml, composeParseError, serviceFragments, project) =>
    set((state) => ({
      document, activeFile, rawYaml, composeParseError, serviceFragments,
      composeProject: project ?? { options: null, revision: null, error: null, resolving: false, customized: false, dependenciesIncomplete: false },
      composeDrafts: activeFile
        ? { ...state.composeDrafts, [activeFile]: syncComposeDraft(state.composeDrafts[activeFile], rawYaml) }
        : state.composeDrafts,
    })),
  setComposeDraft: (file, draft) =>
    set((state) => ({ composeDrafts: { ...state.composeDrafts, [file]: draft } })),
  setComposeServiceDraft: (file, draft) =>
    set((state) => {
      const composeServiceDrafts = { ...state.composeServiceDrafts };
      if (draft) composeServiceDrafts[file] = draft;
      else delete composeServiceDrafts[file];
      return { composeServiceDrafts };
    }),
  beginComposeEdit: (requestId, edit) =>
    set((state) => ({ pendingComposeEdits: { ...state.pendingComposeEdits, [requestId]: edit } })),
  finishComposeEdit: (requestId, savedFile) =>
    set((state) => {
      const pending = state.pendingComposeEdits[requestId];
      if (!pending) return state;
      const pendingComposeEdits = { ...state.pendingComposeEdits };
      delete pendingComposeEdits[requestId];
      const composeServiceDrafts = { ...state.composeServiceDrafts };
      const draft = composeServiceDrafts[pending.file];
      if (savedFile === pending.file && pending.kind === 'service' && draft &&
          draft.name === pending.name && draft.base === pending.base &&
          JSON.stringify(draft) === pending.snapshot) {
        delete composeServiceDrafts[pending.file];
      }
      return { pendingComposeEdits, composeServiceDrafts };
    }),
  setComposeFiles: (composeFiles) => set({ composeFiles }),
  setComposeContainers: (composeContainers) => set({ composeContainers }),
  setSelectedDirectory: (selectedDirectory) => set({ selectedDirectory }),
  setImageResults: (imageResults) => set({ imageResults }),
  setImageSearchError: (imageSearchError, failure) => set({ imageSearchError, imageSearchFailure: failure || null }),
  beginOperation: (op, label, id, snapshot) =>
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
          ? {
              ...state.operationTokens,
              [id]: snapshot ? operationFromSnapshot(snapshot) : {
                id, key: op, label: label || op, startedAt: Date.now(),
                output: '', outputTruncated: false,
              },
            }
          : state.operationTokens,
        operationInProgress: state.operationInProgress || op,
      };
    }),
  setOperationSnapshot: (operations) =>
    set(() => {
      const operationsInProgress: Record<string, number> = {};
      const operationLabels: Record<string, string> = {};
      const operationTokens: Record<string, StudioOperation> = {};
      for (const snapshot of operations) {
        const operation = operationFromSnapshot(snapshot);
        operationTokens[operation.id] = operation;
        operationsInProgress[operation.key] = (operationsInProgress[operation.key] || 0) + 1;
        operationLabels[operation.key] = operation.label;
      }
      return {
        operationsInProgress, operationLabels, operationTokens,
        operationInProgress: Object.keys(operationsInProgress)[0] || null,
      };
    }),
  appendOperationOutput: (id, text, truncated) =>
    set((state) => {
      const operation = state.operationTokens[id];
      if (!operation) return state;
      const tail = appendOutputTail(operation.output, text);
      return {
        operationTokens: {
          ...state.operationTokens,
          [id]: {
            ...operation, output: tail.text, lastOutputAt: Date.now(),
            outputTruncated: operation.outputTruncated || tail.truncated || Boolean(truncated),
          },
        },
      };
    }),
  setOperationStep: (id, completed, total, current) =>
    set((state) => {
      const operation = state.operationTokens[id];
      if (!operation || total < 1 || completed < 0 || completed > total) return state;
      return {
        operationTokens: {
          ...state.operationTokens,
          [id]: { ...operation, completed, total, current },
        },
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
      logEntries: [...state.logEntries, entry].slice(-Math.max(1, state.settings?.logBufferSize || 5000)),
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
      const previousPath = state.settings &&
        (state.engine === 'podman' ? state.settings.podmanPath : state.settings.dockerPath);
      const nextPath = nextEngine === 'podman' ? settings.podmanPath : settings.dockerPath;
      const contextChanged = state.engine !== nextEngine ||
        (previousPath !== null && previousPath !== undefined && previousPath !== nextPath);
      return {
        settings: { ...settings, engine: nextEngine },
        engine: nextEngine,
        languageSetting: langSetting,
        vscodeLanguage: hostLang,
        resolvedLocale,
        ...(contextChanged ? resetEngineContext(state) : {}),
      };
    }),
  setSettingsTestResult: (settingsTestResult) => set({ settingsTestResult }),
  showBanner: (type, message, details, scope, failure, operation, engine) =>
    set((state) => {
      if (type === 'error' && scope) {
        const existing = state.banners.find((banner) =>
          banner.type === 'error' && banner.scope === scope && banner.engine === engine);
        if (existing) {
          if (existing.message === message && existing.details === details &&
              JSON.stringify(existing.failure) === JSON.stringify(failure)) return state;
          return {
            banners: state.banners.map((banner) =>
              banner.id === existing.id ? { ...banner, message, details, failure } : banner),
          };
        }
      }
      if (type === 'error' && state.banners.some((banner) =>
        banner.type === type && banner.scope === scope && banner.engine === engine &&
        banner.message === message && banner.details === details &&
        JSON.stringify(banner.failure) === JSON.stringify(failure))) {
        return state;
      }
      return { banners: [...state.banners, { id: ++nextBannerId, type, message, engine, details, scope, failure, operation }] };
    }),
  dismissBanner: (id) =>
    set((state) => {
      const pausedBanners = { ...state.pausedBanners };
      if (id === undefined) return { banners: [], pausedBanners: {} };
      delete pausedBanners[id];
      return { banners: state.banners.filter((banner) => banner.id !== id), pausedBanners };
    }),
  resolveBannerScope: (scope) =>
    set((state) => {
      const resolved = state.banners.filter((banner) => banner.type === 'error' && banner.scope === scope);
      if (resolved.length === 0) return state;
      const ids = new Set(resolved.map((banner) => banner.id));
      const pausedBanners = { ...state.pausedBanners };
      for (const id of ids) delete pausedBanners[id];
      return { banners: state.banners.filter((banner) => !ids.has(banner.id)), pausedBanners };
    }),
  pauseBanner: (id) =>
    set((state) => state.banners.some((banner) => banner.id === id)
      ? { pausedBanners: { ...state.pausedBanners, [id]: (state.pausedBanners[id] || 0) + 1 } }
      : state),
  resumeBanner: (id) =>
    set((state) => {
      if (!state.pausedBanners[id]) return state;
      const pausedBanners = { ...state.pausedBanners };
      if (pausedBanners[id] > 1) pausedBanners[id]--;
      else delete pausedBanners[id];
      return { pausedBanners };
    }),
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
          store.setComposeUpdate(
            p?.document ?? null, p?.activeFile ?? null, p?.rawYaml ?? '',
            typeof p?.parseError === 'string' ? p.parseError : null,
            p?.serviceFragments && typeof p.serviceFragments === 'object' ? p.serviceFragments : {},
            {
              options: p?.projectOptions ?? null,
              revision: typeof p?.projectRevision === 'string' ? p.projectRevision : null,
              error: typeof p?.projectError === 'string' ? p.projectError : null,
              resolving: p?.projectResolving === true,
              customized: p?.projectCustomized === true,
              dependenciesIncomplete: p?.dependenciesIncomplete === true,
            }
          );
          break;
        case 'compose:files:update':
          store.setComposeFiles(Array.isArray(p) ? p : []);
          break;
        case 'compose:edit:saved':
          if (msg.requestId) store.finishComposeEdit(msg.requestId, typeof p?.file === 'string' ? p.file : undefined);
          break;
        case 'compose:edit:failed':
          if (msg.requestId) store.finishComposeEdit(msg.requestId);
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
          store.setImageSearchError(typeof p?.error === 'string' ? p.error : null, p?.failure);
          break;
        case 'operation:start':
          if (p && typeof p === 'object' && typeof p.key === 'string') {
            store.beginOperation(p.key, typeof p.label === 'string' ? p.label : undefined,
              typeof p.id === 'string' ? p.id : undefined, p as OperationSnapshot);
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
        case 'operation:snapshot':
          if (Array.isArray(p)) {
            store.setOperationSnapshot(p.filter((operation): operation is OperationSnapshot =>
              operation && typeof operation.id === 'string' && typeof operation.key === 'string' &&
              typeof operation.label === 'string' && typeof operation.output === 'string'
            ));
          }
          break;
        case 'operation:output':
          if (typeof p?.id === 'string' && typeof p?.text === 'string') {
            store.appendOperationOutput(p.id, p.text, p.outputTruncated === true);
          }
          break;
        case 'operation:step':
          if (typeof p?.id === 'string' && Number.isInteger(p?.completed) &&
              Number.isInteger(p?.total)) {
            store.setOperationStep(p.id, p.completed, p.total,
              typeof p.current === 'string' ? p.current : undefined);
          }
          break;
        case 'notification':
          if (p?.message) {
            store.showBanner(p.type || 'success', String(p.message),
              typeof p.details === 'string' ? p.details : undefined, undefined, undefined, p.operation, msg.engine);
          }
          break;
        case 'error':
          if (p?.message) {
            store.showBanner('error', String(p.message),
              typeof p.details === 'string' ? p.details : undefined,
              typeof p.scope === 'string' ? p.scope : undefined, p.failure, undefined, msg.engine);
          }
          break;
        case 'error:resolved':
          if (typeof p?.scope === 'string') store.resolveBannerScope(p.scope);
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
          if (Array.isArray(p) && !useStudioStore.getState().activeLogTarget) {
            store.setLogHistory(p);
          } else if (Array.isArray(p?.entries) &&
              (!p.target || p.target === useStudioStore.getState().activeLogTarget)) {
            store.setLogHistory(p.entries);
          }
          break;
        case 'log:line':
          if (p && (!p.target || p.target === useStudioStore.getState().activeLogTarget)) {
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
              failure: p.failure,
            });
          }
          break;
      }
    };
    const unsubscribe = onMessage(handleMessage);

    postMessage('settings:get');
    postMessage('operations:get');
    postMessage('dashboard:get', { reuseInFlight: true });

    return unsubscribe;
  }, [onMessage, postMessage]);
}
