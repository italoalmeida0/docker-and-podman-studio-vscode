import { ComposeContainerStatus, ServiceStatus } from './store';

const ACTIVE_STATES = new Set<ServiceStatus>([
  'running', 'starting', 'stopping', 'restarting', 'unhealthy', 'paused',
]);
const SINGLE_CONTAINER_ACTIVE_STATES = new Set<ServiceStatus>([
  'running', 'starting', 'stopping', 'restarting', 'unhealthy',
]);

export function parseDesiredReplicas(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const replicas = Number(trimmed);
  return Number.isSafeInteger(replicas) ? replicas : undefined;
}

export function groupComposeContainers(
  containers: ComposeContainerStatus[]
): Map<string, ComposeContainerStatus[]> {
  const grouped = new Map<string, ComposeContainerStatus[]>();
  for (const container of containers) {
    if (container.service) {
      const current = grouped.get(container.service) || [];
      current.push(container);
      grouped.set(container.service, current);
    }
  }
  return grouped;
}

export function summarizeComposeService(
  containers: ComposeContainerStatus[],
  multipleReplicas: boolean
): {
  container?: ComposeContainerStatus;
  terminalContainer?: ComposeContainerStatus;
  status: ServiceStatus;
  active: boolean;
  count: number;
} {
  const last = containers[containers.length - 1];
  if (!multipleReplicas) {
    return {
      container: last,
      terminalContainer: last,
      status: last?.status || 'stopped',
      active: Boolean(last && SINGLE_CONTAINER_ACTIVE_STATES.has(last.status)),
      count: containers.length,
    };
  }

  const active = containers.some((item) => ACTIVE_STATES.has(item.status));
  const terminalContainer = containers.find((item) => item.status === 'running') ||
    containers.find((item) => item.status === 'unhealthy');
  const container = terminalContainer ||
    containers.find((item) => ACTIVE_STATES.has(item.status)) || last;
  const states = new Set(containers.map((item) => item.status));
  let status: ServiceStatus = container?.status || 'stopped';
  if (states.has('unhealthy') ||
      (active && containers.some((item) => !ACTIVE_STATES.has(item.status))) ||
      (states.has('paused') && states.size > 1)) {
    status = 'unhealthy';
  } else if (states.has('restarting')) {
    status = 'restarting';
  } else if (states.has('starting')) {
    status = 'starting';
  } else if (states.has('stopping')) {
    status = 'stopping';
  }
  return { container, terminalContainer, status, active, count: containers.length };
}
