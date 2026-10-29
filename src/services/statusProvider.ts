import * as fs from 'fs';
import * as vscode from 'vscode';
import { ComposeContainerStatus, ComposeDocument } from '../types';
import { PodmanService } from './podmanService';
import { YamlService } from './yamlService';

export class StatusProvider implements vscode.Disposable {
  private containers: ComposeContainerStatus[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private activeFile: string | undefined;
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

  public startPolling(composeFile: string, intervalMs = 2500): void {
    const changedFile = this.activeFile !== composeFile;
    this.stopPolling();
    this.activeFile = composeFile;
    if (changedFile) {
      this.lastError = '';
    }
    if (changedFile && this.containers.length > 0) {
      this.containers = [];
      this._onStatusChange.fire(this.containers);
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
      if (fs.existsSync(file)) {
        try {
          doc = this.yaml.parse(fs.readFileSync(file, 'utf-8'));
        } catch {
          // ignore invalid yaml while typing
        }
      }
      const next = await this.podman.composePs(file, doc);
      if (generation !== this.generation) {
        return this.containers;
      }
      this.lastError = '';
      const changed = JSON.stringify(next) !== JSON.stringify(this.containers);
      this.containers = next;
      if (changed) {
        this._onStatusChange.fire(this.containers);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (generation === this.generation && message !== this.lastError) {
        this.lastError = message;
        this._onError.fire(message);
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
