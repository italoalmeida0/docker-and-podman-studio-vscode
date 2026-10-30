import { ContainerEngine, PodmanContainer, PodmanPod } from './store';
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
  podGroups: Array<{ pod: PodmanPod; containers: PodmanContainer[] }>;
  composeGroups: Array<{ project: string; containers: PodmanContainer[] }>;
  standalone: PodmanContainer[];
}

export function buildContainerTree(
  containers: PodmanContainer[],
  pods: PodmanPod[],
  engine: ContainerEngine,
  filter: ContainerFilter,
  search: string
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
        return members.length || showEmpty ? [{ pod, containers: members }] : [];
      })
    : [];
  return {
    filtered,
    podGroups,
    composeGroups: [...groupedCompose].map(([project, members]) => ({
      project,
      containers: members,
    })),
    standalone,
  };
}
