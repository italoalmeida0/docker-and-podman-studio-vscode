import * as vscode from 'vscode';
import { bt, resolveBackendLocale } from '../i18n';
import { failureSeverity, FailurePresentation, formatFailureSummary } from '../shared/failureMessages';
import { classifyFailure } from '../shared/operationFeedback';
import type { SupportedLocale } from '../config';

export function createFailurePresentation(
  message: string,
  errorCode?: string,
  operation?: string,
  progress?: { completed?: number; total?: number },
  operationLocale: SupportedLocale = resolveBackendLocale()
): FailurePresentation {
  return {
    kind: classifyFailure(message, errorCode),
    ...(operation && (operationLocale === 'en' || operationLocale === 'pt-BR')
      ? { operation, operationLocale } : {}),
    ...(typeof progress?.completed === 'number' ? { completed: progress.completed } : {}),
    ...(typeof progress?.total === 'number' ? { total: progress.total } : {}),
  };
}

export function summarizeFailure(
  message: string,
  errorCode?: string,
  operation?: string,
  progress?: { completed?: number; total?: number }
): string {
  return formatFailureSummary(resolveBackendLocale(), createFailurePresentation(message, errorCode, operation, progress));
}

export function stripFormatFlags(command: string): string {
  return command
    .replace(/--format\s+"[^"]*"/g, '')
    .replace(/--format\s+'[^']*'/g, '')
    .replace(/--format=\S+/g, '')
    .replace(/--format\s+\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function showErrorWithCopy(
  errorMessage: string,
  command: string | undefined,
  output: vscode.OutputChannel,
  operation: string,
  errorCode?: string,
  progress?: { completed?: number; total?: number }
): void {
  const copyErrorLabel = bt('copyError');
  const copyCommandLabel = bt('copyCommand');
  const openOutputLabel = bt('openOperationOutput');
  const actions: string[] = [openOutputLabel, copyErrorLabel];
  if (command) {
    actions.push(copyCommandLabel);
  }
  output.appendLine(`[${new Date().toISOString()}] ${operation}:\n${errorMessage}`);
  const failure = createFailurePresentation(errorMessage, errorCode, operation, progress);
  const summary = formatFailureSummary(resolveBackendLocale(), failure);
  const notification = failureSeverity(failure) === 'warning'
    ? vscode.window.showWarningMessage(summary, ...actions)
    : vscode.window.showErrorMessage(summary, ...actions);
  void Promise.resolve(notification).then(async (choice) => {
    if (choice === openOutputLabel) {
      output.show(true);
    } else if (choice === copyErrorLabel) {
      await vscode.env.clipboard.writeText(errorMessage);
      void vscode.window.showInformationMessage(bt('errorCopied'));
    } else if (choice === copyCommandLabel && command) {
      await vscode.env.clipboard.writeText(stripFormatFlags(command));
      void vscode.window.showInformationMessage(bt('commandCopied'));
    }
  }).catch((error: unknown) => {
    output.appendLine(`[${new Date().toISOString()}] Could not show error details: ${String(error)}`);
  });
}
