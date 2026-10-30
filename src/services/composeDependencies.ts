import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { ComposeProjectOptions } from '../types';

interface DependencyFile {
  path: string;
  required: boolean;
}

export interface ComposeDependencies {
  files: DependencyFile[];
  requiresResolution: boolean;
  incomplete: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function keyFor(file: string): string {
  const normalized = path.normalize(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function collectComposeDependencies(options: ComposeProjectOptions): ComposeDependencies {
  const files = new Map<string, DependencyFile>();
  const queue: Array<{ file: string; projectDir: string }> = [];
  const seen = new Set<string>();
  let requiresResolution = false;
  let incomplete = false;

  const add = (file: string, required = false) => {
    const absolute = path.resolve(file);
    const key = keyFor(absolute);
    const previous = files.get(key);
    if (previous) previous.required ||= required;
    else files.set(key, { path: absolute, required });
    return absolute;
  };
  const localPath = (value: unknown, base: string): string | undefined => {
    if (typeof value !== 'string' || !value || /[$\0]/.test(value) ||
        value.startsWith('~') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
        value.startsWith('git@')) {
      incomplete = true;
      return undefined;
    }
    return path.resolve(base, value);
  };
  const addReferences = (value: unknown, base: string) => {
    if (value === undefined || value === null) return;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const candidate = record(entry);
      const target = localPath(candidate ? candidate.path : entry, base);
      if (target) add(target);
    }
  };
  const enqueue = (file: string, projectDir: string) => {
    const target = add(file);
    const key = `${keyFor(target)}\0${keyFor(projectDir)}`;
    if (!seen.has(key)) {
      seen.add(key);
      queue.push({ file: target, projectDir });
    }
  };

  const baseDir = path.dirname(options.files[0]);
  for (const file of options.files) {
    add(file, true);
    enqueue(file, baseDir);
  }
  add(path.join(baseDir, '.env'));
  if (options.envFile) add(options.envFile, true);

  for (let index = 0; index < queue.length; index++) {
    if (queue.length > 1024) throw new Error('The Compose project references too many configuration files.');
    const { file, projectDir } = queue[index];
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const doc = YAML.parseDocument(text, { merge: true, uniqueKeys: true });
    if (doc.errors.length) {
      incomplete = true;
      continue;
    }
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = record(doc.toJS());
    } catch {
      incomplete = true;
      continue;
    }
    if (!parsed) continue;

    if (parsed.include !== undefined) {
      requiresResolution = true;
      for (const item of Array.isArray(parsed.include) ? parsed.include : [parsed.include]) {
        const definition = record(item);
        const paths = definition ? definition.path : item;
        const items = Array.isArray(paths) ? paths : [paths];
        const targets = items.map((value) => localPath(value, projectDir));
        targets.forEach((target) => { if (target) add(target); });
        const includedDir = definition?.project_directory === undefined
          ? targets[0] && path.dirname(targets[0])
          : localPath(definition.project_directory, projectDir);
        if (!includedDir) {
          incomplete = true;
          continue;
        }
        add(path.join(includedDir, '.env'));
        if (definition) addReferences(definition.env_file, includedDir);
        targets.forEach((target) => { if (target) enqueue(target, includedDir); });
      }
    }

    const services = record(parsed.services);
    if (services) {
      for (const value of Object.values(services)) {
        const service = record(value);
        if (!service) continue;
        addReferences(service.env_file, projectDir);
        addReferences(service.label_file, projectDir);
        if (service.extends !== undefined) {
          requiresResolution = true;
          const extension = record(service.extends);
          if (extension?.file !== undefined) {
            const target = localPath(extension.file, projectDir);
            if (target) enqueue(target, projectDir);
          }
        }
      }
    }
    for (const section of ['configs', 'secrets']) {
      const resources = record(parsed[section]);
      if (!resources) continue;
      for (const value of Object.values(resources)) {
        const resource = record(value);
        if (resource?.file !== undefined) addReferences(resource.file, projectDir);
      }
    }
  }
  return { files: [...files.values()], requiresResolution, incomplete };
}
