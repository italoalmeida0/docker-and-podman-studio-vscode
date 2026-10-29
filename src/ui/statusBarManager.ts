import * as vscode from 'vscode';
import { getEngineLabel } from '../config';
import { bt } from '../i18n';

export class StatusBarManager implements vscode.Disposable {
  private static instance: StatusBarManager | undefined;
  private readonly launcherItem: vscode.StatusBarItem;
  private readonly progressItem: vscode.StatusBarItem;
  private hideTimer: NodeJS.Timeout | undefined;
  private lastRunningState: boolean | undefined;

  private constructor() {
    this.launcherItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 105);
    this.launcherItem.name = 'Docker and Podman Studio';
    this.launcherItem.command = 'dockerPodmanStudio.openPanel';
    this.updateMachineBadge(undefined);
    this.launcherItem.show();

    this.progressItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
    this.progressItem.name = 'Docker and Podman Studio Operations';
  }

  public static getInstance(): StatusBarManager {
    if (!StatusBarManager.instance) {
      StatusBarManager.instance = new StatusBarManager();
    }
    return StatusBarManager.instance;
  }

  public updateMachineBadge(running?: boolean): void {
    this.lastRunningState = running;
    const engine = getEngineLabel();
    if (running === undefined) {
      this.launcherItem.text = `$(layers) Docker & Podman (${engine})`;
      this.launcherItem.tooltip = bt('openStudioTooltip', { engine });
    } else if (running) {
      this.launcherItem.text = `$(layers) Docker & Podman (${engine}) $(circle-filled)`;
      this.launcherItem.tooltip = bt('engineActiveTooltip', { engine });
    } else {
      this.launcherItem.text = `$(layers) Docker & Podman (${engine}) $(circle-outline)`;
      this.launcherItem.tooltip = bt('engineStoppedTooltip', { engine });
    }
  }

  public refreshLocalization(): void {
    this.updateMachineBadge(this.lastRunningState);
  }

  public showStatus(text: string, state: 'loading' | 'done' | 'error' = 'loading'): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }

    const icon =
      state === 'loading'
        ? '$(sync~spin)'
        : state === 'error'
          ? '$(error)'
          : '$(check)';

    this.progressItem.text = `${icon} ${text}`;
    this.progressItem.show();

    if (state !== 'loading') {
      this.hideTimer = setTimeout(() => {
        this.progressItem.hide();
      }, 3200);
    }
  }

  public hideStatus(): void {
    this.progressItem.hide();
  }

  public dispose(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.launcherItem.dispose();
    this.progressItem.dispose();
  }
}

export async function withStatus<T>(operation: string, task: () => Promise<T>): Promise<T> {
  const bar = StatusBarManager.getInstance();
  const engine = getEngineLabel();
  try {
    bar.showStatus(`${engine}: ${operation}...`, 'loading');
    const result = await task();
    const failed =
      typeof result === 'object' &&
      result !== null &&
      'success' in result &&
      result.success === false;
    bar.showStatus(
      `${engine}: ${bt(failed ? 'opFailed' : 'opCompleted', { op: operation })}`,
      failed ? 'error' : 'done'
    );
    return result;
  } catch (err) {
    bar.showStatus(`${engine}: ${bt('opFailed', { op: operation })}`, 'error');
    throw err;
  }
}
