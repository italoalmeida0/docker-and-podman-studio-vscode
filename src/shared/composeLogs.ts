export function composeLogKey(
  file: string,
  engine: string,
  revision: string,
  service: string,
  containerId?: string
): string {
  return `compose:${JSON.stringify([file, engine, revision, service, containerId || ''])}`;
}

export function composeLogReplicaSignature(
  containers: ReadonlyArray<{ service: string; fullId: string; status: string }>,
  service: string,
  containerId?: string
): string {
  return JSON.stringify(containers
    .filter((container) => container.service === service && container.fullId &&
      (!containerId || container.fullId === containerId))
    .map((container) => [container.fullId, container.status])
    .sort(([left], [right]) => left.localeCompare(right)));
}
