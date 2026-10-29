import * as vscode from 'vscode';
import { getConfig } from '../config';
import { isComposeFileName } from '../services/composeDetector';
import { SERVICE_KEYS, TOP_LEVEL_KEYS } from '../services/yamlService';

const RESTART_POLICIES = ['no', 'always', 'on-failure', 'unless-stopped'];
const NETWORK_MODES = ['bridge', 'host', 'none', 'slirp4netns', 'pasta'];
const CONDITIONS = ['service_started', 'service_healthy', 'service_completed_successfully'];
const COMMON_IMAGES = [
  'nginx:alpine',
  'postgres:16-alpine',
  'redis:7-alpine',
  'node:22-alpine',
  'python:3.12-slim',
  'mariadb:11',
  'mongo:7',
  'rabbitmq:3-management',
  'docker.io/library/nginx:alpine',
  'quay.io/podman/hello:latest',
  'quay.io/keycloak/keycloak:latest',
  'ghcr.io/',
];

export const COMPOSE_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: 'yaml', pattern: '**/podman-compose.{yaml,yml}' },
  { language: 'yaml', pattern: '**/container-compose.{yaml,yml}' },
  { language: 'yaml', pattern: '**/compose.{yaml,yml}' },
  { language: 'yaml', pattern: '**/docker-compose.{yaml,yml}' },
  { language: 'dockercompose', pattern: '**/*' },
];

export class ComposeCompletionProvider implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    if (!isComposeFileName(document.fileName)) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;
    if (lineText.search(/\S/) === 0 || (position.character === 0 && lineText.trim() === '')) {
      return TOP_LEVEL_KEYS.map((key) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
        item.documentation = `Compose top-level key: ${key}`;
        return item;
      });
    }

    const ctx = this.detectContext(document, position);
    if (ctx === 'service-key') {
      return SERVICE_KEYS.map((key) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.insertText = this.getSnippet(key);
        item.documentation = `Compose service option: ${key}`;
        return item;
      });
    }
    if (ctx === 'image-value') {
      return COMMON_IMAGES.map((img) => {
        const item = new vscode.CompletionItem(img, vscode.CompletionItemKind.Value);
        item.detail = 'Container Image (Docker / Podman OCI)';
        return item;
      });
    }
    if (ctx === 'restart-value') {
      return RESTART_POLICIES.map((p) => {
        const item = new vscode.CompletionItem(p, vscode.CompletionItemKind.EnumMember);
        item.detail = 'Restart policy';
        return item;
      });
    }
    if (ctx === 'network-mode-value') {
      return NETWORK_MODES.map((m) => {
        const item = new vscode.CompletionItem(m, vscode.CompletionItemKind.EnumMember);
        item.detail = 'Container network mode';
        return item;
      });
    }
    if (ctx === 'condition-value') {
      return CONDITIONS.map((c) => {
        const item = new vscode.CompletionItem(c, vscode.CompletionItemKind.EnumMember);
        item.detail = 'depends_on condition';
        return item;
      });
    }
    return undefined;
  }

  private detectContext(document: vscode.TextDocument, position: vscode.Position): string {
    const line = document.lineAt(position).text;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('image:')) {
      return 'image-value';
    }
    if (trimmed.startsWith('restart:')) {
      return 'restart-value';
    }
    if (trimmed.startsWith('network_mode:')) {
      return 'network-mode-value';
    }
    if (trimmed.startsWith('condition:')) {
      return 'condition-value';
    }

    const indent = line.search(/\S/);
    for (let l = position.line - 1; l >= 0; l--) {
      const prev = document.lineAt(l).text;
      const prevIndent = prev.search(/\S/);
      if (prevIndent >= 0 && prevIndent < indent) {
        if (prev.trimStart().startsWith('services:')) {
          return 'service-name';
        }
        if (prevIndent >= 2) {
          return 'service-key';
        }
        break;
      }
    }
    return indent >= 4 ? 'service-key' : 'unknown';
  }

  private getSnippet(key: string): vscode.SnippetString {
    const isPodman = getConfig().engine === 'podman';
    switch (key) {
      case 'ports':
        return new vscode.SnippetString('ports:\n      - "${1:8080}:${2:80}"');
      case 'volumes':
        return new vscode.SnippetString(
          isPodman
            ? 'volumes:\n      - "${1:./data}:${2:/app/data}:Z"'
            : 'volumes:\n      - "${1:./data}:${2:/app/data}"'
        );
      case 'environment':
        return new vscode.SnippetString('environment:\n      ${1:KEY}: ${2:value}');
      case 'depends_on':
        return new vscode.SnippetString('depends_on:\n      - ${1:service}');
      case 'networks':
        return new vscode.SnippetString('networks:\n      - ${1:default}');
      case 'healthcheck':
        return new vscode.SnippetString(
          'healthcheck:\n      test: ["CMD-SHELL", "${1:curl -sf http://localhost:80 || exit 1}"]\n      interval: ${2:30s}\n      timeout: ${3:10s}\n      retries: ${4:3}'
        );
      case 'build':
        return new vscode.SnippetString(
          `build:\n      context: \${1:.}\n      dockerfile: \${2:${isPodman ? 'Containerfile' : 'Dockerfile'}}`
        );
      default:
        return new vscode.SnippetString(`${key}: $0`);
    }
  }
}
