import * as fs from 'fs';
import * as vscode from 'vscode';
import { ComposeContainerStatus, ComposeDocument } from '../types';
import { PodmanService } from './podmanService';
import { YamlService } from './yamlService';

export class StatusProvider implements vscode.Disposable {
  private containers: ComposeContainerStatus[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private activeFile: string | undefined;
  private pollingInFlight = false;
  private readonly _onStatusChange = new vscode.EventEmitter<ComposeContainerStatus[]>();
  public readonly onStatusChange = this._onStatusChange.event;

  constructor(
    private readonly podman: PodmanService,
    private readonly yaml: YamlService
  ) {}

  public startPolling(composeFile: string, intervalMs = 2500): void {
    this.stopPolling();
    this.activeFile = composeFile;
    void this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, Math.max(800, intervalMs));
  }

  public stopPolling(): void {
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
    if (!this.activeFile || this.pollingInFlight) {
      return this.containers;
    }
    this.pollingInFlight = true;
    try {
      let doc: ComposeDocument | undefined;
      if (fs.existsSync(this.activeFile)) {
        try {
          doc = this.yaml.parse(fs.readFileSync(this.activeFile, 'utf-8'));
        } catch {
          // ignore invalid yaml while typing
        }
      }
      const next = await this.podman.composePs(this.activeFile, doc);
      const changed = JSON.stringify(next) !== JSON.stringify(this.containers);
      this.containers = next;
      if (changed) {
        this._onStatusChange.fire(this.containers);
      }
    } catch {
      // ignore background poll errors
    } finally {
      this.pollingInFlight = false;
    }
    return this.containers;
  }

  public dispose(): void {
    this.stopPolling();
    this._onStatusChange.dispose();
  }
}
