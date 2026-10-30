import * as YAML from 'yaml';
import { bt } from '../i18n';
import { UserFacingError } from '../shared/userFacingError';
import { ComposeDocument } from '../types';

export const TOP_LEVEL_KEYS = [
  'name',
  'version',
  'services',
  'networks',
  'volumes',
  'configs',
  'secrets',
  'include',
  'models',
];

export const SERVICE_KEYS = [
  'image',
  'build',
  'cap_add',
  'cap_drop',
  'command',
  'entrypoint',
  'container_name',
  'depends_on',
  'deploy',
  'environment',
  'env_file',
  'expose',
  'extends',
  'extra_hosts',
  'healthcheck',
  'hostname',
  'labels',
  'links',
  'logging',
  'network_mode',
  'networks',
  'pid',
  'platform',
  'podman',
  'ports',
  'profiles',
  'pull_policy',
  'restart',
  'secrets',
  'security_opt',
  'stdin_open',
  'stop_grace_period',
  'stop_signal',
  'sysctls',
  'tmpfs',
  'tty',
  'ulimits',
  'user',
  'userns_mode',
  'volumes',
  'volumes_from',
  'working_dir',
];

export interface ValidationIssue {
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

const PORT_RE = /^(?:[\d.]+:)?(\d+):(\d+)(\/\w+)?$/;

function mappingKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value && typeof value === 'object') {
    return Object.keys(value);
  }
  return [];
}

function namedVolumeSource(mount: unknown): string | undefined {
  if (mount && typeof mount === 'object' && !Array.isArray(mount)) {
    const entry = mount as Record<string, unknown>;
    return entry.type === 'volume' && typeof entry.source === 'string'
      ? entry.source
      : undefined;
  }
  if (typeof mount !== 'string' || /^[a-zA-Z]:[\\/]/.test(mount)) {
    return undefined;
  }
  const separator = mount.indexOf(':');
  if (separator <= 0) {
    return undefined;
  }
  const source = mount.slice(0, separator);
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('~') ||
    source.includes('\\') ? undefined : source;
}

export function composeReferences(
  doc: ComposeDocument,
  kind: 'service' | 'network' | 'volume',
  name: string
): string[] {
  return Object.entries(doc.services || {})
    .filter(([service, definition]) => {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        return false;
      }
      if (kind === 'network') {
        return mappingKeys(definition.networks).includes(name) ||
          (name === 'default' && !definition.networks && !definition.network_mode);
      }
      if (kind === 'volume') {
        return Array.isArray(definition.volumes) &&
          definition.volumes.some((mount: unknown) => namedVolumeSource(mount) === name);
      }
      if (service === name) {
        return false;
      }
      const depends = mappingKeys(definition.depends_on).includes(name);
      const links = Array.isArray(definition.links) &&
        definition.links.some((link: unknown) => typeof link === 'string' && link.split(':')[0] === name);
      const volumesFrom = Array.isArray(definition.volumes_from) &&
        definition.volumes_from.some((source: unknown) => typeof source === 'string' &&
          !source.startsWith('container:') && source.split(':')[0] === name);
      const namespace = ['network_mode', 'ipc', 'pid'].some(
        (key) => definition[key] === `service:${name}`
      );
      const extended = definition.extends && typeof definition.extends === 'object' &&
        !definition.extends.file && definition.extends.service === name;
      return depends || links || volumesFrom || namespace || extended;
    })
    .map(([service]) => service);
}

export class YamlService {
  public parse(content: string): ComposeDocument {
    return this.documentFromYaml(this.parseEditableDocument(content));
  }

  private documentFromYaml(doc: YAML.Document): ComposeDocument {
    const json: unknown = doc.toJS();
    if (json !== null && (typeof json !== 'object' || Array.isArray(json))) {
      throw new Error('The Compose document must be a mapping.');
    }
    const result = (json ?? {}) as Record<string, any>;
    if (result.services !== undefined && result.services !== null &&
        (typeof result.services !== 'object' || Array.isArray(result.services))) {
      throw new Error('Compose services must be a mapping.');
    }
    return { ...result, services: result.services ?? {} };
  }

  public parseWithServiceFragments(content: string): {
    document: ComposeDocument;
    serviceFragments: Record<string, string>;
  } {
    const doc = this.parseEditableDocument(content);
    return {
      document: this.documentFromYaml(doc),
      serviceFragments: this.fragmentsFromYaml(content, doc),
    };
  }

  public stringify(doc: ComposeDocument): string {
    return YAML.stringify(doc, { lineWidth: 120 });
  }

  public addService(doc: ComposeDocument, servicePayload: { name: string; [key: string]: any }): ComposeDocument {
    const { name, ...definition } = servicePayload;
    this.assertNewName(doc.services, name, 'Service');
    return {
      ...doc,
      services: {
        ...doc.services,
        [name]: definition,
      },
    };
  }

  public removeService(doc: ComposeDocument, serviceName: string): ComposeDocument {
    const { [serviceName]: _removed, ...rest } = doc.services ?? {};
    return {
      ...doc,
      services: rest,
    };
  }

  public updateService(doc: ComposeDocument, serviceName: string, changes: Record<string, any>): ComposeDocument {
    const existing = doc.services?.[serviceName];
    if (!existing) {
      return doc;
    }
    return {
      ...doc,
      services: {
        ...doc.services,
        [serviceName]: {
          ...existing,
          ...changes,
        },
      },
    };
  }

  private parseEditableDocument(content: string): YAML.Document {
    const doc = YAML.parseDocument(content, { merge: true, uniqueKeys: true });
    if (doc.errors.length > 0) {
      throw new Error(doc.errors[0].message);
    }
    return doc;
  }

  private assertNewName(entries: Record<string, unknown> | undefined, name: string, kind: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      throw new Error(`${kind} name "${name}" is invalid.`);
    }
    if (entries && Object.prototype.hasOwnProperty.call(entries, name)) {
      throw new Error(`${kind} "${name}" already exists.`);
    }
  }

  private editableSection(doc: YAML.Document, section: string): YAML.YAMLMap {
    if (!doc.contents) {
      doc.contents = doc.createNode({});
    }
    if (!YAML.isMap(doc.contents)) {
      throw new Error('The Compose document must be a mapping.');
    }
    let node = doc.get(section, true);
    if (node === undefined || node === null || (YAML.isScalar(node) && node.value === null)) {
      doc.set(section, doc.createNode({}));
      node = doc.get(section, true);
    }
    if (!YAML.isMap(node)) {
      throw new Error(`The "${section}" section must be a direct mapping to edit it safely.`);
    }
    return node;
  }

  private finishEdit(doc: YAML.Document): string {
    const result = doc.toString({ lineWidth: 120 });
    this.parse(result);
    return result;
  }

  public addServiceToYaml(
    content: string,
    servicePayload: { name: string; [key: string]: any },
    resources?: Pick<ComposeDocument, 'networks' | 'volumes'>
  ): string {
    const { name, ...definition } = servicePayload;
    const current = this.parse(content);
    this.assertNewName(current.services, name, 'Service');
    const doc = this.parseEditableDocument(content);
    this.editableSection(doc, 'services').set(name, definition);
    for (const kind of ['networks', 'volumes'] as const) {
      const missing = Object.entries(resources?.[kind] || {})
        .filter(([resource]) => !Object.prototype.hasOwnProperty.call(current[kind] || {}, resource));
      if (missing.length) {
        const section = this.editableSection(doc, kind);
        for (const [resource, value] of missing) {
          this.assertNewName(current[kind], resource, kind === 'networks' ? 'Network' : 'Volume');
          section.set(resource, value);
        }
      }
    }
    return this.finishEdit(doc);
  }

  public serviceFragment(content: string, serviceName: string): string {
    const doc = this.parseEditableDocument(content);
    const services = doc.get('services', true);
    if (!YAML.isMap(services)) {
      throw new Error('The services section must be a direct mapping to edit a service.');
    }
    const node = services.get(serviceName, true);
    if (!YAML.isNode(node) || !node.range) {
      throw new Error(`Service "${serviceName}" no longer exists.`);
    }
    return this.fragmentForNode(content, node);
  }

  private fragmentForNode(content: string, node: YAML.Node): string {
    if (!node.range) {
      throw new Error('The service has no editable source range.');
    }
    const [start, , end] = node.range;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const indent = content.slice(lineStart, start).match(/^\s*$/)?.[0].length ?? 0;
    const lines = content.slice(start, end).replace(/\r\n/g, '\n').split('\n');
    return lines.map((line, index) =>
      index === 0 ? line : line.replace(new RegExp(`^ {0,${indent}}`), '')
    ).join('\n').trimEnd();
  }

  public serviceFragments(content: string): Record<string, string> {
    return this.fragmentsFromYaml(content, this.parseEditableDocument(content));
  }

  private fragmentsFromYaml(content: string, doc: YAML.Document): Record<string, string> {
    const services = doc.get('services', true);
    if (!YAML.isMap(services)) {
      return {};
    }
    const fragments: Record<string, string> = {};
    for (const pair of services.items) {
      if (YAML.isScalar(pair.key) && typeof pair.key.value === 'string' &&
          YAML.isNode(pair.value) && !YAML.isAlias(pair.value) && pair.value.range) {
        fragments[pair.key.value] = this.fragmentForNode(content, pair.value);
      }
    }
    return fragments;
  }

  public updateServiceInYaml(content: string, serviceName: string, rawFragment: string): string {
    const current = this.parse(content);
    if (!Object.prototype.hasOwnProperty.call(current.services, serviceName)) {
      throw new Error(`Service "${serviceName}" no longer exists.`);
    }
    const trimmed = String(rawFragment || '').trim();
    if (!trimmed) {
      throw new UserFacingError('emptyServiceYamlError');
    }
    const fragment = this.parseEditableDocument(trimmed);
    let definition: unknown = fragment.contents;
    if (YAML.isMap(definition)) {
      const services = definition.get('services', true);
      if (YAML.isMap(services) && services.has(serviceName)) {
        definition = services.get(serviceName, true);
      } else if (definition.items.length === 1 && definition.has(serviceName)) {
        definition = definition.get(serviceName, true);
      }
    }
    if (!YAML.isMap(definition) && !YAML.isAlias(definition)) {
      throw new UserFacingError('invalidServiceYamlObject');
    }
    const doc = this.parseEditableDocument(content);
    const services = this.editableSection(doc, 'services');
    const original = services.get(serviceName, true);
    if (YAML.isMap(original) && YAML.isMap(definition)) {
      definition.anchor ??= original.anchor;
      definition.commentBefore ??= original.commentBefore;
    }
    services.set(serviceName, definition);
    return this.finishEdit(doc);
  }

  public removeServiceFromYaml(content: string, serviceName: string): string {
    const current = this.parse(content);
    if (!Object.prototype.hasOwnProperty.call(current.services, serviceName)) {
      throw new Error(`Service "${serviceName}" no longer exists.`);
    }
    const references = composeReferences(current, 'service', serviceName);
    if (references.length > 0) {
      throw new Error(`Service "${serviceName}" is referenced by: ${references.join(', ')}.`);
    }
    const doc = this.parseEditableDocument(content);
    this.editableSection(doc, 'services').delete(serviceName);
    return this.finishEdit(doc);
  }

  public addResourceToYaml(
    content: string,
    kind: 'networks' | 'volumes',
    name: string,
    definition: Record<string, unknown>
  ): string {
    const current = this.parse(content);
    this.assertNewName(current[kind], name, kind === 'networks' ? 'Network' : 'Volume');
    const doc = this.parseEditableDocument(content);
    this.editableSection(doc, kind).set(name, definition);
    return this.finishEdit(doc);
  }

  public removeResourceFromYaml(content: string, kind: 'networks' | 'volumes', name: string): string {
    const current = this.parse(content);
    if (!current[kind] || !Object.prototype.hasOwnProperty.call(current[kind], name)) {
      throw new Error(`${kind === 'networks' ? 'Network' : 'Volume'} "${name}" no longer exists.`);
    }
    const references = composeReferences(current, kind === 'networks' ? 'network' : 'volume', name);
    if (references.length > 0) {
      throw new Error(`${kind === 'networks' ? 'Network' : 'Volume'} "${name}" is referenced by: ${references.join(', ')}.`);
    }
    const doc = this.parseEditableDocument(content);
    this.editableSection(doc, kind).delete(name);
    return this.finishEdit(doc);
  }

  public parseServiceFragment(serviceName: string, rawFragment: string): Record<string, any> {
    const trimmed = String(rawFragment || '').trim();
    if (!trimmed) {
      throw new UserFacingError('emptyServiceYamlError');
    }
    const parsed = YAML.parseDocument(trimmed);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors[0].message);
    }
    const obj = parsed.toJSON();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new UserFacingError('invalidServiceYamlObject');
    }
    if (obj.services && typeof obj.services === 'object' && !Array.isArray(obj.services)) {
      const inner = obj.services[serviceName];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return inner;
      }
    }
    if (obj[serviceName] && typeof obj[serviceName] === 'object' && Object.keys(obj).length === 1) {
      return obj[serviceName];
    }
    return obj;
  }

  public validate(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const doc = YAML.parseDocument(content, { merge: true, uniqueKeys: true });

    for (const err of doc.errors) {
      issues.push(this.yamlErrorToIssue(content, err, 'error'));
    }
    for (const warn of doc.warnings) {
      issues.push(this.yamlErrorToIssue(content, warn, 'warning'));
    }

    let json: any;
    try {
      json = doc.toJS();
    } catch (error) {
      if (issues.length === 0) {
        issues.push({
          message: error instanceof Error ? error.message : String(error),
          severity: 'error',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        });
      }
      return issues;
    }
    if (!json || typeof json !== 'object') {
      return issues;
    }

    for (const key of Object.keys(json)) {
      if (!TOP_LEVEL_KEYS.includes(key) && !key.startsWith('x-')) {
        issues.push({
          message: bt('unknownTopLevelKey', { key }),
          severity: 'warning',
          code: 'unknown-top-level-key',
          range: this.findKeyRange(content, key, 0),
        });
      }
    }

    if (json.services && typeof json.services === 'object') {
      for (const [svcName, svcDef] of Object.entries<any>(json.services)) {
        if (!svcDef || typeof svcDef !== 'object') {
          continue;
        }
        for (const k of Object.keys(svcDef)) {
          if (!SERVICE_KEYS.includes(k) && !k.startsWith('x-')) {
            issues.push({
              message: bt('unknownServiceKey', { key: k, service: svcName }),
              severity: 'warning',
              code: 'unknown-service-key',
              range: this.findKeyRange(content, k, 0),
            });
          }
        }
        if (!svcDef.image && !svcDef.build && !svcDef.extends) {
          issues.push({
            message: bt('missingImageOrBuild', { service: svcName }),
            severity: 'warning',
            code: 'missing-image-or-build',
            range: this.findKeyRange(content, svcName, 0),
          });
        }
        if (Array.isArray(svcDef.ports)) {
          for (const p of svcDef.ports) {
            if (typeof p !== 'string' && typeof p !== 'number') {
              continue;
            }
            const pStr = String(p);
            if (pStr.includes(':') && !PORT_RE.test(pStr) && !pStr.includes('-') && !pStr.includes('$')) {
              issues.push({
                message: bt('unusualPortFormat', { port: pStr }),
                severity: 'warning',
                code: 'invalid-port-format',
                range: this.findKeyRange(content, pStr, 0),
              });
            }
          }
        }
      }
    }

    return issues;
  }

  private yamlErrorToIssue(content: string, err: any, severity: 'error' | 'warning'): ValidationIssue {
    const pos = err.pos ?? [0, 1];
    const before = content.slice(0, pos[0]);
    const lines = before.split(/\r?\n/);
    const line = Math.max(0, lines.length - 1);
    const col = lines[lines.length - 1]?.length ?? 0;
    return {
      message: err.message,
      severity,
      range: {
        start: { line, character: col },
        end: { line, character: col + Math.max(1, (pos[1] ?? pos[0]) - pos[0]) },
      },
    };
  }

  private findKeyRange(content: string, needle: string, startLine: number) {
    const lines = content.split(/\r?\n/);
    for (let i = startLine; i < lines.length; i++) {
      const idx = lines[i].indexOf(needle);
      if (idx !== -1) {
        return {
          start: { line: i, character: idx },
          end: { line: i, character: idx + needle.length },
        };
      }
    }
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };
  }
}
