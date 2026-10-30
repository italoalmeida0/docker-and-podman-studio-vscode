import { ChildProcess, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import { ContainerEngine, getConfig, getEngineLabel, getPodmanComposeSettingsKey } from '../config';
import { collectComposeDependencies } from './composeDependencies';
import {
  CommandResult,
  ComposeContainerStatus,
  ComposeDocument,
  ComposeProjectOptions,
  CreateContainerOptions,
  CreatePodOptions,
  DockerContextItem,
  PodmanContainer,
  PodmanDiskUsageItem,
  PodmanImage,
  PodmanMachine,
  PodmanNetwork,
  PodmanPod,
  PodmanSystemInfo,
  PodmanVolume,
  PortMapping,
  PodmanBatchAction,
  PodmanBatchItemResult,
  PodmanBatchResource,
  RemovableResource,
  ResourceRemovalTarget,
  ServiceStatus,
} from '../types';

const QUERY_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 300_000; // 5 min for pulls/builds/machine start
const POWERSHELL_PAYLOAD = 'DOCKER_PODMAN_STUDIO_SCRIPT_ARGS';
const POWERSHELL_COMMAND = [
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
  `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${POWERSHELL_PAYLOAD})) | ConvertFrom-Json;`,
  '$arguments = @($payload.args);',
  '& $payload.bin @arguments;',
  'if (-not $?) { exit 1 };',
  'if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }',
].join(' ');

function normalizeFsPath(p: string): string {
  const resolved = path.normalize(p.trim());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function parseBool(val: unknown): boolean {
  if (typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'string') {
    return val.trim().toLowerCase() === 'true';
  }
  return Boolean(val);
}

function parseLabels(raw: unknown): Record<string, string> {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  if (typeof raw === 'string') {
    const out: Record<string, string> = {};
    const parts = raw.split(/,(?=[a-zA-Z0-9_./-]+=)/);
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) {
          out[key] = val;
        }
      }
    }
    return out;
  }
  return {};
}

function parseCsvOrArray(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function stripShaPrefix(id: string): string {
  return id.replace(/^sha256:/i, '');
}

function splitCommandLine(command: string): string[] {
  const args: string[] = [];
  let token = '';
  let inToken = false;
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      } else {
        token += char;
      }
    } else if (char === '\\') {
      const next = command[i + 1];
      if (next === undefined) {
        throw new Error('Container command ends with an incomplete escape.');
      }
      if (!quote || /["\\$`]/.test(next)) {
        token += next;
        i++;
      } else {
        token += char;
      }
      inToken = true;
    } else if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else {
        token += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        args.push(token);
        token = '';
        inToken = false;
      }
    } else {
      token += char;
      inToken = true;
    }
  }

  if (quote) {
    throw new Error('Container command contains an unterminated quote.');
  }
  if (inToken) {
    args.push(token);
  }
  return args;
}

function stopTimeoutSeconds(definition: unknown): number | undefined {
  if (!definition || typeof definition !== 'object' || !('stop_grace_period' in definition)) {
    return undefined;
  }
  const raw = definition.stop_grace_period;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Compose stop_grace_period must be a duration string.');
  }
  if (raw.trim() === '0') {
    return 0;
  }
  const units: Record<string, number> = {
    h: 3600, m: 60, s: 1, ms: 0.001, us: 0.000001, ns: 0.000000001,
  };
  let seconds = 0;
  let consumed = '';
  for (const match of raw.trim().matchAll(/(\d+(?:\.\d+)?)(ms|us|ns|h|m|s)/g)) {
    consumed += match[0];
    seconds += Number(match[1]) * units[match[2]];
  }
  if (consumed !== raw.trim() || !Number.isSafeInteger(Math.ceil(seconds))) {
    throw new Error(`Unsupported Compose stop_grace_period: ${raw}`);
  }
  return Math.ceil(seconds);
}

export interface ComposeLogStream {
  process: ChildProcess;
  containerName?: string;
}

export class PodmanService {
  private readonly composeOptions = new Map<string, ComposeProjectOptions>();

  public getActiveEngine(): ContainerEngine {
    return getConfig().engine;
  }

  public isPodman(): boolean {
    return this.getActiveEngine() === 'podman';
  }

  public formatBytes(bytes: number | string | undefined): string {
    const num = typeof bytes === 'string' ? Number(bytes) : bytes ?? 0;
    if (!Number.isFinite(num) || num <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
    return `${(num / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  }

  public parseHumanSizeToBytes(sizeStr: string): number {
    const m = String(sizeStr || '')
      .trim()
      .match(/^([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/i);
    if (!m) {
      return 0;
    }
    const val = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    const mult =
      unit.startsWith('T')
        ? Math.pow(1024, 4)
        : unit.startsWith('G')
          ? Math.pow(1024, 3)
          : unit.startsWith('M')
            ? Math.pow(1024, 2)
            : unit.startsWith('K')
              ? 1024
              : 1;
    return Math.round(val * mult);
  }

  public parseStatus(
    stateRaw: string,
    statusRaw = '',
    engine = this.getActiveEngine()
  ): ServiceStatus {
    const s = `${stateRaw || ''} ${statusRaw || ''}`.toLowerCase();
    if (engine === 'podman' && s.includes('paused')) {
      return 'paused';
    }
    if (engine === 'podman' && s.includes('restarting')) {
      return 'restarting';
    }
    if (s.includes('unhealthy')) {
      return 'unhealthy';
    }
    if (s.includes('health: starting') || s.includes('starting')) {
      return 'starting';
    }
    if (s.includes('restarting')) {
      return 'restarting';
    }
    if (s.includes('stopping') || s.includes('removing') || s.includes('removal')) {
      return 'stopping';
    }
    if (
      s.includes('running') ||
      stateRaw.toLowerCase() === 'up' ||
      statusRaw.toLowerCase().startsWith('up')
    ) {
      return 'running';
    }
    if (s.includes('degraded')) {
      return 'unhealthy';
    }
    if (s.includes('exited') || s.includes('dead')) {
      return 'exited';
    }
    return 'stopped';
  }

  public parsePodmanPorts(rawPorts: any): { mappings: PortMapping[]; display: string } {
    if (!rawPorts) {
      return { mappings: [], display: '' };
    }
    if (Array.isArray(rawPorts)) {
      const mappings: PortMapping[] = rawPorts
        .filter((p) => p && (p.host_port || p.PublishedPort || p.container_port || p.TargetPort))
        .map((p) => {
          const hostPort = p.host_port ?? p.PublishedPort;
          return {
            hostIp: p.host_ip || p.HostIP || '0.0.0.0',
            host: Number(hostPort) > 0 ? String(hostPort) : '',
            container: String(p.container_port ?? p.TargetPort ?? ''),
            protocol: String(p.protocol ?? p.Protocol ?? 'tcp'),
          };
        });
      const display = mappings
        .map((m) =>
          m.host
            ? `${m.hostIp && m.hostIp !== '0.0.0.0' ? m.hostIp + ':' : ''}${m.host}->${m.container}/${m.protocol}`
            : `${m.container}/${m.protocol}`
        )
        .join(', ');
      return { mappings, display };
    }
    if (typeof rawPorts === 'string') {
      const mappings: PortMapping[] = [];
      const seen = new Set<string>();
      for (const part of rawPorts.split(',').map((x) => x.trim())) {
        const match = part.match(/(?:(\[::\]|:::|[\d.]+):)?(\d+)->(\d+)(?:\/(\w+))?/);
        if (match) {
          const host = match[2];
          const container = match[3];
          const protocol = match[4] || 'tcp';
          const dedupKey = `${host}->${container}/${protocol}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            mappings.push({
              hostIp: match[1] === ':::' || match[1] === '[::]' ? '0.0.0.0' : match[1] || '0.0.0.0',
              host,
              container,
              protocol,
            });
          }
        }
      }
      return { mappings, display: rawPorts };
    }
    return { mappings: [], display: '' };
  }

  public getEngineExecutable(engineOverride?: ContainerEngine): { bin: string; baseArgs: string[] } {
    const cfg = getConfig();
    const engine = engineOverride ?? cfg.engine;
    if (engine === 'docker') {
      const raw = cfg.dockerPath.trim() || 'docker';
      return { bin: raw, baseArgs: [] };
    }
    const raw = cfg.podmanPath.trim() || 'podman';
    if (/\s--remote$/.test(raw)) {
      const clean = raw.replace(/\s+--remote$/, '').trim();
      return { bin: clean || 'podman', baseArgs: ['--remote'] };
    }
    return { bin: raw, baseArgs: [] };
  }

  private getJsonFormatArgs(engineOverride?: ContainerEngine): string[] {
    const engine = engineOverride ?? this.getActiveEngine();
    return engine === 'docker' ? ['--format', '{{json .}}'] : ['--format', 'json'];
  }

  public runEngineCommand(
    args: string[],
    options?: { timeoutMs?: number; cwd?: string; stdin?: string; engineOverride?: ContainerEngine }
  ): Promise<CommandResult> {
    const engine = options?.engineOverride ?? this.getActiveEngine();
    const { bin, baseArgs } = this.getEngineExecutable(engine);
    const fullArgs = [...baseArgs, ...args];
    return this.spawnProcess(bin, fullArgs, {
      timeoutMs: options?.timeoutMs ?? QUERY_TIMEOUT_MS,
      cwd: options?.cwd,
      stdin: options?.stdin,
      engine,
    });
  }

  public runPodmanCommand(
    args: string[],
    options?: { timeoutMs?: number; cwd?: string; stdin?: string }
  ): Promise<CommandResult> {
    return this.runEngineCommand(args, { ...options, engineOverride: 'podman' });
  }

  public getComposeProjectOptions(composeFile: string): ComposeProjectOptions {
    const saved = this.composeOptions.get(normalizeFsPath(composeFile));
    return saved
      ? { files: [...saved.files], profiles: [...saved.profiles], envFile: saved.envFile }
      : { files: [composeFile], profiles: [] };
  }

  public validateComposeProjectOptions(
    composeFile: string,
    value: unknown,
    requireFiles = true
  ): ComposeProjectOptions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Compose project options.');
    }
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.files) || candidate.files.length === 0 ||
        !candidate.files.every((file) => typeof file === 'string' && path.isAbsolute(file)) ||
        !Array.isArray(candidate.profiles) ||
        !candidate.profiles.every((profile) =>
          typeof profile === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(profile)) ||
        (candidate.envFile !== undefined && candidate.envFile !== '' &&
          (typeof candidate.envFile !== 'string' || !path.isAbsolute(candidate.envFile)))) {
      throw new Error('Compose files and the environment file must use absolute paths; profiles must have valid names.');
    }
    const files = candidate.files as string[];
    const profiles = candidate.profiles as string[];
    const normalizedFiles = files.map(normalizeFsPath);
    if (normalizedFiles[0] !== normalizeFsPath(composeFile) ||
        new Set(normalizedFiles).size !== files.length ||
        new Set(profiles).size !== profiles.length) {
      throw new Error('The active Compose file must be first, with no duplicate files or profiles.');
    }
    const envFile = candidate.envFile ? String(candidate.envFile) : undefined;
    if (requireFiles) {
      for (const file of [...files, ...(envFile ? [envFile] : [])]) {
        if (!fs.statSync(file).isFile()) {
          throw new Error(`Not a file: ${file}`);
        }
      }
    }
    return { files: [...files], profiles: [...profiles], envFile };
  }

  public setComposeProjectOptions(
    composeFile: string,
    value: unknown,
    requireFiles = true
  ): ComposeProjectOptions {
    const options = this.validateComposeProjectOptions(composeFile, value, requireFiles);
    this.composeOptions.set(normalizeFsPath(composeFile), options);
    return this.getComposeProjectOptions(composeFile);
  }

  public hasCustomComposeProject(composeFile: string): boolean {
    const options = this.getComposeProjectOptions(composeFile);
    return options.files.length > 1 || options.profiles.length > 0 || Boolean(options.envFile) ||
      collectComposeDependencies(options).requiresResolution;
  }

  public getComposeProjectDependencies(composeFile: string, override?: ComposeProjectOptions) {
    return collectComposeDependencies(override ?? this.getComposeProjectOptions(composeFile));
  }

  public getComposeProjectWatchedFiles(composeFile: string, override?: ComposeProjectOptions): string[] {
    return this.getComposeProjectDependencies(composeFile, override).files.map((file) => file.path);
  }

  public getComposeProjectRevision(
    composeFile: string,
    override?: ComposeProjectOptions
  ): string {
    return this.getComposeProjectSnapshot(composeFile, override).revision;
  }

  public getComposeProjectSnapshot(
    composeFile: string,
    override?: ComposeProjectOptions
  ) {
    const options = override ?? this.getComposeProjectOptions(composeFile);
    const dependencies = this.getComposeProjectDependencies(composeFile, options);
    const cfg = getConfig();
    const hash = createHash('sha256');
    hash.update(JSON.stringify([
      cfg.engine, cfg.dockerPath, cfg.podmanPath, cfg.composePath,
      cfg.composeCommandStyle, cfg.inPod, options,
    ]));
    for (const file of dependencies.files) {
      let content: Buffer;
      try {
        content = fs.readFileSync(file.path);
      } catch (error) {
        if (!file.required && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          hash.update(JSON.stringify([file.path, null]));
          continue;
        }
        throw error;
      }
      hash.update(JSON.stringify([file.path, content.length]));
      hash.update(content);
    }
    return {
      options,
      dependencies,
      revision: hash.digest('hex'),
      customized: options.files.length > 1 || options.profiles.length > 0 ||
        Boolean(options.envFile) || dependencies.requiresResolution,
    };
  }

  public async resolveComposeDocument(
    composeFile: string,
    override?: ComposeProjectOptions
  ): Promise<ComposeDocument> {
    const result = await this.runComposeCommand(
      composeFile, ['config'], QUERY_TIMEOUT_MS, undefined, override
    );
    if (!result.success) {
      throw new Error(`Compose configuration: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`);
    }
    const parsed: unknown = parseYaml(result.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !('services' in parsed) || !parsed.services ||
        typeof parsed.services !== 'object' || Array.isArray(parsed.services)) {
      throw new Error('The Compose provider did not return a services mapping.');
    }
    return parsed as ComposeDocument;
  }

  private buildComposeInvocation(
    composeFile: string,
    subArgs: string[],
    projectName?: string,
    styleOverride?: 'auto' | 'plugin' | 'standalone' | 'custom',
    optionsOverride?: ComposeProjectOptions
  ): { bin: string; args: string[]; cwd: string } {
    const cfg = getConfig();
    const engine = cfg.engine;
    const style = styleOverride ?? cfg.composeCommandStyle;
    const cwd = path.dirname(composeFile);
    const options = optionsOverride ?? this.getComposeProjectOptions(composeFile);
    const globalArgs = [
      ...options.files.flatMap((file, index) => ['-f', index === 0 ? path.basename(file) : file]),
      ...options.profiles.flatMap((profile) => ['--profile', profile]),
      ...(options.envFile ? ['--env-file', options.envFile] : []),
      ...(projectName ? ['-p', projectName] : []),
    ];

    if (style === 'custom' && engine === 'docker' && cfg.composePath.trim()) {
      const parts = cfg.composePath.trim().split(/\s+/);
      return {
        bin: parts[0],
        args: [...parts.slice(1), ...globalArgs, ...subArgs],
        cwd,
      };
    }
    if (style === 'custom' && engine === 'podman') {
      if (!cfg.composePath.trim()) {
        throw new Error('A custom Compose executable path is required.');
      }
      return {
        bin: cfg.composePath.trim(),
        args: [...globalArgs, ...subArgs],
        cwd,
      };
    }

    if (engine === 'docker') {
      if (style === 'standalone') {
        const composeBin = cfg.composePath.trim() || 'docker-compose';
        return {
          bin: composeBin,
          args: [...globalArgs, ...subArgs],
          cwd,
        };
      }
      // Default ('auto' or 'plugin'): `docker compose`
      const { bin, baseArgs } = this.getEngineExecutable('docker');
      return {
        bin,
        args: [...baseArgs, 'compose', ...globalArgs, ...subArgs],
        cwd,
      };
    }

    // Podman mode
    const inPodArgs: string[] = [];
    if (cfg.inPod === 'true' || cfg.inPod === 'false') {
      inPodArgs.push('--in-pod', cfg.inPod);
    }

    if (style === 'plugin') {
      const { bin, baseArgs } = this.getEngineExecutable('podman');
      return {
        bin,
        args: [
          ...baseArgs,
          'compose',
          ...globalArgs,
          ...subArgs,
        ],
        cwd,
      };
    }

    // Default ('auto' or 'standalone') for Podman: `podman-compose`
    const composeBin = cfg.composePath.trim() || 'podman-compose';
    const podman = this.getEngineExecutable('podman');
    return {
      bin: composeBin,
      args: [
        ...inPodArgs,
        '--podman-path',
        podman.bin,
        ...podman.baseArgs.map((arg) => `--podman-args=${arg}`),
        ...globalArgs,
        ...subArgs,
      ],
      cwd,
    };
  }

  public async runComposeCommand(
    composeFile: string,
    subArgs: string[],
    timeoutMs = ACTION_TIMEOUT_MS,
    projectName?: string,
    optionsOverride?: ComposeProjectOptions
  ): Promise<CommandResult> {
    const cfg = getConfig();
    const inv = this.buildComposeInvocation(composeFile, subArgs, projectName, undefined, optionsOverride);
    const res = await this.spawnProcess(inv.bin, inv.args, {
      cwd: inv.cwd,
      timeoutMs,
      engine: cfg.engine,
    });

    // Smart fallback in 'auto' mode if standalone/plugin binary is missing
    if (!res.success && cfg.composeCommandStyle === 'auto' && !cfg.composePath.trim()) {
      const errLower = (res.stderr || '').toLowerCase();
      if (
        cfg.engine === 'podman' &&
        res.errorCode === 'ENOENT'
      ) {
        const fallback = this.buildComposeInvocation(composeFile, subArgs, projectName, 'plugin', optionsOverride);
        return this.spawnProcess(fallback.bin, fallback.args, {
          cwd: fallback.cwd, timeoutMs, engine: cfg.engine,
        });
      }
      if (cfg.engine === 'docker' && errLower.includes('is not a docker command')) {
        const fallback = this.buildComposeInvocation(composeFile, subArgs, projectName, 'standalone', optionsOverride);
        return this.spawnProcess(fallback.bin, fallback.args, {
          cwd: fallback.cwd, timeoutMs, engine: cfg.engine,
        });
      }
    }

    return res;
  }

  private getProcessInvocation(
    bin: string,
    args: string[],
    engine: ContainerEngine
  ): { bin: string; args: string[]; env?: Record<string, string> } {
    if (process.platform === 'win32' && engine === 'podman') {
      if (/\.(cmd|bat)$/i.test(bin)) {
        throw new Error(
          'Windows batch wrappers (.cmd and .bat) are not supported for Podman commands. ' +
          'Configure a native executable or a PowerShell script instead.'
        );
      }
      if (/\.ps1$/i.test(bin)) {
        // Keep script arguments out of PowerShell's command text and preserve UTF-8 output.
        return {
          bin: 'powershell.exe',
          args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', POWERSHELL_COMMAND],
          env: {
            [POWERSHELL_PAYLOAD]: Buffer.from(JSON.stringify({ bin, args }), 'utf-8').toString('base64'),
          },
        };
      }
    }
    return { bin, args };
  }

  private spawnProcess(
    bin: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number; stdin?: string; engine?: ContainerEngine }
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const cmdStr = `${bin} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
      const engine = options.engine ?? this.getActiveEngine();
      let child: ChildProcess;
      try {
        const invocation = this.getProcessInvocation(bin, args, engine);
        const useShell =
          engine !== 'podman' && process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(bin);
        child = spawn(invocation.bin, invocation.args, {
          cwd: options.cwd,
          windowsHide: true,
          shell: useShell,
          env: invocation.env ? { ...process.env, ...invocation.env } : undefined,
        });
      } catch (err: any) {
        resolve({
          success: false,
          stdout: '',
          stderr: err?.message || String(err),
          exitCode: -1,
          commandStr: cmdStr,
          errorCode: err?.code,
        });
        return;
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          success: false,
          stdout,
          stderr: `${stderr}\nExecution timed out (${Math.round(options.timeoutMs / 1000)}s).`.trim(),
          exitCode: -1,
          commandStr: cmdStr,
          errorCode: 'ETIMEDOUT',
        });
      }, options.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? -1,
          commandStr: cmdStr,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          exitCode: -1,
          commandStr: cmdStr,
          errorCode: (err as NodeJS.ErrnoException).code,
        });
      });

      if (child.stdin) {
        child.stdin.on('error', (err) => {
          stderr += `\nFailed to write to process stdin: ${err.message}`;
        });
        child.stdin.end(options.stdin);
      }
    });
  }

  private requireQuerySuccess(
    result: CommandResult,
    description: string,
    engine = this.getActiveEngine()
  ): void {
    if (!result.success && engine === 'podman') {
      throw new Error(
        `${description}: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`
      );
    }
  }

  private safeJsonArray(raw: string, engine = this.getActiveEngine()): any[] {
    const strict = engine === 'podman';
    const trimmed = (raw || '').trim();
    if (trimmed === 'null') {
      return [];
    }
    if (!trimmed) {
      if (strict) {
        throw new Error('Podman returned an empty JSON response.');
      }
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        if (strict && parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
          throw new Error('Expected an array of JSON objects.');
        }
        return parsed;
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Expected a JSON object or array.');
      }
      return [parsed];
    } catch {
      const out: any[] = [];
      for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('>>>>')) {
          continue;
        }
        try {
          const parsed = JSON.parse(l);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Expected a JSON object.');
          }
          out.push(parsed);
        } catch {
          if (strict) {
            throw new Error('Podman returned an invalid JSON response.');
          }
        }
      }
      if (strict && out.length === 0) {
        throw new Error('Podman returned an invalid JSON response.');
      }
      return out;
    }
  }

  private resourceJsonArray(raw: string, engine: ContainerEngine): any[] {
    if (engine === 'docker' && !raw.trim()) {
      return [];
    }
    try {
      return this.safeJsonArray(raw, 'podman');
    } catch (error) {
      throw new Error(`${getEngineLabel(engine)} returned invalid resource data: ${String(error)}`);
    }
  }

  // ==================== SYSTEM INFO, DF, CONTEXTS & MACHINES ====================

  private async getComposeVersionString(engine: ContainerEngine): Promise<string> {
    const cfg = getConfig();
    if (engine === 'podman') {
      const pluginVersion = async () => {
        const result = await this.runEngineCommand(['compose', 'version'], {
          timeoutMs: 8000,
          engineOverride: 'podman',
        });
        return result.success ? result.stdout.trim().split(/\r?\n/).pop() || '' : '';
      };
      if (cfg.composeCommandStyle === 'plugin') {
        return pluginVersion();
      }
      const bin = cfg.composePath.trim() ||
        (cfg.composeCommandStyle === 'custom' ? '' : 'podman-compose');
      if (!bin) {
        return '';
      }
      const result = await this.spawnProcess(bin, ['--version'], {
        timeoutMs: 8000,
        engine: 'podman',
      });
      if (result.success && result.stdout.trim()) {
        const lines = result.stdout.split(/\r?\n/).map((line) => line.trim())
          .filter((line) => line.toLowerCase().includes('compose'));
        return lines[lines.length - 1] || result.stdout.trim().split(/\r?\n/).pop() || '';
      }
      if (cfg.composeCommandStyle === 'auto' && !cfg.composePath.trim() &&
          result.errorCode === 'ENOENT') {
        return pluginVersion();
      }
      return '';
    }

    if (cfg.composePath.trim()) {
      const customRes = await this.spawnProcess(cfg.composePath.trim(), ['--version'], {
        timeoutMs: 8000,
      });
      if (customRes.success) {
        return customRes.stdout.trim().split(/\r?\n/).pop() || '';
      }
    }
    if (engine === 'docker') {
      const pluginRes = await this.runEngineCommand(['compose', 'version'], {
        timeoutMs: 8000,
        engineOverride: 'docker',
      });
      if (pluginRes.success && pluginRes.stdout.trim()) {
        return pluginRes.stdout.trim().split(/\r?\n/)[0].replace(/^Docker Compose version\s+/i, '');
      }
      const standaloneRes = await this.spawnProcess('docker-compose', ['--version'], {
        timeoutMs: 8000,
      });
      return standaloneRes.success ? standaloneRes.stdout.trim().split(/\r?\n/)[0] : '';
    }

    return '';
  }

  public async getSystemInfo(): Promise<PodmanSystemInfo> {
    const engine = this.getActiveEngine();
    const fmtArgs = this.getJsonFormatArgs(engine);

    const [infoRes, verRes, podsRes, composeVer] = await Promise.all([
      this.runEngineCommand(['info', ...fmtArgs], { engineOverride: engine }),
      this.runEngineCommand(['version', ...fmtArgs], { engineOverride: engine }),
      engine === 'podman'
        ? this.runEngineCommand(['pod', 'ls', '--format', 'json'], { engineOverride: 'podman' })
        : Promise.resolve({ success: false, stdout: '', stderr: '', exitCode: 0 }),
      this.getComposeVersionString(engine),
    ]);
    this.requireQuerySuccess(infoRes, 'Podman system information', engine);
    if (engine === 'podman') {
      this.requireQuerySuccess(verRes, 'Podman version', engine);
      this.requireQuerySuccess(podsRes, 'Podman pod list', engine);
      if (!infoRes.stdout.trim() || !verRes.stdout.trim()) {
        throw new Error('Podman returned empty system information or version output.');
      }
    }

    const info: PodmanSystemInfo = {
      engine,
      hostname: '',
      engineVersion: '',
      podmanVersion: '',
      apiVersion: '',
      composeVersion: composeVer,
      os: '',
      kernel: '',
      architecture: '',
      cpus: 0,
      memoryTotal: '0 B',
      memoryFree: '0 B',
      storageDriver: '',
      remoteSocket: '',
      containersRunning: 0,
      containersStopped: 0,
      containersPaused: 0,
      containersTotal: 0,
      images: 0,
      podsTotal: 0,
      podsRunning: 0,
    };

    if (infoRes.success && infoRes.stdout.trim()) {
      const parsed = this.safeJsonArray(infoRes.stdout, engine);
      const data = parsed[0];
      if (engine === 'podman' && !data) {
        throw new Error('Podman returned invalid system information.');
      }
      if (data && typeof data === 'object') {
        const host = data.host || {};
        const store = data.store || {};
        const cStore = store.containerStore || {};
        const iStore = store.imageStore || {};
        info.hostname = host.hostname || data.Name || '';
        info.os = host.os || data.OperatingSystem || data.OSType || '';
        info.kernel = host.kernel || data.KernelVersion || '';
        info.architecture = host.arch || data.Architecture || '';
        info.cpus = host.cpus || data.NCPU || 0;
        info.memoryTotal = this.formatBytes(host.memTotal || data.MemTotal || 0);
        info.memoryFree = this.formatBytes(host.memFree || 0);
        info.storageDriver = store.graphDriverName || data.Driver || '';
        info.remoteSocket = host.remoteSocket?.path || data.DockerRootDir || '';
        info.containersRunning = cStore.running ?? data.ContainersRunning ?? 0;
        info.containersStopped = cStore.stopped ?? data.ContainersStopped ?? 0;
        info.containersPaused = cStore.paused ?? data.ContainersPaused ?? 0;
        info.containersTotal =
          cStore.number ??
          data.Containers ??
          info.containersRunning + info.containersStopped + info.containersPaused;
        info.images = iStore.number ?? data.Images ?? 0;
        if (data.ServerVersion) {
          info.engineVersion = String(data.ServerVersion);
        }
      }
    }

    if (verRes.success && verRes.stdout.trim()) {
      const parsed = this.safeJsonArray(verRes.stdout, engine);
      const v = parsed[0];
      if (v && typeof v === 'object') {
        const ver = v.Server?.Version || v.Client?.Version || info.engineVersion || '';
        const api =
          v.Server?.ApiVersion ||
          v.Server?.APIVersion ||
          v.Client?.ApiVersion ||
          v.Client?.APIVersion ||
          '';
        info.engineVersion = String(ver);
        info.apiVersion = String(api);
      }
    }

    info.podmanVersion = info.engineVersion;
    if (engine === 'podman' && !info.engineVersion) {
      throw new Error('Podman version output did not contain a version.');
    }

    if (engine === 'podman' && podsRes.success) {
      const pods = this.safeJsonArray(podsRes.stdout, engine);
      info.podsTotal = pods.length;
      info.podsRunning = pods.filter((p) =>
        String(p.Status || '').toLowerCase().includes('running')
      ).length;
    }

    return info;
  }

  public async getDiskUsage(): Promise<PodmanDiskUsageItem[]> {
    const engine = this.getActiveEngine();
    const res = await this.runEngineCommand(['system', 'df'], { engineOverride: engine });
    this.requireQuerySuccess(res, 'Podman disk usage', engine);
    if (!res.success || !res.stdout.trim()) {
      return [];
    }
    const lines = res.stdout
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      return [];
    }
    const items: PodmanDiskUsageItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/\s{2,}/);
      if (cols.length >= 5) {
        items.push({
          type: cols[0],
          total: cols[1],
          active: cols[2],
          size: cols[3],
          reclaimable: cols.slice(4).join(' '),
        });
      }
    }
    return items;
  }

  public async listDockerContexts(): Promise<DockerContextItem[]> {
    if (this.getActiveEngine() !== 'docker') {
      return [];
    }
    const res = await this.runEngineCommand(['context', 'ls', '--format', '{{json .}}'], {
      engineOverride: 'docker',
    });
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout, 'docker').map((c) => ({
      name: String(c.Name || c.name || '').replace(/\*$/, '').trim(),
      description: String(c.Description || c.description || ''),
      dockerEndpoint: String(c.DockerEndpoint || c.dockerEndpoint || ''),
      current: parseBool(c.Current ?? c.current),
      error: c.Error ? String(c.Error) : undefined,
    }));
  }

  public async useDockerContext(name: string): Promise<CommandResult> {
    return this.runEngineCommand(['context', 'use', name.trim()], {
      engineOverride: 'docker',
      timeoutMs: 15_000,
    });
  }

  public async listMachines(): Promise<PodmanMachine[]> {
    if (!this.isPodman()) {
      return [];
    }
    const res = await this.runEngineCommand(['machine', 'list', '--format', 'json'], {
      engineOverride: 'podman',
    });
    this.requireQuerySuccess(res, 'Podman machine list', 'podman');
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout, 'podman').map((m) => ({
      name: String(m.Name || m.name || '').replace(/\*$/, ''),
      default: parseBool(m.Default ?? m.default),
      running: parseBool(m.Running ?? m.running),
      starting: parseBool(m.Starting ?? m.starting),
      vmType: String(m.VMType || m.vmtype || 'wsl'),
      cpus: Number(m.CPUs ?? m.cpus ?? 0),
      memory: this.formatBytes(m.Memory ?? m.memory ?? 0),
      diskSize: this.formatBytes(m.DiskSize ?? m.disk_size ?? 0),
      lastUp: String(m.LastUp || m.last_up || ''),
      port: m.Port ? Number(m.Port) : undefined,
    }));
  }

  public async startMachine(name?: string): Promise<CommandResult> {
    const target = name || getConfig().machineName;
    return this.runEngineCommand(['machine', 'start', target], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async stopMachine(name?: string): Promise<CommandResult> {
    const target = name || getConfig().machineName;
    return this.runEngineCommand(['machine', 'stop', target], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async restartMachine(name?: string): Promise<CommandResult> {
    const target = name || getConfig().machineName;
    const stopped = await this.stopMachine(target);
    if (!stopped.success) {
      return stopped;
    }
    return this.startMachine(target);
  }

  // ==================== PODS (Podman Native) ====================

  public async listPods(): Promise<PodmanPod[]> {
    if (!this.isPodman()) {
      return [];
    }
    const res = await this.runEngineCommand(['pod', 'ls', '--format', 'json'], {
      engineOverride: 'podman',
    });
    this.requireQuerySuccess(res, 'Podman pod list', 'podman');
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout, 'podman').map((p) => {
      const fullId = String(p.Id || p.ID || '');
      const status = String(p.Status || '');
      const containers = Array.isArray(p.Containers)
        ? p.Containers.map((c: any) => ({
            id: String(c.Id || c.ID || '').substring(0, 12),
            name: String(c.Names || c.Name || ''),
            status: String(c.Status || ''),
            restartCount: Number(c.RestartCount ?? 0),
          }))
        : [];
      return {
        id: fullId.substring(0, 12),
        fullId,
        name: String(p.Name || ''),
        status,
        state: this.parseStatus(status, '', 'podman'),
        created: String(p.Created || ''),
        infraId: String(p.InfraId || '').substring(0, 12),
        networks: parseCsvOrArray(p.Networks),
        labels: parseLabels(p.Labels),
        containers,
      };
    });
  }

  public async createPod(opts: CreatePodOptions): Promise<CommandResult> {
    const args = ['pod', 'create'];
    if (opts.name?.trim()) {
      args.push('--name', opts.name.trim());
    }
    if (opts.hostname?.trim()) {
      args.push('--hostname', opts.hostname.trim());
    }
    if (opts.network?.trim()) {
      args.push('--network', opts.network.trim());
    }
    if (opts.cpuShares?.trim()) {
      args.push('--cpu-shares', opts.cpuShares.trim());
    }
    if (opts.ports?.length) {
      for (const port of opts.ports.map((x) => x.trim()).filter(Boolean)) {
        args.push('-p', port);
      }
    }
    if (opts.additionalHosts?.length) {
      for (const h of opts.additionalHosts.map((x) => x.trim()).filter(Boolean)) {
        args.push('--add-host', h);
      }
    }
    if (opts.labels?.length) {
      for (const l of opts.labels.map((x) => x.trim()).filter(Boolean)) {
        args.push('--label', l);
      }
    }
    return this.runEngineCommand(args, {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async startPod(podId: string): Promise<CommandResult> {
    return this.runEngineCommand(['pod', 'start', podId], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async stopPod(podId: string): Promise<CommandResult> {
    return this.runEngineCommand(['pod', 'stop', podId], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async restartPod(podId: string): Promise<CommandResult> {
    return this.runEngineCommand(['pod', 'restart', podId], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async pausePod(podId: string): Promise<CommandResult> {
    return this.runEngineCommand(['pod', 'pause', podId], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async unpausePod(podId: string): Promise<CommandResult> {
    return this.runEngineCommand(['pod', 'unpause', podId], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async removePod(podId: string, force = true): Promise<CommandResult> {
    const args = ['pod', 'rm'];
    if (force) {
      args.push('-f');
    }
    args.push(podId);
    return this.runEngineCommand(args, {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async getPodLogs(podId: string, tail = 200): Promise<CommandResult> {
    const inspection = await this.runEngineCommand(['pod', 'inspect', podId, '--format', 'json'], {
      engineOverride: 'podman',
    });
    if (!inspection.success) {
      return inspection;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(inspection.stdout);
    } catch (error) {
      throw new Error(`Invalid Podman pod inspection JSON: ${String(error)}`);
    }
    const pod: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!pod || typeof pod !== 'object' || !('Containers' in pod) ||
        !Array.isArray(pod.Containers)) {
      throw new Error('Invalid Podman pod inspection: missing container list.');
    }
    const infraId = 'InfraContainerID' in pod && typeof pod.InfraContainerID === 'string'
      ? pod.InfraContainerID.toLowerCase()
      : '';
    if ('CreateInfra' in pod && pod.CreateInfra === true && !infraId) {
      throw new Error('Invalid Podman pod inspection: missing infra container ID.');
    }

    const output: string[] = [];
    const failures: string[] = [];
    let firstFailure: CommandResult | undefined;
    const containers: unknown[] = pod.Containers;
    for (const container of containers) {
      if (!container || typeof container !== 'object' ||
          !('Id' in container) || typeof container.Id !== 'string' ||
          !/^[a-f0-9]{12,64}$/i.test(container.Id)) {
        throw new Error('Invalid Podman pod inspection: invalid container ID.');
      }
      if (container.Id.toLowerCase() === infraId) {
        continue;
      }
      const name = 'Name' in container && typeof container.Name === 'string' && container.Name
        ? container.Name
        : container.Id.substring(0, 12);
      const result = await this.runEngineCommand(
        ['logs', '--tail', String(tail), container.Id],
        { engineOverride: 'podman' }
      );
      const appendLines = (text: string) => {
        if (text) {
          output.push(text.replace(/\r\n/g, '\n').replace(/\n$/, '')
            .split('\n').map((line) => `[${name}] ${line}`).join('\n'));
        }
      };
      appendLines(result.stdout);
      if (result.success) {
        appendLines(result.stderr);
      } else {
        firstFailure ??= result;
        failures.push(`${name}: ${(result.stderr || `exit code ${result.exitCode}`).trim()}`);
      }
    }
    if (firstFailure) {
      return {
        success: false,
        stdout: output.join('\n'),
        stderr: failures.join('\n'),
        exitCode: firstFailure.exitCode,
        commandStr: firstFailure.commandStr,
      };
    }
    return { success: true, stdout: output.join('\n'), stderr: '', exitCode: 0 };
  }

  // ==================== CONTAINERS ====================

  public async listAllContainers(): Promise<PodmanContainer[]> {
    const engine = this.getActiveEngine();
    const res = await this.runEngineCommand(['ps', '-a', '--no-trunc', ...this.getJsonFormatArgs(engine)], {
      engineOverride: engine,
    });
    if (!res.success) {
      throw new Error(`Container list: ${(res.stderr || res.stdout || `exit code ${res.exitCode}`).trim()}`);
    }
    return this.resourceJsonArray(res.stdout, engine).map((n) => {
      const fullId = stripShaPrefix(String(n.Id || n.ID || ''));
      if (engine === 'podman' && !/^[a-f0-9]{12,64}$/i.test(fullId)) {
        throw new Error('Podman container list returned an invalid container ID.');
      }
      const rawNames = n.Names ?? n.Name ?? '';
      const nameStr = Array.isArray(rawNames)
        ? String(rawNames[0] || fullId.substring(0, 12))
        : String(rawNames)
            .split(',')[0]
            .trim()
            .replace(/^\//, '');

      const labels = parseLabels(n.Labels);
      const composeProject =
        labels['com.docker.compose.project'] || labels['io.podman.compose.project'] || '';
      const composeService =
        labels['com.docker.compose.service'] || labels['io.podman.compose.service'] || '';
      const replica = Number(labels['com.docker.compose.container-number']);
      const workDir = labels['com.docker.compose.project.working_dir'] || '';
      const cfgFile = labels['com.docker.compose.project.config_files'] || '';
      const composeFiles = cfgFile
        .split(',')
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => path.isAbsolute(file) ? file : workDir ? path.join(workDir, file) : file);
      const composeFile = composeFiles[0] || '';

      const { mappings, display } = this.parsePodmanPorts(n.Ports);
      const statusStr = String(n.Status || n.State || '');
      const stateStr = String(n.State || '');
      const state = this.parseStatus(stateStr, statusStr, engine);
      const healthMatch = statusStr.match(/\((healthy|unhealthy|health:\s*starting)\)/i);
      const health = typeof n.Health === 'string' && n.Health
        ? n.Health : healthMatch?.[1];
      const exitMatch = statusStr.match(/\bexited\s*\((-?\d+)\)/i);
      const rawExitCode = n.ExitCode ?? n.ExitCodeValue ?? exitMatch?.[1];
      const exitCode = state === 'exited' && rawExitCode !== undefined &&
        Number.isSafeInteger(Number(rawExitCode)) ? Number(rawExitCode) : undefined;

      return {
        id: fullId.substring(0, 12),
        fullId,
        name: nameStr,
        image: String(n.Image || ''),
        imageId: stripShaPrefix(String(n.ImageID || '')).substring(0, 12),
        status: statusStr || stateStr,
        state,
        health,
        exitCode,
        ports: display,
        portMappings: mappings,
        created: String(n.CreatedAt || n.RunningFor || ''),
        podId: String(n.Pod || '').substring(0, 12),
        podName: String(n.PodName || ''),
        isCompose: Boolean(composeProject),
        composeProject,
        composeService,
        composeReplica: Number.isSafeInteger(replica) && replica > 0 ? replica : undefined,
        composeFile,
        composeFiles,
        networks: parseCsvOrArray(n.Networks),
        mounts: parseCsvOrArray(n.Mounts),
        command: Array.isArray(n.Command)
          ? n.Command.join(' ')
          : String(n.Command || '').replace(/^"|"$/g, ''),
        isInfra: parseBool(n.IsInfra),
      };
    });
  }

  public async createContainer(opts: CreateContainerOptions): Promise<CommandResult> {
    const engine = this.getActiveEngine();
    if (!opts.image?.trim()) {
      throw new Error('An image is required to create a container.');
    }
    if (engine === 'podman' && opts.pod?.trim() && opts.ports?.some((port) => port.trim())) {
      throw new Error('Publish ports on the pod instead of on a container attached to that pod.');
    }
    const args = ['run', '-d'];
    if (opts.name?.trim()) {
      args.push('--name', opts.name.trim());
    }
    if (engine === 'podman' && opts.pod?.trim()) {
      args.push('--pod', opts.pod.trim());
    }
    if (opts.network?.trim() && !(engine === 'podman' && opts.pod?.trim())) {
      args.push('--network', opts.network.trim());
    }
    if (opts.restart?.trim()) {
      args.push('--restart', opts.restart.trim());
    }
    if (opts.cpus?.trim()) {
      args.push(`--cpus=${opts.cpus.trim()}`);
    }
    if (opts.memory?.trim()) {
      args.push('-m', opts.memory.trim());
    }
    if (opts.ports?.length) {
      for (const p of opts.ports.map((x) => x.trim()).filter(Boolean)) {
        args.push('-p', p);
      }
    }
    if (opts.volumes?.length) {
      for (const v of opts.volumes.map((x) => x.trim()).filter(Boolean)) {
        args.push('-v', v);
      }
    }
    if (opts.env?.length) {
      for (const e of opts.env.map((x) => x.trim()).filter(Boolean)) {
        args.push('-e', e);
      }
    }
    if (opts.mounts?.length) {
      for (const m of opts.mounts.map((x) => x.trim()).filter(Boolean)) {
        args.push('--mount', m);
      }
    }
    args.push(opts.image.trim());
    if (opts.command?.trim()) {
      const cmdParts = engine === 'podman'
        ? splitCommandLine(opts.command.trim())
        : opts.command.trim().split(/\s+/);
      args.push(...cmdParts);
    }
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: engine });
  }

  public async startContainer(id: string): Promise<CommandResult> {
    return this.runEngineCommand(['container', 'start', id], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async stopContainer(id: string): Promise<CommandResult> {
    return this.runEngineCommand(['container', 'stop', id], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async restartContainer(id: string): Promise<CommandResult> {
    return this.runEngineCommand(['container', 'restart', id], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async pauseContainer(id: string): Promise<CommandResult> {
    return this.runEngineCommand(['container', 'pause', id], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async unpauseContainer(id: string): Promise<CommandResult> {
    return this.runEngineCommand(['container', 'unpause', id], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: 'podman',
    });
  }

  public async runPodmanBatch(
    resource: PodmanBatchResource,
    action: PodmanBatchAction,
    ids: string[]
  ): Promise<PodmanBatchItemResult[]> {
    if (!this.isPodman()) {
      throw new Error('Batch operations require Podman to be the active engine.');
    }
    if (
      (resource !== 'container' && resource !== 'pod') ||
      (action !== 'start' && action !== 'stop' && action !== 'restart') ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{12,64}$/i.test(id))
    ) {
      throw new Error('Invalid Podman batch operation or resource IDs.');
    }

    const uniqueIds = Array.from(new Set(ids.map((id) => id.toLowerCase())));
    const available =
      resource === 'container' ? await this.listAllContainers() : await this.listPods();
    const targets = new Map(
      available
        .filter((item) => resource !== 'container' || !('isInfra' in item && item.isInfra))
        .map((item) => [item.fullId.toLowerCase(), item])
    );
    if (uniqueIds.some((id) => !targets.has(id))) {
      throw new Error('A selected Podman resource no longer exists or cannot be managed. Refresh the list.');
    }

    const results: PodmanBatchItemResult[] = [];
    for (const id of uniqueIds) {
      const target = targets.get(id)!;
      const result = await this.runEngineCommand([resource, action, id], {
        timeoutMs: ACTION_TIMEOUT_MS,
        engineOverride: 'podman',
      });
      results.push({ id, name: target.name, result });
    }
    return results;
  }

  public async removeContainer(id: string, force = true): Promise<CommandResult> {
    const args = ['container', 'rm'];
    if (force) {
      args.push('-f');
    }
    args.push(id);
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async getContainerLogHistory(id: string, tail = 300): Promise<CommandResult> {
    return this.runEngineCommand(['logs', '--tail', String(tail), id]);
  }

  public streamContainerLogs(id: string, tail = 200): ChildProcess {
    const engine = this.getActiveEngine();
    const { bin, baseArgs } = this.getEngineExecutable(engine);
    const invocation = this.getProcessInvocation(
      bin, [...baseArgs, 'logs', '-f', '--timestamps', '--tail', String(tail), id], engine
    );
    return spawn(invocation.bin, invocation.args, {
      windowsHide: true,
      env: invocation.env ? { ...process.env, ...invocation.env } : undefined,
    });
  }

  public openContainerTerminal(containerId: string, label?: string): void {
    const engine = this.getActiveEngine();
    const { bin, baseArgs } = this.getEngineExecutable(engine);
    const engineLabel = getEngineLabel(engine);
    if (engine === 'docker') {
      const term = vscode.window.createTerminal(`${engineLabel}: ${label || containerId}`);
      term.sendText(`${[bin, ...baseArgs].join(' ')} exec -it ${containerId} /bin/sh`);
      term.show();
      return;
    }
    const invocation = this.getProcessInvocation(
      bin, [...baseArgs, 'exec', '-it', containerId, '/bin/sh'], engine
    );
    const term = vscode.window.createTerminal({
      name: `${engineLabel}: ${label || containerId}`,
      shellPath: invocation.bin,
      shellArgs: invocation.args,
      env: invocation.env,
    });
    term.show();
  }

  public async openLogsExternal(
    containerId: string,
    label?: string,
    mode?: 'outputChannel' | 'terminal'
  ): Promise<void> {
    const targetMode =
      mode || (getConfig().logsOutput === 'terminal' ? 'terminal' : 'outputChannel');
    const engine = this.getActiveEngine();
    const { bin, baseArgs } = this.getEngineExecutable(engine);
    const engineLabel = getEngineLabel(engine);

    if (targetMode === 'terminal') {
      if (engine === 'docker') {
        const term = vscode.window.createTerminal(`${engineLabel} Logs: ${label || containerId}`);
        term.sendText(`${[bin, ...baseArgs].join(' ')} logs -f ${containerId}`);
        term.show();
        return;
      }
      const invocation = this.getProcessInvocation(
        bin, [...baseArgs, 'logs', '-f', containerId], engine
      );
      const term = vscode.window.createTerminal({
        name: `${engineLabel} Logs: ${label || containerId}`,
        shellPath: invocation.bin,
        shellArgs: invocation.args,
        env: invocation.env,
      });
      term.show();
      return;
    }
    const res = await this.getContainerLogHistory(containerId, 500);
    if (!res.success) {
      throw new Error(res.stderr || `Failed to read container logs: ${containerId}`);
    }
    const channel = vscode.window.createOutputChannel(
      `${engineLabel} Logs: ${label || containerId}`
    );
    channel.appendLine(`--- ${engineLabel} container logs: ${label || containerId} ---`);
    if (res.stdout) {
      channel.appendLine(res.stdout);
    }
    if (res.stderr) {
      channel.appendLine(res.stderr);
    }
    channel.show(true);
  }

  // ==================== IMAGES & PRUNE ====================

  public async listImages(knownContainers?: PodmanContainer[]): Promise<PodmanImage[]> {
    const engine = this.getActiveEngine();
    const [res, containers] = await Promise.all([
      this.runEngineCommand(['images', '--no-trunc', ...this.getJsonFormatArgs(engine)], {
        engineOverride: engine,
      }),
      knownContainers ? Promise.resolve(knownContainers) : this.listAllContainers(),
    ]);
    if (!res.success) {
      throw new Error(`Image list: ${(res.stderr || res.stdout || `exit code ${res.exitCode}`).trim()}`);
    }

    const items: PodmanImage[] = [];
    for (const img of this.resourceJsonArray(res.stdout, engine)) {
      const rawId = String(img.Id || img.ID || '');
      const cleanId = stripShaPrefix(rawId);
      const shortId = cleanId.substring(0, 12);
      const names: string[] = Array.isArray(img.Names) ? img.Names.map(String) : [];
      let repository = String(img.Repository || '');
      let tag = String(img.Tag || '');
      if ((!repository || repository === '<none>') && names.length > 0) {
        const first = names[0];
        const lastColon = first.lastIndexOf(':');
        const lastSlash = first.lastIndexOf('/');
        if (lastColon > lastSlash) {
          repository = first.slice(0, lastColon);
          tag = first.slice(lastColon + 1);
        } else {
          repository = first;
          tag = 'latest';
        }
      }
      if (!repository) {
        repository = '<none>';
      }
      if (!tag) {
        tag = '<none>';
      }

      const sizeBytes =
        typeof img.Size === 'number'
          ? img.Size
          : this.parseHumanSizeToBytes(String(img.Size || ''));
      const sizeDisplay =
        typeof img.Size === 'string' && img.Size.trim()
          ? img.Size.trim()
          : this.formatBytes(sizeBytes);

      let usedCount = Number(img.Containers);
      if (!Number.isFinite(usedCount)) {
        const fullRef = `${repository}:${tag}`;
        const shortRepo = repository.replace(/^(docker\.io\/library\/|docker\.io\/)/, '');
        const shortRef = `${shortRepo}:${tag}`;
        usedCount = containers.filter(
          (c) =>
            (c.imageId && c.imageId === shortId) ||
            c.image === fullRef ||
            c.image === shortRef ||
            (tag === 'latest' && (c.image === repository || c.image === shortRepo)) ||
            c.image === shortId
        ).length;
      }

      const dangling =
        parseBool(img.Dangling) || (repository === '<none>' && tag === '<none>');

      items.push({
        id: shortId,
        fullId: rawId || shortId,
        repository,
        tag,
        names:
          names.length > 0
            ? names
            : repository !== '<none>'
              ? [`${repository}:${tag}`]
              : [],
        size: sizeDisplay,
        sizeBytes,
        created: String(img.CreatedAt || img.CreatedSince || ''),
        containers: usedCount,
        inUse: usedCount > 0,
        dangling,
        digest: String(img.Digest && img.Digest !== '<none>' ? img.Digest : ''),
      });
    }
    return items;
  }

  public async pullImage(imageName: string): Promise<CommandResult> {
    return this.runEngineCommand(['pull', imageName.trim()], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async buildImage(
    dockerfilePath: string,
    imageTag: string,
    contextDir?: string
  ): Promise<CommandResult> {
    let ctx = contextDir?.trim() || path.dirname(dockerfilePath);
    let file = dockerfilePath;
    if (this.isPodman()) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const root = workspaceRoot || (path.isAbsolute(file) ? path.dirname(file) : undefined);
      if (!path.isAbsolute(ctx) && !root) {
        throw new Error('Open a workspace or provide an absolute build context path.');
      }
      ctx = path.resolve(root || ctx, ctx);
      file = path.isAbsolute(file) ? file : path.resolve(ctx, file);
    }
    return this.runEngineCommand(
      ['build', '-t', imageTag.trim(), '-f', file, ctx],
      { timeoutMs: ACTION_TIMEOUT_MS, cwd: ctx }
    );
  }

  public async pushImage(sourceImage: string, targetTag?: string): Promise<CommandResult> {
    const src = sourceImage.trim();
    const dst = targetTag?.trim();
    if (dst && dst !== src) {
      const tagRes = await this.runEngineCommand(['tag', src, dst]);
      if (!tagRes.success) {
        return tagRes;
      }
      return this.runEngineCommand(['push', dst], { timeoutMs: ACTION_TIMEOUT_MS });
    }
    return this.runEngineCommand(['push', src], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async removeImage(
    imageId: string,
    force = this.getActiveEngine() === 'docker'
  ): Promise<CommandResult> {
    const args = ['image', 'rm'];
    if (force) {
      args.push('-f');
    }
    args.push(imageId);
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async pruneDanglingImages(): Promise<CommandResult> {
    return this.runEngineCommand(['image', 'prune', '-f'], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async pruneAllUnusedImages(): Promise<CommandResult> {
    return this.runEngineCommand(['image', 'prune', '-a', '-f'], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async pruneBuilderCache(): Promise<CommandResult> {
    if (this.isPodman()) {
      const help = await this.runEngineCommand(['image', 'prune', '--help']);
      if (!help.success) {
        return help;
      }
      if (!help.stdout.includes('--build-cache')) {
        return {
          success: false,
          stdout: '',
          stderr: 'This Podman version does not support image prune --build-cache.',
          exitCode: 1,
        };
      }
      return this.runEngineCommand(['image', 'prune', '--build-cache', '-f'], {
        timeoutMs: ACTION_TIMEOUT_MS,
      });
    }
    return this.runEngineCommand(['builder', 'prune', '-a', '-f'], {
      timeoutMs: ACTION_TIMEOUT_MS,
    });
  }

  // ==================== VOLUMES ====================

  public async listVolumes(): Promise<PodmanVolume[]> {
    const engine = this.getActiveEngine();
    const format = this.getJsonFormatArgs(engine);
    const [res, unused] = await Promise.all([
      this.runEngineCommand(['volume', 'ls', ...format], { engineOverride: engine }),
      this.runEngineCommand(
        ['volume', 'ls', '--filter', 'dangling=true', ...format],
        { engineOverride: engine }
      ),
    ]);
    for (const [result, description] of [[res, 'Volume list'], [unused, 'Unused volume list']] as const) {
      if (!result.success) {
        throw new Error(`${description}: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`);
      }
    }
    const listed = this.resourceJsonArray(res.stdout, engine);
    const unusedNames = new Set(
      this.resourceJsonArray(unused.stdout, engine).map((v) => String(v.Name || v.name || ''))
    );
    const details = new Map<string, Record<string, unknown>>();
    if (engine === 'docker' && listed.length) {
      const names = listed.map((volume) => String(volume.Name || volume.name || ''));
      if (names.some((name) => !name)) {
        throw new Error('Docker volume list returned a volume without a name.');
      }
      for (let index = 0; index < names.length; index += 100) {
        const inspected = await this.runEngineCommand(
          ['volume', 'inspect', '--', ...names.slice(index, index + 100)],
          { engineOverride: engine }
        );
        if (!inspected.success) {
          throw new Error(`Volume inspection: ${(inspected.stderr || inspected.stdout || `exit code ${inspected.exitCode}`).trim()}`);
        }
        for (const volume of this.resourceJsonArray(inspected.stdout, engine)) {
          details.set(String(volume.Name || ''), volume);
        }
      }
      if (names.some((name) => !details.has(name))) {
        throw new Error('Docker volume inspection did not return every listed volume.');
      }
    }
    return listed.map((listedVolume) => {
      const v = engine === 'docker' ? details.get(String(listedVolume.Name || listedVolume.name)) : listedVolume;
      if (!v) {
        throw new Error('Docker volume inspection did not return every listed volume.');
      }
      const labels = parseLabels(v.Labels);
      const name = String(v.Name || v.name || '');
      const isHex64 = /^[a-f0-9]{64}$/i.test(name);
      return {
        name,
        driver: String(v.Driver || v.driver || 'local'),
        mountpoint: String(v.Mountpoint || v.mountpoint || ''),
        created: String(v.CreatedAt || v.created_at || ''),
        scope: String(v.Scope || v.scope || 'local'),
        anonymous: parseBool(v.Anonymous) || isHex64,
        composeProject:
          labels['com.docker.compose.project'] || labels['io.podman.compose.project'] || '',
        labels,
        usage: unusedNames.has(name) ? 'unused' : 'inUse',
      };
    });
  }

  public async createVolume(
    name: string,
    driver?: string,
    labels?: string[]
  ): Promise<CommandResult> {
    const args = ['volume', 'create'];
    if (driver?.trim()) {
      args.push('--driver', driver.trim());
    }
    if (labels?.length) {
      for (const l of labels.map((x) => x.trim()).filter(Boolean)) {
        args.push('--label', l);
      }
    }
    args.push(name.trim());
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async removeVolume(
    name: string,
    force = this.getActiveEngine() === 'docker'
  ): Promise<CommandResult> {
    const args = ['volume', 'rm'];
    if (force) {
      args.push('-f');
    }
    args.push(name);
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async pruneVolumes(): Promise<CommandResult> {
    return this.runEngineCommand(['volume', 'prune', '--all', '-f'], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  // ==================== NETWORKS ====================

  public async listNetworks(): Promise<PodmanNetwork[]> {
    const engine = this.getActiveEngine();
    const format = this.getJsonFormatArgs(engine);
    const [res, usage, info] = await Promise.all([
      this.runEngineCommand(['network', 'ls', '--no-trunc', ...format], { engineOverride: engine }),
      engine === 'podman'
        ? this.runEngineCommand(
            ['network', 'ls', '--no-trunc', '--filter', 'dangling=true', ...format],
            { engineOverride: engine }
          )
        : this.runEngineCommand(
            ['ps', '-a', ...format],
            { engineOverride: engine }
          ),
      engine === 'podman'
        ? this.runEngineCommand(['info', '--format', 'json'], { engineOverride: engine })
        : Promise.resolve(undefined),
    ]);
    for (const [result, description] of [[res, 'Network list'], [usage, 'Network usage list']] as const) {
      if (!result.success) {
        throw new Error(`${description}: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`);
      }
    }
    if (info && !info.success) {
      throw new Error(`Podman network configuration: ${(info.stderr || info.stdout || `exit code ${info.exitCode}`).trim()}`);
    }
    const defaultNetwork = info
      ? String(this.safeJsonArray(info.stdout, engine)[0]?.host?.networkBackendInfo?.defaultNetwork || '')
      : '';
    if (engine === 'podman' && !defaultNetwork) {
      throw new Error('Podman did not report its default network; network removal is unavailable.');
    }
    const listed = this.resourceJsonArray(res.stdout, engine);
    const usageItems = this.resourceJsonArray(usage.stdout, engine);
    const unusedNames = new Set<string>();
    if (engine === 'podman') {
      for (const network of usageItems) {
        unusedNames.add(String(network.name || network.Name || ''));
      }
    } else {
      const referenced = new Set<string>();
      for (const container of usageItems) {
        if (typeof container.Networks !== 'string' && !Array.isArray(container.Networks)) {
          throw new Error('Docker container list did not report network references.');
        }
        for (const name of parseCsvOrArray(container.Networks)) referenced.add(name);
      }
      const ids = listed.map((network) => String(network.ID || network.Id || network.id || ''));
      if (ids.some((id) => !id)) {
        throw new Error('Docker network list returned a network without an ID.');
      }
      const inspected = new Map<string, Record<string, unknown>>();
      for (let index = 0; index < ids.length; index += 100) {
        const result = await this.runEngineCommand(
          ['network', 'inspect', '--', ...ids.slice(index, index + 100)],
          { engineOverride: engine }
        );
        if (!result.success) {
          throw new Error(`Network inspection: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`);
        }
        for (const network of this.resourceJsonArray(result.stdout, engine)) {
          inspected.set(String(network.Id || network.ID || ''), network);
        }
      }
      for (const network of listed) {
        const id = String(network.ID || network.Id || network.id || '');
        const details = inspected.get(id);
        if (!details || !Object.prototype.hasOwnProperty.call(details, 'Containers') ||
            (details.Containers !== null &&
              (typeof details.Containers !== 'object' || Array.isArray(details.Containers)))) {
          throw new Error('Docker network inspection did not report all network attachments.');
        }
        const name = String(network.Name || network.name || '');
        if (!referenced.has(name) && Object.keys(details.Containers || {}).length === 0) {
          unusedNames.add(name);
        }
      }
    }
    return listed.map((n) => {
      const labels = parseLabels(n.labels ?? n.Labels);
      const rawSubnets = Array.isArray(n.subnets)
        ? n.subnets
        : Array.isArray(n.Subnets)
          ? n.Subnets
          : [];
      const name = String(n.name || n.Name || '');
      const driver = String(n.driver || n.Driver || 'bridge');
      const isDockerCustomBridge =
        engine === 'docker' &&
        driver === 'bridge' &&
        name !== 'bridge' &&
        name !== 'host' &&
        name !== 'none';
      const fullId = stripShaPrefix(String(n.id || n.ID || n.Id || ''));

      return {
        id: fullId.substring(0, 12),
        fullId,
        name,
        driver,
        networkInterface: String(n.network_interface || n.NetworkInterface || ''),
        created: String(n.created || n.Created || n.CreatedAt || ''),
        subnets: rawSubnets.map((s: any) => ({
          subnet: String(s.subnet || s.Subnet || ''),
          gateway: String(s.gateway || s.Gateway || ''),
        })),
        dnsEnabled: parseBool(n.dns_enabled ?? n.DNSEnabled) || isDockerCustomBridge,
        internal: parseBool(n.internal ?? n.Internal),
        ipv6Enabled: parseBool(n.ipv6_enabled ?? n.IPv6Enabled ?? n.IPv6),
        composeProject:
          labels['com.docker.compose.project'] || labels['io.podman.compose.project'] || '',
        usage: unusedNames.has(name) ? 'unused' : 'inUse',
        protected: ['podman', 'bridge', 'host', 'none', defaultNetwork].includes(name) ||
          (engine === 'docker' && String(n.Scope || n.scope || 'local') !== 'local'),
      };
    });
  }

  public async createNetwork(opts: {
    name: string;
    driver?: string;
    subnet?: string;
    internal?: boolean;
    ipv6?: boolean;
  }): Promise<CommandResult> {
    const args = ['network', 'create'];
    if (opts.driver?.trim()) {
      args.push('--driver', opts.driver.trim());
    }
    if (opts.subnet?.trim()) {
      args.push('--subnet', opts.subnet.trim());
    }
    if (opts.internal) {
      args.push('--internal');
    }
    if (opts.ipv6) {
      args.push('--ipv6');
    }
    args.push(opts.name.trim());
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async removeNetwork(
    name: string,
    force = this.getActiveEngine() === 'docker'
  ): Promise<CommandResult> {
    const engine = this.getActiveEngine();
    const args = ['network', 'rm'];
    if (force && engine === 'podman') {
      args.push('-f');
    }
    args.push(name);
    return this.runEngineCommand(args, { timeoutMs: ACTION_TIMEOUT_MS });
  }

  public async removeResourceSelection(
    resource: RemovableResource,
    requested: ResourceRemovalTarget[],
    expectedEngine: ContainerEngine
  ): Promise<PodmanBatchItemResult[]> {
    const cfg = getConfig();
    const contextKey = () => {
      const current = getConfig();
      return JSON.stringify([
        current.engine,
        current.engine === 'podman' ? current.podmanPath : current.dockerPath,
      ]);
    };
    const initialContext = contextKey();
    if (cfg.engine !== expectedEngine ||
        !['image', 'volume', 'network'].includes(resource) ||
        !Array.isArray(requested) || requested.length === 0 ||
        requested.some((item) =>
          !item || typeof item.name !== 'string' || typeof item.identity !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(item.name) ||
          !item.identity ||
          (resource !== 'volume' && !/^[a-f0-9]{64}$/i.test(stripShaPrefix(item.identity)))
        )) {
      throw new Error('Invalid resource selection or active engine changed. Refresh and try again.');
    }

    const targets = new Map<string, ResourceRemovalTarget>();
    for (const item of requested) {
      const previous = targets.get(item.name);
      if (previous && previous.identity !== item.identity) {
        throw new Error('The selected resources have conflicting identities. Refresh and try again.');
      }
      targets.set(item.name, item);
    }

    const available: ResourceRemovalTarget[] = resource === 'image'
      ? (await this.listImages()).map((image) => ({
          name: image.dangling ? image.fullId : `${image.repository}:${image.tag}`,
          identity: image.fullId,
        }))
      : resource === 'volume'
        ? (await this.listVolumes()).filter((volume) => volume.usage === 'unused')
            .map((volume) => ({ name: volume.name, identity: volume.created }))
        : (await this.listNetworks())
            .filter((network) => network.usage === 'unused' && !network.protected)
            .map((network) => ({ name: network.name, identity: network.fullId }));
    if (contextKey() !== initialContext) {
      throw new Error('The active engine or executable changed. Refresh and try again.');
    }
    const availableByName = new Map(available.map((item) => [item.name, item.identity]));
    if ([...targets.values()].some((item) =>
      !availableByName.has(item.name) || availableByName.get(item.name) !== item.identity
    )) {
      throw new Error('A selected resource changed, is in use, or is protected. Refresh and try again.');
    }

    const results: PodmanBatchItemResult[] = [];
    for (const item of targets.values()) {
      const fail = (message: string): void => {
        results.push({
          id: item.name,
          name: item.name,
          result: { success: false, stdout: '', stderr: message, exitCode: 1 },
        });
      };
      if (contextKey() !== initialContext) {
        fail('The active engine or executable changed; this resource was not removed.');
        continue;
      }
      if (resource !== 'network') {
        const inspected = await this.runEngineCommand([resource, 'inspect', '--', item.name], {
          engineOverride: expectedEngine,
        });
        if (!inspected.success) {
          fail(`Could not recheck this resource: ${(inspected.stderr || inspected.stdout || `exit code ${inspected.exitCode}`).trim()}`);
          continue;
        }
        let current: Record<string, unknown>[];
        try {
          current = this.resourceJsonArray(inspected.stdout, expectedEngine);
        } catch (error) {
          fail(`Could not recheck this resource: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const inspectedIdentity = resource === 'volume'
          ? String(current[0]?.CreatedAt || current[0]?.created_at || '')
          : stripShaPrefix(String(current[0]?.Id || current[0]?.ID || '')).toLowerCase();
        const expectedIdentity = resource === 'volume'
          ? item.identity
          : stripShaPrefix(item.identity).toLowerCase();
        if (current.length !== 1 || inspectedIdentity !== expectedIdentity ||
            (resource === 'volume' && String(current[0]?.Name || current[0]?.name || '') !== item.name)) {
          fail('The resource changed after confirmation and was not removed.');
          continue;
        }
        if (contextKey() !== initialContext) {
          fail('The active engine or executable changed; this resource was not removed.');
          continue;
        }
      }
      const target = resource === 'network' && item.identity ? item.identity : item.name;
      const result = await this.runEngineCommand([resource, 'rm', '--', target], {
        timeoutMs: ACTION_TIMEOUT_MS,
        engineOverride: expectedEngine,
      });
      results.push({ id: item.name, name: item.name, result });
    }
    return results;
  }

  // ==================== REGISTRY AUTH ====================

  public async loginRegistry(
    registryHost: string,
    username: string,
    secret: string,
    engineOverride?: ContainerEngine
  ): Promise<CommandResult> {
    const args = ['login'];
    if (registryHost) {
      args.push(registryHost);
    }
    args.push('--username', username, '--password-stdin');
    return this.runEngineCommand(args, { stdin: secret, timeoutMs: 30_000, engineOverride });
  }

  public async logoutRegistry(
    registryHost: string,
    engineOverride?: ContainerEngine
  ): Promise<CommandResult> {
    const args = ['logout'];
    if (registryHost) {
      args.push(registryHost);
    }
    return this.runEngineCommand(args, { timeoutMs: 15_000, engineOverride });
  }

  // ==================== COMPOSE OPERATIONS ====================

  private async getPodmanComposeTargets(
    composeFile: string,
    services?: string[],
    projectName?: string,
    includeOrphans = false
  ) {
    const settingsKey = getPodmanComposeSettingsKey();
    const revision = this.getComposeProjectRevision(composeFile);
    const [resolved, current] = await Promise.all([
      this.runComposeCommand(composeFile, ['config'], QUERY_TIMEOUT_MS, projectName),
      this.composePs(composeFile, undefined, projectName),
    ]);
    this.requireQuerySuccess(resolved, 'Podman Compose configuration', 'podman');
    const parsed: unknown = parseYaml(resolved.stdout);
    if (!parsed || typeof parsed !== 'object' || !('services' in parsed) ||
        !parsed.services || typeof parsed.services !== 'object' || Array.isArray(parsed.services)) {
      throw new Error('Compose must contain a services mapping.');
    }
    const definitions: Record<string, unknown> = Object.fromEntries(Object.entries(parsed.services));
    const requested = services?.length ? services : Object.keys(definitions);
    if (requested.some((service) => !Object.prototype.hasOwnProperty.call(definitions, service))) {
      throw new Error('A requested Compose service no longer exists. Refresh the project.');
    }
    const selected = new Set(requested);
    const containers = current.filter((container) => includeOrphans || selected.has(container.service));
    const ensureUnchanged = () => {
      if (!this.isPodman() || getPodmanComposeSettingsKey() !== settingsKey ||
          this.getComposeProjectRevision(composeFile) !== revision) {
        throw new Error('Compose settings or file changed (including project files); refresh the project before retrying.');
      }
    };
    ensureUnchanged();
    if (containers.some((container) => !/^[a-f0-9]{64}$/i.test(container.fullId)) ||
        new Set(containers.map((container) => container.fullId.toLowerCase())).size !== containers.length) {
      throw new Error('Cannot safely identify the existing Compose containers.');
    }
    return { containers, definitions, selected, ensureUnchanged };
  }

  private async orderPodmanContainersForRemoval(
    containers: ComposeContainerStatus[],
    ensureUnchanged: () => void
  ): Promise<ComposeContainerStatus[]> {
    if (containers.length < 2) return containers;

    const byId = new Map(containers.map((container) => [container.fullId.toLowerCase(), container]));
    const dependencies = new Map<string, Set<string>>();
    for (let offset = 0; offset < containers.length; offset += 100) {
      ensureUnchanged();
      const batch = containers.slice(offset, offset + 100);
      const expected = new Set(batch.map((container) => container.fullId.toLowerCase()));
      const result = await this.runEngineCommand([
        'container', 'inspect', '--format', '{{.Id}} {{json .Dependencies}}',
        ...batch.map((container) => container.fullId),
      ], { timeoutMs: QUERY_TIMEOUT_MS, engineOverride: 'podman' });
      this.requireQuerySuccess(result, 'Podman Compose container dependencies', 'podman');
      ensureUnchanged();
      for (const line of result.stdout.trim().split(/\r?\n/)) {
        const match = /^([a-f0-9]{64})\s+(\[.*\]|null)$/i.exec(line.trim());
        if (!match || !expected.delete(match[1].toLowerCase())) {
          throw new Error('Podman returned invalid Compose container dependency data.');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(match[2]);
        } catch {
          throw new Error('Podman returned invalid Compose container dependency data.');
        }
        if (parsed !== null && (!Array.isArray(parsed) ||
            parsed.some((dependency) => typeof dependency !== 'string' || !/^[a-f0-9]{64}$/i.test(dependency)))) {
          throw new Error('Podman returned invalid Compose container dependency data.');
        }
        dependencies.set(match[1].toLowerCase(), new Set(
          (parsed || []).map((dependency: string) => dependency.toLowerCase()).filter((dependency: string) =>
            byId.has(dependency)
          )
        ));
      }
      if (expected.size) {
        throw new Error('Podman returned incomplete Compose container dependency data.');
      }
    }

    const dependentCounts = new Map([...byId.keys()].map((id) => [id, 0]));
    for (const prerequisites of dependencies.values()) {
      for (const prerequisite of prerequisites) {
        dependentCounts.set(prerequisite, dependentCounts.get(prerequisite)! + 1);
      }
    }
    const ready = [...byId.keys()].filter((id) => dependentCounts.get(id) === 0);
    const ordered: ComposeContainerStatus[] = [];
    for (let index = 0; index < ready.length; index++) {
      const id = ready[index];
      ordered.push(byId.get(id)!);
      for (const prerequisite of dependencies.get(id)!) {
        const count = dependentCounts.get(prerequisite)! - 1;
        dependentCounts.set(prerequisite, count);
        if (count === 0) ready.push(prerequisite);
      }
    }
    if (ordered.length !== containers.length) {
      throw new Error('Cannot safely remove Compose containers with cyclic dependencies.');
    }
    return ordered;
  }

  private async runPodmanComposeLifecycle(
    composeFile: string,
    action: 'start' | 'stop' | 'restart',
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    const targets = await this.getPodmanComposeTargets(composeFile, services, projectName);
    const servicesWithContainers = targets.containers.map((container) => container.service);
    if (!targets.containers.some((container) => (container.replica || 0) > 1) &&
        new Set(servicesWithContainers).size === servicesWithContainers.length) {
      return this.runComposeCommand(
        composeFile, [action, ...(services || [])], ACTION_TIMEOUT_MS, projectName
      );
    }

    // podman-compose expands names from YAML, so runtime-scaled replicas can be missed.
    const timeouts = new Map(
      [...targets.selected].map((service) => [
        service, action === 'start' ? undefined : stopTimeoutSeconds(targets.definitions[service]),
      ])
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    let firstFailure: CommandResult | undefined;
    for (const container of targets.containers) {
      targets.ensureUnchanged();
      const timeout = timeouts.get(container.service);
      const result = await this.runEngineCommand([
        'container', action,
        ...(timeout === undefined ? [] : ['--time', String(timeout)]),
        container.fullId,
      ], { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: 'podman' });
      if (result.stdout) stdout.push(result.stdout);
      if (result.stderr) stderr.push(`${container.name}: ${result.stderr.trim()}`);
      if (!result.success) firstFailure ??= result;
    }
    targets.ensureUnchanged();
    return {
      success: !firstFailure,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exitCode: firstFailure?.exitCode ?? 0,
      commandStr: firstFailure?.commandStr,
      errorCode: firstFailure?.errorCode,
    };
  }

  public async composeUp(
    composeFile: string,
    opts?: { build?: boolean; forceRecreate?: boolean; services?: string[]; projectName?: string }
  ): Promise<CommandResult> {
    const args = ['up', '-d'];
    if (opts?.build) {
      args.push('--build');
    }
    if (opts?.forceRecreate) {
      args.push('--force-recreate');
    }
    if (opts?.services?.length) {
      args.push(...opts.services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, opts?.projectName);
  }

  public async composeStart(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    if (this.isPodman()) {
      return this.runPodmanComposeLifecycle(composeFile, 'start', services, projectName);
    }
    const args = ['start'];
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeStop(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    if (this.isPodman()) {
      return this.runPodmanComposeLifecycle(composeFile, 'stop', services, projectName);
    }
    const args = ['stop'];
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeDown(
    composeFile: string,
    opts?: { removeVolumes?: boolean; removeOrphans?: boolean; projectName?: string }
  ): Promise<CommandResult> {
    const args = ['down'];
    if (opts?.removeVolumes) {
      args.push('-v');
    }
    if (opts?.removeOrphans) {
      args.push('--remove-orphans');
    }
    if (!this.isPodman()) {
      return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, opts?.projectName);
    }
    const targets = await this.getPodmanComposeTargets(
      composeFile, undefined, opts?.projectName, opts?.removeOrphans
    );
    const result = await this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, opts?.projectName);
    if (!result.success) {
      return result;
    }
    targets.ensureUnchanged();
    const remaining = (await this.composePs(composeFile, undefined, opts?.projectName))
      .filter((container) => opts?.removeOrphans || targets.selected.has(container.service));
    targets.ensureUnchanged();
    if (remaining.length === 0) {
      return result;
    }
    const knownIds = new Set(targets.containers.map((container) => container.fullId));
    if (remaining.some((container) => !knownIds.has(container.fullId))) {
      throw new Error('Compose containers changed during Down. Automatic cleanup was not attempted.');
    }
    const ordered = await this.orderPodmanContainersForRemoval(remaining, targets.ensureUnchanged);
    const timeouts = new Map(remaining.map((container) => [
      container.service, stopTimeoutSeconds(targets.definitions[container.service]),
    ]));
    for (const container of ordered) {
      targets.ensureUnchanged();
      const timeout = timeouts.get(container.service);
      const stopped = await this.runEngineCommand([
        'container', 'stop', ...(timeout === undefined ? [] : ['--time', String(timeout)]),
        container.fullId,
      ], { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: 'podman' });
      if (!stopped.success) {
        return stopped;
      }
    }
    targets.ensureUnchanged();
    const removed = await this.runEngineCommand(
      ['container', 'rm', ...(opts?.removeVolumes ? ['-v'] : []),
        ...ordered.map((container) => container.fullId)],
      { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: 'podman' }
    );
    if (!removed.success) {
      return removed;
    }
    targets.ensureUnchanged();
    const finished = await this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, opts?.projectName);
    if (!finished.success) {
      return finished;
    }
    targets.ensureUnchanged();
    const final = await this.composePs(composeFile, undefined, opts?.projectName);
    targets.ensureUnchanged();
    if (final.some((container) => opts?.removeOrphans || targets.selected.has(container.service))) {
      throw new Error('Compose Down did not remove all targeted containers. Refresh the project.');
    }
    return {
      ...finished,
      stdout: [result.stdout, removed.stdout, finished.stdout].filter(Boolean).join('\n'),
    };
  }

  public async composeRemoveServices(
    composeFile: string,
    services: string[],
    composeDoc?: ComposeDocument,
    expectedComposeContent?: string
  ): Promise<CommandResult> {
    const engine = this.getActiveEngine();
    if (!Array.isArray(services) || services.length === 0 ||
        services.some((service) => typeof service !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(service))) {
      throw new Error('Select at least one valid Compose service.');
    }
    if (expectedComposeContent !== undefined &&
        fs.readFileSync(composeFile, 'utf-8') !== expectedComposeContent) {
      throw new Error('The Compose file changed. Refresh and try again.');
    }
    const projectRevision = this.getComposeProjectRevision(composeFile);
    if (engine === 'podman') {
      const targets = await this.getPodmanComposeTargets(composeFile, services);
      if (this.getComposeProjectRevision(composeFile) !== projectRevision) {
        throw new Error('The Compose project changed. Refresh and try again.');
      }
      const removed: string[] = [];
      const failures: string[] = [];
      let firstFailure: CommandResult | undefined;
      const timeouts = new Map([...targets.selected].map((service) => [
        service, stopTimeoutSeconds(targets.definitions[service]),
      ]));
      const ensureUnchanged = () => {
        try {
          targets.ensureUnchanged();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(removed.length
            ? `${message}\nAlready removed: ${removed.join(', ')}`
            : message);
        }
      };
      const ordered = await this.orderPodmanContainersForRemoval(targets.containers, ensureUnchanged);
      for (const container of ordered) {
        ensureUnchanged();
        const timeout = timeouts.get(container.service);
        const stopped = await this.runEngineCommand([
          'container', 'stop', ...(timeout === undefined ? [] : ['--time', String(timeout)]),
          container.fullId,
        ], {
          timeoutMs: ACTION_TIMEOUT_MS,
          engineOverride: 'podman',
        });
        if (!stopped.success) {
          firstFailure ??= stopped;
          failures.push(`${container.name}: ${(stopped.stderr || stopped.stdout || `exit code ${stopped.exitCode}`).trim()}`);
          continue;
        }
        ensureUnchanged();
        const result = await this.runEngineCommand(['container', 'rm', container.fullId], {
          timeoutMs: ACTION_TIMEOUT_MS,
          engineOverride: 'podman',
        });
        if (result.success) {
          removed.push(container.name);
        } else {
          firstFailure ??= result;
          failures.push(`${container.name}: ${(result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()}`);
        }
      }
      ensureUnchanged();
      if (firstFailure) {
        return {
          ...firstFailure,
          stdout: removed.join('\n'),
          stderr: `${removed.length} of ${targets.containers.length} containers removed.\n${failures.join('\n')}`,
        };
      }
      const remaining = (await this.composePs(composeFile))
        .filter((container) => targets.selected.has(container.service));
      ensureUnchanged();
      if (remaining.length) {
        throw new Error('Could not verify removal of all selected Compose service containers.');
      }
      return {
        success: true,
        stdout: removed.length ? removed.join('\n') : 'No service containers to remove.',
        stderr: '',
        exitCode: 0,
      };
    }
    const initialSettings = JSON.stringify(getConfig());
    const ensureUnchanged = () => {
      if (JSON.stringify(getConfig()) !== initialSettings ||
          this.getComposeProjectRevision(composeFile) !== projectRevision) {
        throw new Error('Compose settings or file changed (including project files); refresh the project before retrying.');
      }
    };
    const statuses = await this.composePs(composeFile, composeDoc);
    ensureUnchanged();
    const targets = statuses.filter((c) => services.includes(c.service));
    if (targets.some((container) => !/^[a-f0-9]{64}$/i.test(container.fullId)) ||
        new Set(targets.map((container) => container.fullId)).size !== targets.length) {
      throw new Error('Cannot safely identify the existing Compose containers.');
    }
    if (targets.length === 0) {
      return {
        success: true,
        stdout: 'No active containers to remove for this service.',
        stderr: '',
        exitCode: 0,
      };
    }
    return this.runEngineCommand(['container', 'rm', '-f', ...targets.map((t) => t.fullId)], {
      timeoutMs: ACTION_TIMEOUT_MS,
      engineOverride: engine,
    });
  }

  public async composeRestart(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    if (this.isPodman()) {
      return this.runPodmanComposeLifecycle(composeFile, 'restart', services, projectName);
    }
    const args = ['restart'];
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeBuild(
    composeFile: string,
    services?: string[],
    projectName?: string,
    options?: { noCache?: boolean }
  ): Promise<CommandResult> {
    const args = ['build'];
    if (options?.noCache) {
      args.push('--no-cache');
    }
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeBuildUp(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    return this.composeUp(composeFile, { build: true, services, projectName });
  }

  public async composeScale(
    composeFile: string,
    service: string,
    replicas: number,
    projectName?: string,
    expectedContainerIds?: readonly string[],
    expectedComposeContent?: string
  ): Promise<CommandResult> {
    const engine = this.getActiveEngine();
    if (engine === 'podman' &&
        (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(service) ||
          !Number.isSafeInteger(replicas) || replicas < 0)) {
      throw new Error('Compose scaling requires a valid service name and a non-negative integer.');
    }
    const initialSettings = getPodmanComposeSettingsKey();
    const initialContent = engine === 'podman' ? fs.readFileSync(composeFile, 'utf-8') : undefined;
    const initialRevision = engine === 'podman' ? this.getComposeProjectRevision(composeFile) : undefined;
    if (engine === 'podman' &&
        (getConfig().engine !== 'podman' ||
          (expectedComposeContent !== undefined && expectedComposeContent !== initialContent))) {
      throw new Error('Compose settings or file changed while scaling; refresh the project before retrying.');
    }
    const ensureContextUnchanged = () => {
      if (getPodmanComposeSettingsKey() !== initialSettings ||
          this.getComposeProjectRevision(composeFile) !== initialRevision) {
        throw new Error('Compose settings or file changed while scaling; refresh the project before retrying.');
      }
    };
    let beforeIds = new Set<string>();
    if (engine === 'podman') {
      const before = (await this.composePs(composeFile, undefined, projectName))
        .filter((container) => container.service === service);
      ensureContextUnchanged();
      beforeIds = new Set(before.map((container) => container.fullId.toLowerCase()));
      if (beforeIds.size !== before.length ||
          before.some((container) => !/^[a-f0-9]{64}$/i.test(container.fullId))) {
        throw new Error('Cannot safely identify the existing Compose replicas.');
      }
      if (expectedContainerIds) {
        const expected = new Set(expectedContainerIds.map((id) => id.toLowerCase()));
        if (expected.size !== expectedContainerIds.length ||
            expected.size !== beforeIds.size ||
            [...expected].some((id) => !beforeIds.has(id))) {
          throw new Error('Compose replicas changed before scaling; refresh and try again.');
        }
      }
      if (replicas === 0) {
        if (beforeIds.size === 0) {
          return { success: true, stdout: 'No replicas to remove.', stderr: '', exitCode: 0 };
        }
        const removed = await this.runEngineCommand(
          ['container', 'rm', '-f', ...beforeIds],
          { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: 'podman' }
        );
        if (!removed.success) {
          return removed;
        }
        ensureContextUnchanged();
        const remaining = (await this.composePs(composeFile, undefined, projectName))
          .filter((container) => container.service === service);
        ensureContextUnchanged();
        if (remaining.length !== 0) {
          throw new Error('Could not verify the requested Compose replica count. Refresh the project.');
        }
        return removed;
      }
    }
    const result = await this.runComposeCommand(
      composeFile,
      ['up', '-d', '--scale', `${service}=${replicas}`, service],
      ACTION_TIMEOUT_MS,
      projectName
    );
    if (!result.success || engine !== 'podman') {
      return result;
    }
    ensureContextUnchanged();

    const current = (await this.composePs(composeFile, undefined, projectName))
      .filter((container) => container.service === service);
    ensureContextUnchanged();
    if (current.length < replicas) {
      throw new Error(`Compose created ${current.length} of ${replicas} requested replicas.`);
    }
    if (current.length === replicas) {
      return result;
    }

    const replicaNumbers = current.map((container) => container.replica);
    if (
      current.some((container) =>
        !/^[a-f0-9]{64}$/i.test(container.fullId) ||
        !beforeIds.has(container.fullId.toLowerCase()) ||
        container.replica === undefined ||
        !Number.isSafeInteger(container.replica) ||
        container.replica < 1
      ) ||
      new Set(replicaNumbers).size !== replicaNumbers.length
    ) {
      throw new Error('Cannot safely identify excess Compose replicas. Automatic cleanup was not attempted.');
    }
    const excess = [...current]
      .sort((a, b) => b.replica! - a.replica!)
      .slice(0, current.length - replicas);
    const removed = await this.runEngineCommand(
      ['container', 'rm', '-f', ...excess.map((container) => container.fullId)],
      { timeoutMs: ACTION_TIMEOUT_MS, engineOverride: 'podman' }
    );
    if (!removed.success) {
      return removed;
    }
    ensureContextUnchanged();
    const remaining = (await this.composePs(composeFile, undefined, projectName))
      .filter((container) => container.service === service);
    ensureContextUnchanged();
    if (remaining.length !== replicas) {
      throw new Error('Could not verify the requested Compose replica count. Refresh the project.');
    }
    return {
      ...result,
      stdout: [result.stdout, removed.stdout].filter(Boolean).join('\n'),
    };
  }

  private spawnComposeLogProcess(
    inv: { bin: string; args: string[]; cwd: string },
    engine: ContainerEngine
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const invocation = this.getProcessInvocation(inv.bin, inv.args, engine);
      const useShell =
        engine !== 'podman' && process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(inv.bin);
      const child = spawn(invocation.bin, invocation.args, {
        cwd: inv.cwd,
        windowsHide: true,
        shell: useShell,
        env: {
          ...process.env,
          ...(engine === 'podman' ? { PYTHONUNBUFFERED: '1' } : {}),
          ...invocation.env,
        },
      });
      child.once('spawn', () => resolve(child));
      child.once('error', reject);
    });
  }

  public async streamComposeLogs(
    composeFile: string,
    service: string,
    tail = 150,
    projectName?: string,
    containerId?: string,
    since?: string
  ): Promise<ComposeLogStream[]> {
    const cfg = getConfig();
    const historyArgs = since ? ['--since', since] : ['--tail', String(tail)];
    if (containerId) {
      const revision = this.getComposeProjectRevision(composeFile);
      const targets = cfg.engine === 'podman'
        ? await this.getPodmanComposeTargets(composeFile, [service], projectName)
        : { containers: (await this.composePs(composeFile, undefined, projectName))
          .filter((container) => container.service === service), ensureUnchanged: () => {} };
      if (this.getActiveEngine() !== cfg.engine ||
          this.getComposeProjectRevision(composeFile) !== revision) {
        throw new Error('The Compose project changed before opening replica logs.');
      }
      targets.ensureUnchanged();
      const target = targets.containers.find((container) =>
        container.fullId.toLowerCase() === containerId.toLowerCase()
      );
      if (!target || !/^[a-f0-9]{64}$/i.test(target.fullId)) {
        throw new Error('The selected Compose replica no longer exists. Refresh and try again.');
      }
      const { bin, baseArgs } = this.getEngineExecutable(cfg.engine);
      return [{
        process: await this.spawnComposeLogProcess({
          bin,
          args: [...baseArgs, 'logs', '-f', '--timestamps', ...historyArgs, target.fullId],
          cwd: path.dirname(composeFile),
        }, cfg.engine),
        containerName: target.name,
      }];
    }
    if (cfg.engine === 'podman') {
      const targets = await this.getPodmanComposeTargets(composeFile, [service], projectName);
      if (targets.containers.length > 0) {
        const { bin, baseArgs } = this.getEngineExecutable('podman');
        const results = await Promise.allSettled(targets.containers.map((container) =>
          this.spawnComposeLogProcess({
            bin,
            args: [...baseArgs, 'logs', '-f', '--timestamps', ...historyArgs, container.fullId],
            cwd: path.dirname(composeFile),
          }, 'podman')
        ));
        const started: ChildProcess[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') started.push(result.value);
        }
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') {
          started.forEach((child) => child.kill('SIGTERM'));
          throw failure.reason;
        }
        return started.map((process, index) => ({
          process, containerName: targets.containers[index].name,
        }));
      }
    }
    const args = ['logs', '-f', '--timestamps', ...historyArgs, service];
    const inv = this.buildComposeInvocation(
      composeFile,
      args,
      projectName
    );
    try {
      return [{ process: await this.spawnComposeLogProcess(inv, cfg.engine) }];
    } catch (error) {
      if (
        cfg.engine === 'podman' &&
        cfg.composeCommandStyle === 'auto' &&
        !cfg.composePath.trim() &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [{
          process: await this.spawnComposeLogProcess(
            this.buildComposeInvocation(composeFile, args, projectName, 'plugin'),
            cfg.engine
          ),
        }];
      }
      throw error;
    }
  }

  private async podmanComposeProjectStatus(
    composeFile: string,
    projectName?: string
  ): Promise<CommandResult> {
    const cfg = getConfig();
    const isPodmanCompose = (result: CommandResult) =>
      result.success &&
      /^\s*podman-compose\s+version\s+\S+/im.test(`${result.stdout}\n${result.stderr}`);
    let version: CommandResult | undefined;
    if ((cfg.composeCommandStyle === 'auto' || cfg.composeCommandStyle === 'standalone') &&
        !cfg.composePath.trim()) {
      const [detected, status] = await Promise.all([
        this.runComposeCommand(composeFile, ['version'], QUERY_TIMEOUT_MS, projectName),
        this.runComposeCommand(composeFile, ['ps', '-q'], QUERY_TIMEOUT_MS, projectName),
      ]);
      version = detected;
      if (isPodmanCompose(detected)) {
        this.requireQuerySuccess(status, 'Podman Compose project status', 'podman');
        return status;
      }
    }

    const all = await this.runComposeCommand(
      composeFile, ['ps', '--all', '-q'], QUERY_TIMEOUT_MS, projectName
    );
    if (all.success) {
      return all;
    }

    const details = `${all.stderr}\n${all.stdout}`;
    if (all.errorCode || !/unrecognized arguments?:[^\r\n]*--all/i.test(details)) {
      this.requireQuerySuccess(all, 'Podman Compose project status', 'podman');
    }

    version ??= await this.runComposeCommand(composeFile, ['version'], QUERY_TIMEOUT_MS, projectName);
    this.requireQuerySuccess(version, 'Podman Compose provider version', 'podman');
    if (!isPodmanCompose(version)) {
      throw new Error(
        'The configured Compose provider cannot safely list stopped containers: ' +
        (all.stderr || all.stdout || `exit code ${all.exitCode}`).trim()
      );
    }

    // podman-compose's ps includes stopped containers by default and rejects --all.
    const status = await this.runComposeCommand(
      composeFile, ['ps', '-q'], QUERY_TIMEOUT_MS, projectName
    );
    this.requireQuerySuccess(status, 'Podman Compose project status', 'podman');
    return status;
  }

  public async composePs(
    composeFile: string,
    composeDoc?: ComposeDocument,
    projectName?: string
  ): Promise<ComposeContainerStatus[]> {
    const podmanMode = this.isPodman();
    const [all, projectStatus] = await Promise.all([
      this.listAllContainers(),
      podmanMode
        ? this.podmanComposeProjectStatus(composeFile, projectName)
        : this.runComposeCommand(composeFile, ['ps', '--all', '-q'], QUERY_TIMEOUT_MS, projectName),
    ]);
    let projectIds: string[] | undefined;
    if (projectStatus) {
      if (!projectStatus.success) {
        throw new Error(`Compose project status: ${(projectStatus.stderr || projectStatus.stdout || `exit code ${projectStatus.exitCode}`).trim()}`);
      }
      projectIds = [];
      for (const line of projectStatus.stdout.split(/\r?\n/)) {
        const id = line.trim().replace(/^sha256:/i, '');
        if (!id || id.startsWith('>>>>')) {
          continue;
        }
        if (!/^[a-f0-9]{12,64}$/i.test(id)) {
          throw new Error('Podman Compose returned an invalid container ID.');
        }
        projectIds.push(id.toLowerCase());
      }
    }
    if (all.length === 0) {
      return [];
    }

    const normTargetFile = normalizeFsPath(composeFile);
    const expectedProjNames = new Set<string>();

    if (composeDoc?.name) {
      expectedProjNames.add(composeDoc.name.toLowerCase());
    }
    const rawDirName = path.basename(path.dirname(composeFile)).toLowerCase();
    expectedProjNames.add(rawDirName);
    expectedProjNames.add(rawDirName.replace(/[^a-z0-9_-]/g, ''));

    const containerNameToService = new Map<string, string>();
    if (composeDoc?.services) {
      for (const [svcName, def] of Object.entries(composeDoc.services)) {
        if (def && typeof def === 'object' && def.container_name) {
          containerNameToService.set(String(def.container_name), svcName);
        }
      }
    }

    const matched: ComposeContainerStatus[] = [];
    for (const c of all) {
      if (c.isInfra) {
        continue;
      }

      let isMatch = false;
      let resolvedService = c.composeService;

      const knownFiles = c.composeFiles?.length ? c.composeFiles : c.composeFile ? [c.composeFile] : [];
      if (projectIds) {
        const fullId = c.fullId.toLowerCase();
        isMatch =
          projectIds.some((id) => fullId.startsWith(id) || id.startsWith(fullId)) &&
          (knownFiles.length === 0 ||
            knownFiles.some((file) => normalizeFsPath(file) === normTargetFile));
      } else {
        if (knownFiles.some((file) => normalizeFsPath(file) === normTargetFile)) {
          isMatch = true;
        } else if (
          knownFiles.length === 0 &&
          c.composeProject &&
          expectedProjNames.has(c.composeProject.toLowerCase())
        ) {
          isMatch = true;
        } else if (knownFiles.length === 0 && !c.composeProject && containerNameToService.has(c.name)) {
          isMatch = true;
          resolvedService = containerNameToService.get(c.name) || resolvedService;
        }
      }

      if (!isMatch) {
        continue;
      }

      if (!resolvedService && containerNameToService.has(c.name)) {
        resolvedService = containerNameToService.get(c.name)!;
      }

      matched.push({
        id: c.id,
        fullId: c.fullId,
        name: c.name,
        service: resolvedService || c.name,
        replica: c.composeReplica,
        status: c.state,
        ports: c.portMappings,
        image: c.image,
        uptime: c.status,
        health: c.health,
        exitCode: c.exitCode,
        podId: c.podId || undefined,
        podName: c.podName || undefined,
      });
    }

    return matched;
  }
}
