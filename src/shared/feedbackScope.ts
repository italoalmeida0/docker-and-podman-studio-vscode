const TARGET_FIELDS = [
  'action', 'resource', 'name', 'podId', 'containerId', 'imageId', 'imageName',
  'tag', 'networkName', 'volumeName', 'service', 'file',
] as const;

export function feedbackScope(
  engineContext: string,
  command: string,
  activeFile: string | undefined,
  payload: Record<string, unknown>
): string {
  const targets: Record<string, string | string[]> = {};
  for (const field of TARGET_FIELDS) {
    if (typeof payload[field] === 'string') targets[field] = payload[field];
  }
  for (const field of ['ids', 'services'] as const) {
    if (Array.isArray(payload[field])) {
      targets[field] = payload[field].filter((item): item is string => typeof item === 'string').sort();
    }
  }
  if (Array.isArray(payload.targets)) {
    targets.targets = payload.targets.flatMap((target: unknown) => {
      if (!target || typeof target !== 'object') return [];
      const { name, identity } = target as { name?: unknown; identity?: unknown };
      return typeof name === 'string' && typeof identity === 'string'
        ? [JSON.stringify([name, identity])]
        : [];
    }).sort();
  }
  const projectScoped = command.startsWith('stack:') ||
    (command.startsWith('compose:') && command !== 'compose:image:search');
  return JSON.stringify([engineContext, command, projectScoped ? activeFile : undefined, targets]);
}
