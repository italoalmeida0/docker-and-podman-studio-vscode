export interface ComposeMount {
  kind: 'volume' | 'bind' | 'anonymous' | 'tmpfs';
  source?: string;
  target: string;
}

export function serviceNetworks(service: Record<string, unknown> | undefined): string[] {
  if (!service || service.network_mode) return [];
  const networks = service.networks;
  if (Array.isArray(networks)) {
    const names = networks.filter((value): value is string => typeof value === 'string');
    return names.length ? names : ['default'];
  }
  if (networks && typeof networks === 'object') {
    const names = Object.keys(networks);
    return names.length ? names : ['default'];
  }
  return ['default'];
}

export function composeMounts(value: unknown): ComposeMount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ComposeMount[] => {
    if (typeof entry === 'string') {
      const windowsPath = /^[a-zA-Z]:[\\/]/.test(entry);
      const separator = entry.indexOf(':', windowsPath ? 2 : 0);
      if (separator < 0) return entry ? [{ kind: 'anonymous', target: entry }] : [];
      const source = entry.slice(0, separator);
      const target = entry.slice(separator + 1).split(':')[0];
      if (!source || !target) return [];
      const isBind = windowsPath || source.startsWith('.') || source.startsWith('/') ||
        source.startsWith('~') || source.includes('\\');
      return [{ kind: isBind ? 'bind' : 'volume', source, target }];
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const mount = entry as Record<string, unknown>;
    const source = typeof mount.source === 'string' ? mount.source : undefined;
    const target = typeof mount.target === 'string' ? mount.target : '';
    if (!target) return [];
    if (mount.type === 'bind') return source ? [{ kind: 'bind', source, target }] : [];
    if (mount.type === 'volume') {
      return [{ kind: source ? 'volume' : 'anonymous', source, target }];
    }
    if (mount.type === 'tmpfs') return [{ kind: 'tmpfs', target }];
    return [];
  });
}

export function composeEnvFiles(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry): string[] => {
    if (typeof entry === 'string') return [entry];
    if (entry && typeof entry === 'object' && !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).path === 'string') {
      return [(entry as { path: string }).path];
    }
    return [];
  });
}
