import { ContainerEngine, PodmanContainer, PodmanPod, ServiceStatus } from './store';
import { isRunningState } from './components/PodmanBatchActions';

export type ContainerFilter = 'all' | 'running' | 'stopped' | 'pod' | 'compose';

export function containerFilterForEngine(
  filter: ContainerFilter,
  engine: ContainerEngine
): ContainerFilter {
  return filter === 'pod' && engine !== 'podman' ? 'all' : filter;
}

export interface ContainerTree {
  filtered: PodmanContainer[];
  podGroups: Array<{ pod: PodmanPod; containers: PodmanContainer[]; status: ServiceStatus }>;
  composeGroups: Array<{ project: string; containers: PodmanContainer[]; status: ServiceStatus }>;
  standalone: PodmanContainer[];
}

const STATUS_PRIORITY: Record<ServiceStatus, number> = {
  running: 0,
  stopped: 1,
  starting: 2,
  stopping: 3,
  paused: 4,
  restarting: 5,
  exited: 6,
  unhealthy: 7,
};

export function mostAttentionStatus(
  states: readonly ServiceStatus[],
  fallback?: ServiceStatus
): ServiceStatus {
  const initial = fallback ?? states[0] ?? 'stopped';
  return states.reduce<ServiceStatus>(
    (worst, state) => STATUS_PRIORITY[state] > STATUS_PRIORITY[worst] ? state : worst,
    initial
  );
}

export function buildContainerTree(
  containers: PodmanContainer[],
  pods: PodmanPod[],
  engine: ContainerEngine,
  filter: ContainerFilter,
  search: string,
  allMembers: PodmanContainer[] = containers
): ContainerTree {
  const query = search.trim().toLowerCase();
  const byPodId = new Map<string, PodmanPod>();
  const byPodName = new Map<string, PodmanPod>();
  if (engine === 'podman') {
    for (const pod of pods) {
      if (pod.id) byPodId.set(pod.id, pod);
      if (pod.fullId) byPodId.set(pod.fullId, pod);
      if (pod.name) byPodName.set(pod.name, pod);
    }
  }
  const findPod = (container: PodmanContainer) =>
    (container.podId && byPodId.get(container.podId)) ||
    (container.podName && byPodName.get(container.podName)) || undefined;
  const podMatches = (pod: PodmanPod) => !query ||
    pod.name.toLowerCase().includes(query) ||
    pod.id.toLowerCase().includes(query) ||
    pod.networks.some((network) => network.toLowerCase().includes(query));
  const matchesState = (state: PodmanContainer['state']) =>
    filter === 'running' ? isRunningState(state) :
      filter === 'stopped' ? !isRunningState(state) && state !== 'paused' : true;

  const filtered = containers.filter((container) => {
    const pod = findPod(container);
    if (!matchesState(container.state)) return false;
    if (filter === 'pod' && !container.podId && !pod) return false;
    if (filter === 'compose' && !container.isCompose) return false;
    return !query ||
      container.name.toLowerCase().includes(query) ||
      container.image.toLowerCase().includes(query) ||
      container.id.toLowerCase().includes(query) ||
      container.podName.toLowerCase().includes(query) ||
      container.composeProject.toLowerCase().includes(query) ||
      Boolean(pod && podMatches(pod));
  });

  const groupedPods = new Map(pods.map((pod) => [pod, [] as PodmanContainer[]]));
  const allPodMembers = new Map(pods.map((pod) => [pod, [] as PodmanContainer[]]));
  const allComposeMembers = new Map<string, PodmanContainer[]>();
  for (const container of allMembers) {
    const pod = findPod(container);
    if (pod) {
      allPodMembers.get(pod)?.push(container);
    } else if (container.isCompose && container.composeProject) {
      const group = allComposeMembers.get(container.composeProject) || [];
      group.push(container);
      allComposeMembers.set(container.composeProject, group);
    }
  }
  const occupiedPods = new Set(containers.map(findPod).filter((pod): pod is PodmanPod => Boolean(pod)));
  const groupedCompose = new Map<string, PodmanContainer[]>();
  const standalone: PodmanContainer[] = [];
  for (const container of filtered) {
    const pod = findPod(container);
    if (pod) {
      groupedPods.get(pod)?.push(container);
    } else if (container.isCompose && container.composeProject) {
      const group = groupedCompose.get(container.composeProject) || [];
      group.push(container);
      groupedCompose.set(container.composeProject, group);
    } else {
      standalone.push(container);
    }
  }
  const podGroups = engine === 'podman'
    ? pods.flatMap((pod) => {
        const members = groupedPods.get(pod) || [];
        const hasVisibleMembers = occupiedPods.has(pod);
        const showEmpty = !hasVisibleMembers && filter !== 'compose' &&
          matchesState(pod.state) && podMatches(pod);
        const all = allPodMembers.get(pod) || [];
        const unmatchedStates = pod.containers?.flatMap((member) =>
          member.state && !all.some((container) => member.id && [container.id, container.fullId].some((id) =>
            id && (id.startsWith(member.id) || member.id.startsWith(id))))
            ? [member.state] : []) || [];
        const status = mostAttentionStatus([...all.map((container) => container.state), ...unmatchedStates], pod.state);
        return members.length || showEmpty ? [{ pod, containers: members, status }] : [];
      })
    : [];
  return {
    filtered,
    podGroups,
    composeGroups: [...groupedCompose].map(([project, members]) => ({
      project,
      containers: members,
      status: mostAttentionStatus((allComposeMembers.get(project) || []).map((container) => container.state), 'running'),
    })),
    standalone,
  };
}
