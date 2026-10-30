import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PodmanService } from './podmanService';

export const COMPOSE_GLOB =
  '{**/podman-compose.yaml,**/podman-compose.yml,**/container-compose.yaml,**/container-compose.yml,**/compose.yaml,**/compose.yml,**/docker-compose.yaml,**/docker-compose.yml}';

const STORAGE_KEY = 'dockerPodmanStudio.registeredComposeFiles';

export function isComposeFileName(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base === 'podman-compose.yaml' ||
    base === 'podman-compose.yml' ||
    base === 'container-compose.yaml' ||
    base === 'container-compose.yml' ||
    base === 'compose.yaml' ||
    base === 'compose.yml' ||
    base === 'docker-compose.yaml' ||
    base === 'docker-compose.yml'
  );
}

export function mergeComposeFileList(
  files: string[],
  activeFile?: string,
  caseInsensitive = process.platform === 'win32'
): string[] {
  const merged = new Map<string, string>();
  const keyFor = (file: string) => {
    const normalized = path.normalize(file);
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  for (const file of files) merged.set(keyFor(file), file);
  if (activeFile) merged.set(keyFor(activeFile), activeFile);
  return [...merged.values()].sort();
}

export class ComposeFileDetector implements vscode.Disposable {
  private files: string[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly _onFilesChanged = new vscode.EventEmitter<string[]>();
  private readonly _onFileRegistered = new vscode.EventEmitter<string>();
  public readonly onFilesChanged = this._onFilesChanged.event;
  public readonly onFileRegistered = this._onFileRegistered.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly podman: PodmanService
  ) {}

  private getPersistedFiles(): string[] {
    const saved = this.context.globalState.get<string[]>(STORAGE_KEY, []);
    return saved.filter((f) => f && fs.existsSync(f));
  }

  private async savePersistedFiles(paths: string[]): Promise<void> {
    const unique = Array.from(new Set(paths.filter((f) => f && fs.existsSync(f))));
    await this.context.globalState.update(STORAGE_KEY, unique);
  }

  public async scan(): Promise<string[]> {
    const found = await vscode.workspace.findFiles(COMPOSE_GLOB, '**/node_modules/**');
    const wsFiles = found.map((u) => u.fsPath);
    const persisted = this.getPersistedFiles();

    // Also auto-discover compose files referenced by active Podman containers!
    const containerFiles: string[] = [];
    try {
      const containers = await this.podman.listAllContainers();
      for (const c of containers) {
        if (c.composeFile && fs.existsSync(c.composeFile)) {
          containerFiles.push(path.normalize(c.composeFile));
        }
      }
    } catch {
      // ignore if podman machine is offline
    }

    const merged = new Map<string, string>();
    for (const f of [...wsFiles, ...persisted, ...containerFiles]) {
      const norm = process.platform === 'win32' ? path.normalize(f).toLowerCase() : path.normalize(f);
      if (!merged.has(norm) && fs.existsSync(f)) {
        merged.set(norm, path.normalize(f));
      }
    }

    this.files = Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
    return this.files;
  }

  public startWatching(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(COMPOSE_GLOB);
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.refresh());
    this.watcher.onDidChange(() => this._onFilesChanged.fire(this.files));
  }

  public getFiles(): string[] {
    return this.files.filter((f) => fs.existsSync(f));
  }

  public async registerFile(filePath: string): Promise<string[]> {
    const normalized = path.normalize(filePath);
    const persisted = this.getPersistedFiles();
    await this.savePersistedFiles([...persisted, normalized]);
    await this.scan();
    this._onFilesChanged.fire(this.files);
    this._onFileRegistered.fire(normalized);
    return this.files;
  }

  public async refresh(): Promise<void> {
    await this.scan();
    this._onFilesChanged.fire(this.files);
  }

  public dispose(): void {
    this.watcher?.dispose();
    this._onFilesChanged.dispose();
    this._onFileRegistered.dispose();
  }
}
