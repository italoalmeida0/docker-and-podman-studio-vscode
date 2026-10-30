import * as vscode from 'vscode';
import { bt } from '../i18n';
import { classifyFailure } from '../shared/operationFeedback';

export function summarizeFailure(
  message: string,
  errorCode?: string,
  operation?: string,
  progress?: { completed?: number; total?: number }
): string {
  const { completed, total } = progress || {};
  if (operation && typeof completed === 'number' && Number.isInteger(completed) &&
      typeof total === 'number' && Number.isInteger(total) &&
      total > 0 && completed >= 0 && completed <= total) {
    return `${bt('opFailed', { op: operation })}. ${bt('batchPartialSummary', { completed, total })}` +
      (errorCode === 'ETIMEDOUT' ? ` ${bt('failureTimeout')}` : '');
  }
  const kind = classifyFailure(message, errorCode);
  if (kind === 'generic' && !operation && !message.includes('\n') && message.length <= 220) {
    return message;
  }
  const reason = kind === 'timeout' ? bt('failureTimeout')
    : kind === 'missingExecutable' ? bt('failureMissingExecutable')
      : kind === 'diskSpace' ? bt('failureDiskSpace')
        : kind === 'portInUse' ? bt('failurePortInUse')
          : kind === 'registryAuth' ? bt('failureRegistryAuth')
            : kind === 'permission' ? bt('failurePermission')
              : kind === 'imageNotFound' ? bt('failureImageNotFound')
                : kind === 'engineConnection' ? bt('failureEngineConnection')
                  : kind === 'network' ? bt('failureNetwork')
                    : bt('failureGeneric');
  return operation ? `${bt('opFailed', { op: operation })}. ${reason}` : reason;
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
  void Promise.resolve(vscode.window.showErrorMessage(
    summarizeFailure(errorMessage, errorCode, operation, progress), ...actions
  )).then(async (choice) => {
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
