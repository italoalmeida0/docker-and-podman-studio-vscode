import * as vscode from 'vscode';

export const CONFIG_SECTION = 'dockerPodmanStudio';
export const SECRET_KEY = 'dockerPodmanStudio.registrySecret';

export type ContainerEngine = 'docker' | 'podman';

export type SupportedLocale =
  | 'en'
  | 'pt-BR'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'ru'
  | 'uk'
  | 'pl'
  | 'tr'
  | 'nl'
  | 'ja'
  | 'ko'
  | 'zh-CN'
  | 'zh-TW'
  | 'hi';

export type LanguageSetting = 'auto' | SupportedLocale;

export interface StudioConfig {
  engine: ContainerEngine;
  language: LanguageSetting;
  dockerPath: string;
  podmanPath: string;
  composePath: string;
  composeCommandStyle: 'auto' | 'plugin' | 'standalone' | 'custom';
  inPod: 'default' | 'true' | 'false';
  machineName: string;
  pollingInterval: number;
  logBufferSize: number;
  longOperationTimeoutMinutes: number;
  autoDetectFiles: boolean;
  confirmDeletions: boolean;
  logsOutput: 'studio' | 'outputChannel' | 'terminal';
  enablePushCommand: boolean;
  pushDefaultRegistry: string;
  registryProvider: 'dockerhub' | 'quay' | 'ghcr' | 'acr' | 'ecr' | 'custom';
  registryUrl: string;
  registryAuthType: 'engineCli' | 'basic' | 'bearer';
  registryUsername: string;
  registryAutoLogin: boolean;
}

export type PodmanStudioConfig = StudioConfig;

export function getEngineLabel(engine?: ContainerEngine): string {
  const target = engine ?? getConfig().engine;
  return target === 'podman' ? 'Podman' : 'Docker';
}

export function getConfig(): StudioConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const rawEngine = cfg.get<string>('engine', 'docker');
  const engine: ContainerEngine = rawEngine === 'podman' ? 'podman' : 'docker';

  return {
    engine,
    language: cfg.get<LanguageSetting>('language', 'auto') || 'auto',
    dockerPath: cfg.get<string>('dockerPath', 'docker') || 'docker',
    podmanPath: cfg.get<string>('podmanPath', 'podman') || 'podman',
    composePath: cfg.get<string>('composePath', '') || '',
    composeCommandStyle: cfg.get<'auto' | 'plugin' | 'standalone' | 'custom'>(
      'composeCommandStyle',
      'auto'
    ),
    inPod: cfg.get<'default' | 'true' | 'false'>('inPod', 'default'),
    machineName:
      cfg.get<string>('machineName', 'podman-machine-default') || 'podman-machine-default',
    pollingInterval: cfg.get<number>('pollingInterval', 2500),
    logBufferSize: cfg.get<number>('logBufferSize', 5000),
    longOperationTimeoutMinutes: cfg.get<number>('longOperationTimeoutMinutes', 60),
    autoDetectFiles: cfg.get<boolean>('autoDetectFiles', true),
    confirmDeletions: cfg.get<boolean>('confirmDeletions', true),
    logsOutput: cfg.get<'studio' | 'outputChannel' | 'terminal'>('logsOutput', 'studio'),
    enablePushCommand: cfg.get<boolean>('enablePushCommand', true),
    pushDefaultRegistry: cfg.get<string>('pushDefaultRegistry', ''),
    registryProvider: cfg.get<'dockerhub' | 'quay' | 'ghcr' | 'acr' | 'ecr' | 'custom'>(
      'registryProvider',
      'dockerhub'
    ),
    registryUrl: cfg.get<string>('registryUrl', ''),
    registryAuthType: cfg.get<'engineCli' | 'basic' | 'bearer'>('registryAuthType', 'engineCli'),
    registryUsername: cfg.get<string>('registryUsername', ''),
    registryAutoLogin: cfg.get<boolean>('registryAutoLogin', true),
  };
}

export function getPodmanComposeSettingsKey(): string {
  const cfg = getConfig();
  return JSON.stringify([
    cfg.engine, cfg.podmanPath, cfg.composePath, cfg.composeCommandStyle, cfg.inPod,
  ]);
}

export function onConfigChange(
  listener: (e: vscode.ConfigurationChangeEvent) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CONFIG_SECTION)) {
      listener(e);
    }
  });
}

export async function resetEnginePaths(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  for (const key of ['dockerPath', 'podmanPath', 'composePath']) {
    await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
    if (vscode.workspace.workspaceFolders?.length) {
      await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    }
  }
}

export async function updateLanguageSetting(language: LanguageSetting): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update('language', language, vscode.ConfigurationTarget.Global);
  if (vscode.workspace.workspaceFolders?.length) {
    const inspected = cfg.inspect<LanguageSetting>('language');
    if (inspected?.workspaceValue !== undefined) {
      await cfg.update('language', language, vscode.ConfigurationTarget.Workspace);
    }
  }
}

export async function updateEngineSetting(engine: ContainerEngine): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update('engine', engine, vscode.ConfigurationTarget.Global);
  if (vscode.workspace.workspaceFolders?.length) {
    const inspected = cfg.inspect<ContainerEngine>('engine');
    if (inspected?.workspaceValue !== undefined) {
      await cfg.update('engine', engine, vscode.ConfigurationTarget.Workspace);
    }
  }
}
