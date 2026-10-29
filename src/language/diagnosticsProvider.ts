import * as vscode from 'vscode';
import { isComposeFileName } from '../services/composeDetector';
import { YamlService } from '../services/yamlService';

export class ComposeDiagnosticsProvider implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly yamlService: YamlService) {
    this.diagnostics = vscode.languages.createDiagnosticCollection('dockerPodmanStudio');

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (isComposeFileName(e.document.fileName)) {
          this.debouncedUpdate(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (isComposeFileName(doc.fileName)) {
          this.update(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnostics.delete(doc.uri);
      })
    );

    for (const doc of vscode.workspace.textDocuments) {
      if (isComposeFileName(doc.fileName)) {
        this.update(doc);
      }
    }
  }

  private debouncedUpdate(doc: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.update(doc);
    }, 300);
  }

  public update(doc: vscode.TextDocument): void {
    const issues = this.yamlService.validate(doc.getText());
    const list = issues.map((issue) => {
      const range = new vscode.Range(
        new vscode.Position(issue.range.start.line, issue.range.start.character),
        new vscode.Position(issue.range.end.line, issue.range.end.character)
      );
      const sev =
        issue.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : issue.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;
      const diag = new vscode.Diagnostic(range, issue.message, sev);
      diag.source = 'Docker and Podman Studio';
      if (issue.code) {
        diag.code = issue.code;
      }
      return diag;
    });
    this.diagnostics.set(doc.uri, list);
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.diagnostics.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
