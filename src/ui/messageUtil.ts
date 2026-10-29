import * as vscode from 'vscode';
import { bt } from '../i18n';

export function stripFormatFlags(command: string): string {
  return command
    .replace(/--format\s+"[^"]*"/g, '')
    .replace(/--format\s+'[^']*'/g, '')
    .replace(/--format=\S+/g, '')
    .replace(/--format\s+\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function showErrorWithCopy(errorMessage: string, command?: string): Promise<void> {
  const copyErrorLabel = bt('copyError');
  const copyCommandLabel = bt('copyCommand');
  const actions: string[] = [copyErrorLabel];
  if (command) {
    actions.push(copyCommandLabel);
  }
  const choice = await vscode.window.showErrorMessage(errorMessage, ...actions);
  if (choice === copyErrorLabel) {
    await vscode.env.clipboard.writeText(errorMessage);
    vscode.window.showInformationMessage(bt('errorCopied'));
  } else if (choice === copyCommandLabel && command) {
    await vscode.env.clipboard.writeText(stripFormatFlags(command));
    vscode.window.showInformationMessage(bt('commandCopied'));
  }
}
