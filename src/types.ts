import { ContainerEngine } from './config';

export type ServiceStatus =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'restarting'
  | 'unhealthy'
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
  composeFile: string;
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
}

export interface PodmanSubnet {
  subnet: string;
  gateway: string;
}

export interface PodmanNetwork {
  id: string;
  name: string;
  driver: string;
  networkInterface: string;
  created: string;
  subnets: PodmanSubnet[];
  dnsEnabled: boolean;
  internal: boolean;
  ipv6Enabled: boolean;
  composeProject: string;
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

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  commandStr?: string;
}

export interface CreatePodOptions {
  name?: string;
  hostname?: string;
  ports?: string[];
  network?: string;
  additionalHosts?: string[];
  cpuShares?: string;
  labels?: string[];
}

export interface CreateContainerOptions {
  image: string;
  name?: string;
  pod?: string;
  ports?: string[];
  volumes?: string[];
  network?: string;
  env?: string[];
  cpus?: string;
  memory?: string;
  mounts?: string[];
  restart?: string;
  command?: string;
}

export const InboundCommand = {
  // Dashboard & System
  DASHBOARD_GET: 'dashboard:get',
  SYSTEM_INFO_GET: 'system:info',
  DISK_USAGE_GET: 'system:df',

  // Docker Contexts & Podman Machine
  DOCKER_CONTEXTS_LIST: 'contexts:list',
  DOCKER_CONTEXT_USE: 'context:use',
  MACHINES_LIST: 'machines:list',
  MACHINE_START: 'machine:start',
  MACHINE_STOP: 'machine:stop',
  MACHINE_RESTART: 'machine:restart',

  // Pods
  PODS_LIST: 'pods:list',
  POD_CREATE: 'pod:create',
  POD_START: 'pod:start',
  POD_STOP: 'pod:stop',
  POD_RESTART: 'pod:restart',
  POD_REMOVE: 'pod:remove',
  POD_LOGS: 'pod:logs',

  // Containers
  CONTAINERS_LIST: 'containers:list',
  CONTAINER_CREATE: 'container:create',
  CONTAINER_START: 'container:start',
  CONTAINER_STOP: 'container:stop',
  CONTAINER_RESTART: 'container:restart',
  CONTAINER_REMOVE: 'container:remove',
  CONTAINER_TERMINAL: 'container:terminal',
  CONTAINER_LOGS: 'container:logs',
  CONTAINER_LOGS_EXTERNAL: 'container:logs:external',

  // Images & Prune
  IMAGES_LIST: 'images:list',
  IMAGE_PULL: 'image:pull',
  IMAGE_BUILD: 'image:build',
  IMAGE_PUSH: 'image:push',
  IMAGE_REMOVE: 'image:remove',
  IMAGE_DOCKERFILE_PICK: 'image:dockerfile:pick',
  PRUNE_IMAGES: 'prune:images',
  PRUNE_ALL_IMAGES: 'prune:all:images',
  PRUNE_BUILDER_CACHE: 'prune:builder',
  PRUNE_VOLUMES: 'prune:volumes',

  // Networks
  NETWORKS_LIST: 'networks:list',
  NETWORK_CREATE: 'network:create',
  NETWORK_REMOVE: 'network:remove',

  // Volumes
  VOLUMES_LIST: 'volumes:list',
  VOLUME_CREATE: 'volume:create',
  VOLUME_REMOVE: 'volume:remove',

  // Compose Stack
  STACK_START: 'stack:start',
  STACK_UP: 'stack:up',
  STACK_STOP: 'stack:stop',
  STACK_DOWN: 'stack:down',
  STACK_RESTART: 'stack:restart',
  STACK_BUILD: 'stack:build',
  STACK_SCALE: 'stack:scale',
  LOGS_START: 'logs:start',
  LOGS_STOP: 'logs:stop',
  SERVICE_ADD: 'service:add',
  SERVICE_UPDATE: 'service:update',
  SERVICE_REMOVE: 'service:remove',
  COMPOSE_RAW_SAVE: 'compose:raw:save',
  COMPOSE_FILE_CREATE: 'compose:file:create',
  COMPOSE_DIRECTORY_PICK: 'compose:directory:pick',
  COMPOSE_IMAGE_SEARCH: 'compose:image:search',
  COMPOSE_NETWORK_ADD: 'compose:network:add',
  COMPOSE_NETWORK_REMOVE: 'compose:network:remove',
  COMPOSE_VOLUME_ADD: 'compose:volume:add',
  COMPOSE_VOLUME_REMOVE: 'compose:volume:remove',
  COMPOSE_GET: 'compose:get',
  STATUS_GET: 'status:get',
  COMPOSE_FILES_LIST: 'compose:files:list',
  COMPOSE_FILE_SELECT: 'compose:file:select',
  COMPOSE_FILE_PICK: 'compose:file:pick',

  // Settings & Links
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_SET_LANGUAGE: 'settings:setLanguage',
  SETTINGS_SET_ENGINE: 'settings:setEngine',
  SETTINGS_TEST: 'settings:test',
  SETTINGS_DISCONNECT: 'settings:disconnect',
  SETTINGS_RESET_PATHS: 'settings:resetPaths',
  OPEN_EXTERNAL: 'external:open',
  OPEN_VSCODE_SETTINGS: 'vscode:settings:open',
} as const;

export const OutboundCommand = {
  CONTAINERS_UPDATE: 'containers:update',
  COMPOSE_UPDATE: 'compose:update',
  LOG_LINE: 'log:line',
  LOG_HISTORY: 'log:history',
  OPERATION_START: 'operation:start',
  OPERATION_END: 'operation:end',
  NOTIFICATION: 'notification',
  ERROR: 'error',
  SYSTEM_INFO_UPDATE: 'system:info:update',
  DISK_USAGE_UPDATE: 'system:df:update',
  DOCKER_CONTEXTS_UPDATE: 'contexts:update',
  MACHINES_UPDATE: 'machines:update',
  PODS_UPDATE: 'pods:update',
  ALL_CONTAINERS_UPDATE: 'all:containers:update',
  IMAGES_UPDATE: 'images:update',
  NETWORKS_UPDATE: 'networks:update',
  VOLUMES_UPDATE: 'volumes:update',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_TEST_RESULT: 'settings:test:result',
  COMPOSE_FILES_UPDATE: 'compose:files:update',
  COMPOSE_DIRECTORY_SELECTED: 'compose:directory:selected',
  COMPOSE_IMAGE_RESULTS: 'compose:image:results',
  DOCKERFILE_SELECTED: 'image:dockerfile:selected',
} as const;
