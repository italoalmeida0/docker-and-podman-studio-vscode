import * as YAML from 'yaml';
import { ComposeVisualError } from './composeVisualMessages';

export const VISUAL_SERVICE_FIELDS = [
  'image', 'buildContext', 'buildDockerfile', 'restart', 'command',
  'ports', 'volumes', 'environment', 'dependsOn',
] as const;

export type VisualServiceField = typeof VISUAL_SERVICE_FIELDS[number];
export type VisualServiceValues = Record<VisualServiceField, string>;
export type VisualServiceSupport = Record<VisualServiceField, boolean>;

export interface VisualServiceDraft {
  source: string;
  initial: VisualServiceValues;
  values: VisualServiceValues;
  supported: VisualServiceSupport;
}

function documentFor(fragment: string): { doc: YAML.Document; service: YAML.YAMLMap } {
  const doc = YAML.parseDocument(fragment, { uniqueKeys: true });
  if (doc.errors.length) throw new ComposeVisualError('invalidYaml', {}, doc.errors[0].message);
  if (!YAML.isMap(doc.contents)) throw new ComposeVisualError('directMapping');
  return { doc, service: doc.contents };
}

function scalar(map: YAML.YAMLMap, key: string): { value: string; supported: boolean } {
  const node = map.get(key, true);
  if (node === undefined || node === null) return { value: '', supported: true };
  if (!YAML.isScalar(node) || (node.value !== null &&
      typeof node.value !== 'string' && typeof node.value !== 'number' && typeof node.value !== 'boolean')) {
    return { value: '', supported: false };
  }
  const value = node.value === null ? '' : String(node.value);
  return { value, supported: !/[\r\n]/.test(value) };
}

function sequence(map: YAML.YAMLMap, key: string): { value: string; supported: boolean } {
  const node = map.get(key, true);
  if (node === undefined || node === null) return { value: '', supported: true };
  if (!YAML.isSeq(node) || node.items.some((item) =>
    !YAML.isScalar(item) || typeof item.value !== 'string' || /[\r\n]/.test(item.value)
  )) {
    return { value: '', supported: false };
  }
  return { value: node.items.map((item) => String((item as YAML.Scalar).value)).join('\n'), supported: true };
}

function environment(map: YAML.YAMLMap): { value: string; supported: boolean } {
  const node = map.get('environment', true);
  if (node === undefined || node === null) return { value: '', supported: true };
  if (YAML.isSeq(node)) return sequence(map, 'environment');
  if (!YAML.isMap(node)) return { value: '', supported: false };
  const lines: string[] = [];
  for (const pair of node.items) {
    if (!YAML.isScalar(pair.key) || typeof pair.key.value !== 'string' ||
        !YAML.isScalar(pair.value) ||
        (pair.value.value !== null && !['string', 'number', 'boolean'].includes(typeof pair.value.value))) {
      return { value: '', supported: false };
    }
    const key = pair.key.value;
    const value = pair.value.value;
    if (/[\r\n=]/.test(key) || (value !== null && /[\r\n]/.test(String(value)))) {
      return { value: '', supported: false };
    }
    lines.push(value === null ? key : `${key}=${String(value)}`);
  }
  return { value: lines.join('\n'), supported: true };
}

export function createVisualServiceDraft(fragment: string): VisualServiceDraft {
  const { service } = documentFor(fragment);
  const build = service.get('build', true);
  let context = { value: '', supported: true };
  let dockerfile = { value: '', supported: true };
  if (YAML.isScalar(build) && typeof build.value === 'string') {
    context = { value: build.value, supported: !/[\r\n]/.test(build.value) };
  } else if (YAML.isMap(build)) {
    context = scalar(build, 'context');
    if (context.supported && !context.value) context.value = '.';
    dockerfile = scalar(build, 'dockerfile');
  } else if (build !== undefined && build !== null) {
    context.supported = false;
    dockerfile.supported = false;
  }
  const fields: Record<VisualServiceField, { value: string; supported: boolean }> = {
    image: scalar(service, 'image'),
    buildContext: context,
    buildDockerfile: dockerfile,
    restart: scalar(service, 'restart'),
    command: scalar(service, 'command'),
    ports: sequence(service, 'ports'),
    volumes: sequence(service, 'volumes'),
    environment: environment(service),
    dependsOn: sequence(service, 'depends_on'),
  };
  const values = Object.fromEntries(VISUAL_SERVICE_FIELDS.map((field) => [field, fields[field].value])) as VisualServiceValues;
  const supported = Object.fromEntries(VISUAL_SERVICE_FIELDS.map((field) => [field, fields[field].supported])) as VisualServiceSupport;
  return { source: fragment, initial: { ...values }, values, supported };
}

function setScalar(map: YAML.YAMLMap, key: string, value: string): void {
  if (!value) {
    map.delete(key);
    return;
  }
  const existing = map.get(key, true);
  if (YAML.isScalar(existing)) existing.value = value;
  else map.set(key, value);
}

function setSequence(doc: YAML.Document, map: YAML.YAMLMap, key: string, text: string): void {
  const values = text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!values.length) {
    map.delete(key);
    return;
  }
  const existing = map.get(key, true);
  if (!YAML.isSeq(existing)) {
    map.set(key, values);
    return;
  }
  const unused = [...existing.items];
  existing.items = values.map((value) => {
    const index = unused.findIndex((item) => YAML.isScalar(item) && item.value === value);
    return index >= 0 ? unused.splice(index, 1)[0] : doc.createNode(value);
  });
}

function setEnvironment(doc: YAML.Document, service: YAML.YAMLMap, text: string): void {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const entries = lines.map((line) => {
    const separator = line.indexOf('=');
    const key = (separator < 0 ? line : line.slice(0, separator)).trim();
    if (!key || /[\s=]/.test(key)) throw new ComposeVisualError('invalidEnvKey', { key });
    return [key, separator < 0 ? null : line.slice(separator + 1)] as const;
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new ComposeVisualError('duplicateEnvKeys');
  }
  if (!entries.length) {
    service.delete('environment');
    return;
  }
  const existing = service.get('environment', true);
  if (YAML.isMap(existing)) {
    const wanted = new Set(entries.map(([key]) => key));
    for (const pair of [...existing.items]) {
      if (YAML.isScalar(pair.key) && typeof pair.key.value === 'string' && !wanted.has(pair.key.value)) {
        existing.delete(pair.key.value);
      }
    }
    for (const [key, value] of entries) {
      const current = existing.get(key, true);
      if (YAML.isScalar(current)) {
        if ((current.value === null ? null : String(current.value)) !== value) current.value = value;
      } else {
        existing.set(key, value);
      }
    }
  } else {
    setSequence(doc, service, 'environment', lines.join('\n'));
  }
}

export function applyVisualServiceDraft(draft: VisualServiceDraft): string {
  const { doc, service } = documentFor(draft.source);
  const current = createVisualServiceDraft(draft.source);
  for (const field of VISUAL_SERVICE_FIELDS) {
    if (draft.initial[field] !== current.initial[field]) {
      throw new ComposeVisualError('staleDraft');
    }
    if (draft.values[field] !== draft.initial[field] && !current.supported[field]) {
      throw new ComposeVisualError('advancedField', { field });
    }
  }
  for (const field of ['image', 'restart', 'command'] as const) {
    if (draft.values[field] !== draft.initial[field]) setScalar(service, field, draft.values[field].trim());
  }
  for (const [field, key] of [['ports', 'ports'], ['volumes', 'volumes'], ['dependsOn', 'depends_on']] as const) {
    if (draft.values[field] !== draft.initial[field]) {
      if (field === 'dependsOn') {
        const names = draft.values[field].split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
        if (names.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) ||
            new Set(names).size !== names.length) {
          throw new ComposeVisualError('invalidDependencies');
        }
      }
      setSequence(doc, service, key, draft.values[field]);
    }
  }
  if (draft.values.environment !== draft.initial.environment) {
    setEnvironment(doc, service, draft.values.environment);
  }
  if (draft.values.buildContext !== draft.initial.buildContext ||
      draft.values.buildDockerfile !== draft.initial.buildDockerfile) {
    const context = draft.values.buildContext.trim();
    const dockerfile = draft.values.buildDockerfile.trim();
    if (!context && dockerfile) throw new ComposeVisualError('missingBuildContext');
    if (!context) {
      const existing = service.get('build', true);
      if (YAML.isMap(existing) && existing.items.some((pair) =>
        !YAML.isScalar(pair.key) ||
        (pair.key.value !== 'context' && pair.key.value !== 'dockerfile')
      )) {
        throw new ComposeVisualError('advancedBuild');
      }
      service.delete('build');
    } else {
      const existing = service.get('build', true);
      if (YAML.isMap(existing)) {
        setScalar(existing, 'context', context);
        setScalar(existing, 'dockerfile', dockerfile);
      } else if (dockerfile) {
        service.set('build', { context, dockerfile });
      } else {
        setScalar(service, 'build', context);
      }
    }
  }
  // Anchors outside the service fragment are validated when it is inserted into the full document.
  return doc.toString({ lineWidth: 120, verifyAliasOrder: false });
}
