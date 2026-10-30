import { stringify } from 'yaml';
import type { ComposeDocument } from '../types';

export interface ComposeBuilderService {
  name: string;
  containerName: string;
  source: 'image' | 'build';
  image: string;
  buildContext: string;
  buildDockerfile: string;
  ports: string[];
  restartPolicy: string;
  networkName: string;
  volumeName: string;
  volumesText: string;
  environmentText: string;
  dependsText: string;
  commandText: string;
  healthcheck?: {
    test: string;
    interval: string;
    timeout: string;
    retries: string;
    startPeriod: string;
  };
}

export interface ComposeBuilderSpec {
  services: ComposeBuilderService[];
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const CONDITIONS = new Set(['service_started', 'service_healthy', 'service_completed_successfully']);

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function environmentLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function dependencies(text: string): Array<{ name: string; condition?: string }> {
  return text.split(/[\r\n,]+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf(':');
    return separator < 0
      ? { name: line }
      : { name: line.slice(0, separator).trim(), condition: line.slice(separator + 1).trim() };
  });
}

function volumeSource(spec: string): string | undefined {
  if (/^[a-zA-Z]:[\\/]/.test(spec)) return undefined;
  const separator = spec.indexOf(':');
  if (separator <= 0) return undefined;
  const source = spec.slice(0, separator);
  return NAME.test(source) ? source : undefined;
}

export function validateComposeBuilder(
  spec: ComposeBuilderSpec,
  existingServices: Record<string, unknown> = {}
): string[] {
  if (!spec || !Array.isArray(spec.services)) return ['The service list is invalid.'];
  const errors: string[] = [];
  const names = new Set(Object.keys(existingServices));
  const containerNames = new Set<string>();
  for (const value of Object.values(existingServices)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).container_name === 'string') {
      containerNames.add(String((value as Record<string, unknown>).container_name));
    }
  }
  for (const service of spec.services) {
    if (!service || typeof service !== 'object' ||
        typeof service.name !== 'string' || typeof service.containerName !== 'string' ||
        typeof service.image !== 'string' || typeof service.buildContext !== 'string' ||
        typeof service.buildDockerfile !== 'string' || typeof service.restartPolicy !== 'string' ||
        typeof service.networkName !== 'string' || typeof service.volumeName !== 'string' ||
        typeof service.volumesText !== 'string' || typeof service.environmentText !== 'string' ||
        typeof service.dependsText !== 'string' || typeof service.commandText !== 'string' ||
        !Array.isArray(service.ports) || service.ports.some((port) => typeof port !== 'string') ||
        (service.source !== 'image' && service.source !== 'build')) {
      errors.push('A service contains invalid fields.');
      continue;
    }
    const name = service.name.trim();
    if (!NAME.test(name)) errors.push(`Invalid service name: "${name}".`);
    if (names.has(name)) errors.push(`Service "${name}" is duplicated.`);
    names.add(name);
    const containerName = service.containerName.trim();
    if (containerName && !NAME.test(containerName)) {
      errors.push(`Invalid container name: "${containerName}".`);
    }
    if (containerName && containerNames.has(containerName)) {
      errors.push(`Container name "${containerName}" is duplicated.`);
    }
    if (containerName) containerNames.add(containerName);
    if (service.source === 'image' && !service.image.trim()) {
      errors.push(`Service "${name}" requires an image.`);
    }
    if (service.networkName && !NAME.test(service.networkName.trim())) {
      errors.push(`Invalid network name for "${name}".`);
    }
    if (service.volumeName && !NAME.test(service.volumeName.trim())) {
      errors.push(`Invalid volume name for "${name}".`);
    }
    const keys = new Set<string>();
    for (const line of environmentLines(service.environmentText)) {
      const key = line.split('=', 1)[0].trim();
      if (!key || /[\s=]/.test(key) || keys.has(key)) {
        errors.push(`Invalid or duplicate environment key "${key}" in "${name}".`);
      }
      keys.add(key);
    }
    if (service.healthcheck) {
      const healthcheck = service.healthcheck;
      if (typeof healthcheck.test !== 'string' || typeof healthcheck.interval !== 'string' ||
          typeof healthcheck.timeout !== 'string' || typeof healthcheck.retries !== 'string' ||
          typeof healthcheck.startPeriod !== 'string' || !healthcheck.test.trim() ||
          (healthcheck.retries.trim() &&
            (!/^\d+$/.test(healthcheck.retries.trim()) ||
              !Number.isSafeInteger(Number(healthcheck.retries.trim()))))) {
        errors.push(`Invalid healthcheck for "${name}".`);
      }
    }
  }
  if (errors.length > 0) return errors;

  const graph = new Map<string, string[]>();
  for (const [name, value] of Object.entries(existingServices)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const dependency = (value as Record<string, unknown>).depends_on;
    graph.set(name, Array.isArray(dependency)
      ? dependency.filter((entry): entry is string => typeof entry === 'string')
      : dependency && typeof dependency === 'object' ? Object.keys(dependency) : []);
  }
  for (const service of spec.services) {
    const name = service.name.trim();
    const deps = dependencies(service.dependsText);
    const seen = new Set<string>();
    for (const dependency of deps) {
      if (!names.has(dependency.name) || dependency.name === name || seen.has(dependency.name) ||
          (dependency.condition !== undefined && !CONDITIONS.has(dependency.condition))) {
        errors.push(`Invalid dependency "${dependency.name}" in "${name}".`);
      }
      seen.add(dependency.name);
    }
    graph.set(name, deps.map((dependency) => dependency.name));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (name: string): boolean => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    for (const dependency of graph.get(name) || []) {
      if (hasCycle(dependency)) return true;
    }
    visiting.delete(name);
    visited.add(name);
    return false;
  };
  if ([...graph.keys()].some(hasCycle)) errors.push('Service dependencies contain a cycle.');
  return errors;
}

export function buildComposeDocument(
  spec: ComposeBuilderSpec,
  existingServices: Record<string, unknown> = {}
): ComposeDocument {
  const errors = validateComposeBuilder(spec, existingServices);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const networks = new Set<string>();
  const volumes = new Set<string>();
  const services = spec.services.map((service) => {
    const mounts = lines(service.volumesText);
    for (const mount of mounts) {
      const source = volumeSource(mount);
      if (source) volumes.add(source);
    }
    const networkName = service.networkName.trim();
    const volumeName = service.volumeName.trim();
    if (networkName) networks.add(networkName);
    if (volumeName) {
      volumes.add(volumeName);
      mounts.push(`${volumeName}:/data`);
    }
    const env = environmentLines(service.environmentText).map((line) => {
      const separator = line.indexOf('=');
      return separator < 0
        ? [line.trim(), null]
        : [line.slice(0, separator).trim(), line.slice(separator + 1)];
    });
    const deps = dependencies(service.dependsText);
    const health = service.healthcheck;
    return [service.name.trim(), {
      ...(service.source === 'build'
        ? {
            build: {
              context: service.buildContext.trim() || '.',
              dockerfile: service.buildDockerfile.trim() || 'Dockerfile',
            },
            ...(service.image.trim() ? { image: service.image.trim() } : {}),
          }
        : { image: service.image.trim() }),
      ...(service.containerName.trim() ? { container_name: service.containerName.trim() } : {}),
      ...(service.ports.some((port) => port.trim())
        ? { ports: service.ports.map((port) => port.trim()).filter(Boolean) } : {}),
      ...(env.length ? { environment: Object.fromEntries(env) } : {}),
      ...(mounts.length ? { volumes: mounts } : {}),
      ...(networkName ? { networks: [networkName] } : {}),
      ...(deps.length
        ? {
            depends_on: deps.some((dependency) => dependency.condition)
              ? Object.fromEntries(deps.map((dependency) => [
                  dependency.name, { condition: dependency.condition || 'service_started' },
                ]))
              : deps.map((dependency) => dependency.name),
          }
        : {}),
      ...(service.commandText.trim() ? { command: service.commandText.trim() } : {}),
      ...(service.restartPolicy.trim() ? { restart: service.restartPolicy.trim() } : {}),
      ...(health ? {
        healthcheck: {
          test: ['CMD-SHELL', health.test.trim()],
          ...(health.interval.trim() ? { interval: health.interval.trim() } : {}),
          ...(health.timeout.trim() ? { timeout: health.timeout.trim() } : {}),
          ...(health.retries.trim() ? { retries: Number(health.retries.trim()) } : {}),
          ...(health.startPeriod.trim() ? { start_period: health.startPeriod.trim() } : {}),
        },
      } : {}),
    }] as const;
  });
  return {
    services: Object.fromEntries(services),
    ...(networks.size ? { networks: Object.fromEntries([...networks].map((name) => [name, { driver: 'bridge' }])) } : {}),
    ...(volumes.size ? { volumes: Object.fromEntries([...volumes].map((name) => [name, {}])) } : {}),
  };
}

export function serializeComposeBuilder(spec: ComposeBuilderSpec): string {
  return stringify(buildComposeDocument(spec), { lineWidth: 120 });
}
