import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ContainerEngine, getConfig, getEngineLabel } from '../config';
import {
  CommandResult,
  ComposeContainerStatus,
  ComposeDocument,
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
  ServiceStatus,
} from '../types';

const QUERY_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 300_000; // 5 min for pulls/builds/machine start

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

export class PodmanService {
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

  public parseStatus(stateRaw: string, statusRaw = ''): ServiceStatus {
    const s = `${stateRaw || ''} ${statusRaw || ''}`.toLowerCase();
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
        .map((p) => ({
          hostIp: p.host_ip || '0.0.0.0',
          host: String(p.host_port ?? p.PublishedPort ?? p.container_port ?? ''),
          container: String(p.container_port ?? p.TargetPort ?? ''),
          protocol: String(p.protocol ?? p.Protocol ?? 'tcp'),
        }));
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
    if (raw.includes(' --remote')) {
      const clean = raw.replace('--remote', '').trim();
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
    const { bin, baseArgs } = this.getEngineExecutable(options?.engineOverride);
    const fullArgs = [...baseArgs, ...args];
    return this.spawnProcess(bin, fullArgs, {
      timeoutMs: options?.timeoutMs ?? QUERY_TIMEOUT_MS,
      cwd: options?.cwd,
      stdin: options?.stdin,
    });
  }

  public runPodmanCommand(
    args: string[],
    options?: { timeoutMs?: number; cwd?: string; stdin?: string }
  ): Promise<CommandResult> {
    return this.runEngineCommand(args, options);
  }

  private buildComposeInvocation(
    composeFile: string,
    subArgs: string[],
    projectName?: string,
    styleOverride?: 'auto' | 'plugin' | 'standalone' | 'custom'
  ): { bin: string; args: string[]; cwd: string } {
    const cfg = getConfig();
    const engine = cfg.engine;
    const style = styleOverride ?? cfg.composeCommandStyle;
    const cwd = path.dirname(composeFile);
    const fileName = path.basename(composeFile);
    const proj =
      projectName ||
      path
        .basename(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') ||
      'default';

    if (style === 'custom' && cfg.composePath.trim()) {
      const parts = cfg.composePath.trim().split(/\s+/);
      return {
        bin: parts[0],
        args: [...parts.slice(1), '-f', fileName, '-p', proj, ...subArgs],
        cwd,
      };
    }

    if (engine === 'docker') {
      if (style === 'standalone') {
        const composeBin = cfg.composePath.trim() || 'docker-compose';
        return {
          bin: composeBin,
          args: ['-f', fileName, '-p', proj, ...subArgs],
          cwd,
        };
      }
      // Default ('auto' or 'plugin'): `docker compose`
      const { bin, baseArgs } = this.getEngineExecutable('docker');
      return {
        bin,
        args: [...baseArgs, 'compose', '-f', fileName, '-p', proj, ...subArgs],
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
        args: [...baseArgs, 'compose', '-f', fileName, '-p', proj, ...subArgs],
        cwd,
      };
    }

    // Default ('auto' or 'standalone') for Podman: `podman-compose`
    const composeBin = cfg.composePath.trim() || 'podman-compose';
    return {
      bin: composeBin,
      args: [...inPodArgs, '-f', fileName, '-p', proj, ...subArgs],
      cwd,
    };
  }

  public async runComposeCommand(
    composeFile: string,
    subArgs: string[],
    timeoutMs = ACTION_TIMEOUT_MS,
    projectName?: string
  ): Promise<CommandResult> {
    const cfg = getConfig();
    const inv = this.buildComposeInvocation(composeFile, subArgs, projectName);
    const res = await this.spawnProcess(inv.bin, inv.args, {
      cwd: inv.cwd,
      timeoutMs,
    });

    // Smart fallback in 'auto' mode if standalone/plugin binary is missing
    if (!res.success && cfg.composeCommandStyle === 'auto' && !cfg.composePath.trim()) {
      const errLower = (res.stderr || '').toLowerCase();
      if (
        cfg.engine === 'podman' &&
        (res.exitCode === -1 || errLower.includes('enoent') || errLower.includes('not recognized'))
      ) {
        const fallback = this.buildComposeInvocation(composeFile, subArgs, projectName, 'plugin');
        return this.spawnProcess(fallback.bin, fallback.args, { cwd: fallback.cwd, timeoutMs });
      }
      if (cfg.engine === 'docker' && errLower.includes('is not a docker command')) {
        const fallback = this.buildComposeInvocation(composeFile, subArgs, projectName, 'standalone');
        return this.spawnProcess(fallback.bin, fallback.args, { cwd: fallback.cwd, timeoutMs });
      }
    }

    return res;
  }

  private spawnProcess(
    bin: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number; stdin?: string }
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const cmdStr = `${bin} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
      const useShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(bin);
      let child: ChildProcess;
      try {
        child = spawn(bin, args, {
          cwd: options.cwd,
          windowsHide: true,
          shell: useShell,
        });
      } catch (err: any) {
        resolve({
          success: false,
          stdout: '',
          stderr: err?.message || String(err),
          exitCode: -1,
          commandStr: cmdStr,
        });
        return;
      }

      let stdout = '';
      let stderr = '';

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
        });
      });

      if (options.stdin !== undefined && child.stdin) {
        child.stdin.end(options.stdin);
      }
    });
  }

  private safeJsonArray(raw: string): any[] {
    const trimmed = (raw || '').trim();
    if (!trimmed || trimmed === 'null') {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [parsed];
    } catch {
      // Fallback: NDJSON line-by-line (standard Docker CLI JSON format)
      const out: any[] = [];
      for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('>>>>')) {
          continue;
        }
        try {
          out.push(JSON.parse(l));
        } catch {
          // ignore non-json lines
        }
      }
      return out;
    }
  }

  // ==================== SYSTEM INFO, DF, CONTEXTS & MACHINES ====================

  private async getComposeVersionString(engine: ContainerEngine): Promise<string> {
    const cfg = getConfig();
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

    const podmanComposeRes = await this.spawnProcess('podman-compose', ['--version'], {
      timeoutMs: 8000,
    });
    if (podmanComposeRes.success && podmanComposeRes.stdout.trim()) {
      const lines = podmanComposeRes.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().includes('compose'));
      return (
        lines[lines.length - 1] || podmanComposeRes.stdout.trim().split(/\r?\n/).pop() || ''
      );
    }
    const subRes = await this.runEngineCommand(['compose', 'version'], {
      timeoutMs: 8000,
      engineOverride: 'podman',
    });
    return subRes.success ? subRes.stdout.trim().split(/\r?\n/).pop() || '' : '';
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
      const parsed = this.safeJsonArray(infoRes.stdout);
      const data = parsed[0];
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
      const parsed = this.safeJsonArray(verRes.stdout);
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

    if (engine === 'podman' && podsRes.success) {
      const pods = this.safeJsonArray(podsRes.stdout);
      info.podsTotal = pods.length;
      info.podsRunning = pods.filter((p) =>
        String(p.Status || '').toLowerCase().includes('running')
      ).length;
    }

    return info;
  }

  public async getDiskUsage(): Promise<PodmanDiskUsageItem[]> {
    const res = await this.runEngineCommand(['system', 'df']);
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
    return this.safeJsonArray(res.stdout).map((c) => ({
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
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout).map((m) => ({
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
    await this.stopMachine(target);
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
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout).map((p) => {
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
        state: this.parseStatus(status),
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
    return this.runEngineCommand(['pod', 'logs', '--tail', String(tail), podId], {
      engineOverride: 'podman',
    });
  }

  // ==================== CONTAINERS ====================

  public async listAllContainers(): Promise<PodmanContainer[]> {
    const engine = this.getActiveEngine();
    const res = await this.runEngineCommand(['ps', '-a', ...this.getJsonFormatArgs(engine)], {
      engineOverride: engine,
    });
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout).map((n) => {
      const fullId = stripShaPrefix(String(n.Id || n.ID || ''));
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
      const workDir = labels['com.docker.compose.project.working_dir'] || '';
      const cfgFile = labels['com.docker.compose.project.config_files'] || '';
      let composeFile = '';
      if (cfgFile) {
        const firstCfg = cfgFile.split(',')[0].trim();
        composeFile = path.isAbsolute(firstCfg)
          ? firstCfg
          : workDir
            ? path.join(workDir, firstCfg)
            : firstCfg;
      }

      const { mappings, display } = this.parsePodmanPorts(n.Ports);
      const statusStr = String(n.Status || n.State || '');
      const stateStr = String(n.State || '');

      return {
        id: fullId.substring(0, 12),
        fullId,
        name: nameStr,
        image: String(n.Image || ''),
        imageId: stripShaPrefix(String(n.ImageID || '')).substring(0, 12),
        status: statusStr || stateStr,
        state: this.parseStatus(stateStr, statusStr),
        ports: display,
        portMappings: mappings,
        created: String(n.CreatedAt || n.RunningFor || ''),
        podId: String(n.Pod || '').substring(0, 12),
        podName: String(n.PodName || ''),
        isCompose: Boolean(composeProject),
        composeProject,
        composeService,
        composeFile,
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
      const cmdParts = opts.command.trim().split(/\s+/);
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
    const { bin, baseArgs } = this.getEngineExecutable();
    return spawn(bin, [...baseArgs, 'logs', '-f', '--tail', String(tail), id], {
      windowsHide: true,
    });
  }

  public openContainerTerminal(containerId: string, label?: string): void {
    const { bin, baseArgs } = this.getEngineExecutable();
    const engineLabel = getEngineLabel();
    const cmdPrefix = [bin, ...baseArgs].join(' ');
    const term = vscode.window.createTerminal(`${engineLabel}: ${label || containerId}`);
    term.sendText(`${cmdPrefix} exec -it ${containerId} /bin/sh`);
    term.show();
  }

  public async openLogsExternal(
    containerId: string,
    label?: string,
    mode?: 'outputChannel' | 'terminal'
  ): Promise<void> {
    const targetMode =
      mode || (getConfig().logsOutput === 'terminal' ? 'terminal' : 'outputChannel');
    const { bin, baseArgs } = this.getEngineExecutable();
    const engineLabel = getEngineLabel();
    const cmdPrefix = [bin, ...baseArgs].join(' ');

    if (targetMode === 'terminal') {
      const term = vscode.window.createTerminal(`${engineLabel} Logs: ${label || containerId}`);
      term.sendText(`${cmdPrefix} logs -f ${containerId}`);
      term.show();
      return;
    }
    const res = await this.getContainerLogHistory(containerId, 500);
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
      this.runEngineCommand(['images', ...this.getJsonFormatArgs(engine)], {
        engineOverride: engine,
      }),
      knownContainers ? Promise.resolve(knownContainers) : this.listAllContainers(),
    ]);
    if (!res.success) {
      return [];
    }

    const items: PodmanImage[] = [];
    for (const img of this.safeJsonArray(res.stdout)) {
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
    const ctx = contextDir?.trim() || path.dirname(dockerfilePath);
    return this.runEngineCommand(
      ['build', '-t', imageTag.trim(), '-f', dockerfilePath, ctx],
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

  public async removeImage(imageId: string, force = true): Promise<CommandResult> {
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
    return this.runEngineCommand(['builder', 'prune', '-a', '-f'], {
      timeoutMs: ACTION_TIMEOUT_MS,
    });
  }

  // ==================== VOLUMES ====================

  public async listVolumes(): Promise<PodmanVolume[]> {
    const engine = this.getActiveEngine();
    const res = await this.runEngineCommand(['volume', 'ls', ...this.getJsonFormatArgs(engine)], {
      engineOverride: engine,
    });
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout).map((v) => {
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
    return this.runEngineCommand(args);
  }

  public async removeVolume(name: string, force = true): Promise<CommandResult> {
    const args = ['volume', 'rm'];
    if (force) {
      args.push('-f');
    }
    args.push(name);
    return this.runEngineCommand(args);
  }

  public async pruneVolumes(): Promise<CommandResult> {
    return this.runEngineCommand(['volume', 'prune', '-f'], { timeoutMs: ACTION_TIMEOUT_MS });
  }

  // ==================== NETWORKS ====================

  public async listNetworks(): Promise<PodmanNetwork[]> {
    const engine = this.getActiveEngine();
    const res = await this.runEngineCommand(['network', 'ls', ...this.getJsonFormatArgs(engine)], {
      engineOverride: engine,
    });
    if (!res.success) {
      return [];
    }
    return this.safeJsonArray(res.stdout).map((n) => {
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

      return {
        id: stripShaPrefix(String(n.id || n.ID || n.Id || '')).substring(0, 12),
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
    return this.runEngineCommand(args);
  }

  public async removeNetwork(name: string, force = true): Promise<CommandResult> {
    const engine = this.getActiveEngine();
    const args = ['network', 'rm'];
    if (force && engine === 'podman') {
      args.push('-f');
    }
    args.push(name);
    return this.runEngineCommand(args);
  }

  // ==================== REGISTRY AUTH ====================

  public async loginRegistry(
    registryHost: string,
    username: string,
    secret: string
  ): Promise<CommandResult> {
    const args = ['login'];
    if (registryHost) {
      args.push(registryHost);
    }
    args.push('--username', username, '--password-stdin');
    return this.runEngineCommand(args, { stdin: secret, timeoutMs: 30_000 });
  }

  public async logoutRegistry(registryHost: string): Promise<CommandResult> {
    const args = ['logout'];
    if (registryHost) {
      args.push(registryHost);
    }
    return this.runEngineCommand(args, { timeoutMs: 15_000 });
  }

  // ==================== COMPOSE OPERATIONS ====================

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
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, opts?.projectName);
  }

  public async composeRemoveServices(
    composeFile: string,
    services: string[],
    composeDoc?: ComposeDocument
  ): Promise<CommandResult> {
    const statuses = await this.composePs(composeFile, composeDoc);
    const targets = statuses.filter((c) => services.includes(c.service) && c.fullId);
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
    });
  }

  public async composeRestart(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    const args = ['restart'];
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeBuild(
    composeFile: string,
    services?: string[],
    projectName?: string
  ): Promise<CommandResult> {
    const args = ['up', '--build', '-d'];
    if (services?.length) {
      args.push(...services);
    }
    return this.runComposeCommand(composeFile, args, ACTION_TIMEOUT_MS, projectName);
  }

  public async composeScale(
    composeFile: string,
    service: string,
    replicas: number,
    projectName?: string
  ): Promise<CommandResult> {
    return this.runComposeCommand(
      composeFile,
      ['up', '-d', '--scale', `${service}=${replicas}`, service],
      ACTION_TIMEOUT_MS,
      projectName
    );
  }

  public streamComposeLogs(
    composeFile: string,
    service: string,
    tail = 150,
    projectName?: string
  ): ChildProcess {
    const inv = this.buildComposeInvocation(
      composeFile,
      ['logs', '-f', '--tail', String(tail), service],
      projectName
    );
    const useShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(inv.bin);
    return spawn(inv.bin, inv.args, {
      cwd: inv.cwd,
      windowsHide: true,
      shell: useShell,
    });
  }

  public async composePs(
    composeFile: string,
    composeDoc?: ComposeDocument
  ): Promise<ComposeContainerStatus[]> {
    const all = await this.listAllContainers();
    if (all.length === 0) {
      return [];
    }

    const normTargetFile = normalizeFsPath(composeFile);
    const normTargetDir = normalizeFsPath(path.dirname(composeFile));
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

      if (c.composeFile && normalizeFsPath(c.composeFile) === normTargetFile) {
        isMatch = true;
      } else if (c.composeFile && normalizeFsPath(path.dirname(c.composeFile)) === normTargetDir) {
        isMatch = true;
      } else if (c.composeProject && expectedProjNames.has(c.composeProject.toLowerCase())) {
        isMatch = true;
      } else if (containerNameToService.has(c.name)) {
        isMatch = true;
        resolvedService = containerNameToService.get(c.name) || resolvedService;
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
        status: c.state,
        ports: c.portMappings,
        image: c.image,
        uptime: c.status,
        podId: c.podId || undefined,
        podName: c.podName || undefined,
      });
    }

    return matched;
  }
}
