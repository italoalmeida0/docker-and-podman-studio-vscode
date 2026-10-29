import * as YAML from 'yaml';
import { bt } from '../i18n';
import { ComposeDocument } from '../types';

export const TOP_LEVEL_KEYS = [
  'name',
  'version',
  'services',
  'networks',
  'volumes',
  'configs',
  'secrets',
];

export const SERVICE_KEYS = [
  'image',
  'build',
  'command',
  'entrypoint',
  'container_name',
  'depends_on',
  'deploy',
  'environment',
  'env_file',
  'expose',
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

export class YamlService {
  public parse(content: string): ComposeDocument {
    const doc = YAML.parseDocument(content);
    const json = (doc.toJSON() ?? {}) as Record<string, any>;
    return {
      name: json.name,
      version: json.version,
      services: json.services ?? {},
      networks: json.networks,
      volumes: json.volumes,
      configs: json.configs,
      secrets: json.secrets,
    };
  }

  public stringify(doc: ComposeDocument): string {
    const out: Record<string, any> = {};
    if (doc.name) {
      out.name = doc.name;
    }
    if (doc.version) {
      out.version = doc.version;
    }
    out.services = doc.services ?? {};
    if (doc.networks && Object.keys(doc.networks).length > 0) {
      out.networks = doc.networks;
    }
    if (doc.volumes && Object.keys(doc.volumes).length > 0) {
      out.volumes = doc.volumes;
    }
    if (doc.configs && Object.keys(doc.configs).length > 0) {
      out.configs = doc.configs;
    }
    if (doc.secrets && Object.keys(doc.secrets).length > 0) {
      out.secrets = doc.secrets;
    }
    return YAML.stringify(out, { lineWidth: 120 });
  }

  public addService(doc: ComposeDocument, servicePayload: { name: string; [key: string]: any }): ComposeDocument {
    const { name, ...definition } = servicePayload;
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

  public parseServiceFragment(serviceName: string, rawFragment: string): Record<string, any> {
    const trimmed = String(rawFragment || '').trim();
    if (!trimmed) {
      throw new Error(bt('emptyServiceYamlError'));
    }
    const parsed = YAML.parseDocument(trimmed);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors[0].message);
    }
    const obj = parsed.toJSON();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(bt('invalidServiceYamlObject'));
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
    const doc = YAML.parseDocument(content);

    for (const err of doc.errors) {
      issues.push(this.yamlErrorToIssue(content, err, 'error'));
    }
    for (const warn of doc.warnings) {
      issues.push(this.yamlErrorToIssue(content, warn, 'warning'));
    }

    let json: any;
    try {
      json = doc.toJSON();
    } catch {
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
        if (!svcDef.image && !svcDef.build) {
          issues.push({
            message: bt('missingImageOrBuild', { service: svcName }),
            severity: 'error',
            code: 'missing-image-or-build',
            range: this.findKeyRange(content, svcName, 0),
          });
        }
        if (Array.isArray(svcDef.ports)) {
          for (const p of svcDef.ports) {
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
