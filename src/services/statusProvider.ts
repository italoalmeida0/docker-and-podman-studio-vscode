import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { ComposeContainerStatus, ComposeDocument } from '../types';
import { PodmanService } from './podmanService';
import { YamlService } from './yamlService';

export class StatusProvider implements vscode.Disposable {
  private containers: ComposeContainerStatus[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private activeFile: string | undefined;
  private contextKey: string | undefined;
  private pollingGeneration: number | undefined;
  private generation = 0;
  private lastError = '';
  private readonly _onStatusChange = new vscode.EventEmitter<ComposeContainerStatus[]>();
  private readonly _onError = new vscode.EventEmitter<string>();
  public readonly onStatusChange = this._onStatusChange.event;
  public readonly onError = this._onError.event;

  constructor(
    private readonly podman: PodmanService,
    private readonly yaml: YamlService
  ) {}

  private clearContainers(): void {
    if (this.containers.length > 0) {
      this.containers = [];
      this._onStatusChange.fire(this.containers);
    }
  }

  public startPolling(composeFile: string, intervalMs = 2500): void {
    const changedFile = this.activeFile !== composeFile;
    const cfg = getConfig();
    const nextContext = JSON.stringify([
      cfg.engine, cfg.dockerPath, cfg.podmanPath, cfg.composePath, cfg.composeCommandStyle, cfg.inPod,
    ]);
    const changedContext = this.contextKey !== nextContext;
    this.stopPolling();
    this.activeFile = composeFile;
    this.contextKey = nextContext;
    if (changedFile || changedContext) {
      this.lastError = '';
    }
    if (changedFile || changedContext) {
      this.clearContainers();
    }
    void this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, Math.max(800, intervalMs));
  }

  public stopPolling(): void {
    this.generation++;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.activeFile = undefined;
  }

  public clearActiveFile(): void {
    this.stopPolling();
    this.contextKey = undefined;
    this.lastError = '';
    this.clearContainers();
  }

  public getContainers(): ComposeContainerStatus[] {
    return this.containers;
  }

  public async poll(): Promise<ComposeContainerStatus[]> {
    if (!this.activeFile || this.pollingGeneration === this.generation) {
      return this.containers;
    }
    const file = this.activeFile;
    const generation = this.generation;
    this.pollingGeneration = generation;
    try {
      let doc: ComposeDocument | undefined;
      const content = fs.readFileSync(file, 'utf-8');
      const revision = this.podman.getComposeProjectRevision(file);
      try {
        doc = this.yaml.parse(content);
      } catch {
        // ignore invalid yaml while typing
      }
      const next = await this.podman.composePs(file, doc);
      if (generation !== this.generation) {
        return this.containers;
      }
      if (!fs.existsSync(file)) {
        throw new Error(`Compose file is unavailable: ${file}`);
      }
      if (this.podman.getComposeProjectRevision(file) !== revision) {
        this.clearContainers();
        return this.containers;
      }
      this.lastError = '';
      const changed = JSON.stringify(next) !== JSON.stringify(this.containers);
      this.containers = next;
      if (changed) {
        this._onStatusChange.fire(this.containers);
      }
    } catch (error) {
      if (generation === this.generation) {
        const unavailable = !fs.existsSync(file);
        let projectUnavailable = unavailable;
        if (!projectUnavailable) {
          try {
            this.podman.getComposeProjectRevision(file);
          } catch {
            projectUnavailable = true;
          }
        }
        if (projectUnavailable) {
          this.clearContainers();
        }
        const message = unavailable
          ? `Compose file is unavailable: ${file}`
          : error instanceof Error ? error.message : String(error);
        if (message !== this.lastError) {
          this.lastError = message;
          this._onError.fire(message);
        }
      }
    } finally {
      if (this.pollingGeneration === generation) {
        this.pollingGeneration = undefined;
      }
    }
    return this.containers;
  }

  public dispose(): void {
    this.stopPolling();
    this._onStatusChange.dispose();
    this._onError.dispose();
  }
}
