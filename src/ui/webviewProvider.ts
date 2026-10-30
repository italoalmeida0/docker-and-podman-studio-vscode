import * as path from 'path';
import * as vscode from 'vscode';
import { getEngineLabel } from '../config';
import { bt, resolveBackendLocale } from '../i18n';

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class StudioLauncherViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dockerPodmanStudio.launcher';
  private currentView: vscode.WebviewView | undefined;

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.currentView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.command === 'open') {
        void vscode.commands.executeCommand('dockerPodmanStudio.openPanel');
      } else if (msg?.command === 'tools') {
        void vscode.commands.executeCommand('dockerPodmanStudio.openToolsMenu');
      } else if (msg?.command === 'switchEngine') {
        void vscode.commands.executeCommand('dockerPodmanStudio.switchEngine');
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void vscode.commands.executeCommand('dockerPodmanStudio.openPanel');
      }
    });

    setTimeout(() => {
      void vscode.commands.executeCommand('dockerPodmanStudio.openPanel');
    }, 100);
  }

  public refreshLocalization(): void {
    if (this.currentView) {
      this.currentView.webview.html = this.getHtml();
    }
  }

  private getHtml(): string {
    const nonce = createNonce();
    const lang = resolveBackendLocale();
    const engine = getEngineLabel();
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body { padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); display: flex; flex-direction: column; gap: 10px; }
    .btn { width: 100%; padding: 9px 12px; cursor: pointer; border-radius: 5px; font-weight: 500; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-sec { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35)); }
    .btn-sec:hover { background: var(--vscode-list-hoverBackground); }
    p { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; margin: 0; }
  </style>
</head>
<body>
  <button id="open" class="btn">${bt('launcherOpenBtn')}</button>
  <button id="switchEngine" class="btn btn-sec">${bt('launcherSwitchEngineBtn', { engine })}</button>
  <button id="tools" class="btn btn-sec">${bt('launcherQuickToolsBtn')}</button>
  <p>${bt('launcherDescription')}</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ command: 'open' }));
    document.getElementById('switchEngine').addEventListener('click', () => vscode.postMessage({ command: 'switchEngine' }));
    document.getElementById('tools').addEventListener('click', () => vscode.postMessage({ command: 'tools' }));
  </script>
</body>
</html>`;
  }
}

export class StudioWebviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly _onMessage = new vscode.EventEmitter<any>();
  public readonly onMessage = this._onMessage.event;
  private readonly _onDidClose = new vscode.EventEmitter<void>();
  public readonly onDidClose = this._onDidClose.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  public isVisible(): boolean {
    return Boolean(this.panel);
  }

  public createOrShowPanel(): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return this.panel;
    }

    this.panel = vscode.window.createWebviewPanel(
      'dockerPodmanStudio',
      'Docker and Podman Studio',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build'),
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
        ],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'icon.png'
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        this._onMessage.fire(msg);
      },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this._onDidClose.fire();
      },
      undefined,
      this.disposables
    );

    return this.panel;
  }

  public postMessage(message: any): void {
    void this.panel?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const buildDir = path.join(this.extensionUri.fsPath, 'webview-ui', 'build');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(buildDir, 'assets', 'index.js'))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(buildDir, 'assets', 'index.css'))
    );
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Docker and Podman Studio</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    this.panel?.dispose();
    this._onMessage.dispose();
    this._onDidClose.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
