import type { ChildProcess } from 'child_process';
import {
  classifyStatsFailure,
  ContainerRateTracker,
  ContainerStatsSample,
  createJsonArrayStreamParser,
  createJsonLineParser,
  normalizeDockerStats,
  normalizePodmanStats,
  RawContainerStats,
  StatsEngine,
  StatsFailureCode,
} from '../shared/containerStats';

export type ContainerStatsStatus =
  | { engine: StatsEngine; state: 'idle' }
  | { engine: StatsEngine; state: 'connecting' }
  | { engine: StatsEngine; state: 'live' }
  | { engine: StatsEngine; state: 'stalled' }
  | { engine: StatsEngine; state: 'retrying'; code: StatsFailureCode; retryInMs: number; detail?: string }
  | { engine: StatsEngine; state: 'unavailable'; code: StatsFailureCode; detail?: string };

export interface ContainerStatsMonitorOptions {
  spawnStream: (engine: StatsEngine) => ChildProcess;
  onSamples: (engine: StatsEngine, at: number, samples: ContainerStatsSample[]) => void;
  onStatus: (status: ContainerStatsStatus) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  stallAfterMs?: number;
  restartAfterMs?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
  dockerPublishIntervalMs?: number;
  idleRetryMs?: number;
}

interface ResolvedOptions {
  spawnStream: (engine: StatsEngine) => ChildProcess;
  onSamples: (engine: StatsEngine, at: number, samples: ContainerStatsSample[]) => void;
  onStatus: (status: ContainerStatsStatus) => void;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  stallAfterMs: number;
  restartAfterMs: number;
  initialRetryMs: number;
  maxRetryMs: number;
  dockerPublishIntervalMs: number;
  idleRetryMs: number;
}

function isStats(value: RawContainerStats | null): value is RawContainerStats {
  return value !== null;
}

/**
 * Owns at most one `stats` stream at a time. The stream covers every running container,
 * so containers that start or stop while the Studio is open need no restart.
 */
export class ContainerStatsMonitor {
  private readonly options: ResolvedOptions;
  private engine: StatsEngine | null = null;
  private lastEngine: StatsEngine = 'podman';
  private child: ChildProcess | null = null;
  private generation = 0;
  private arrayParser = createJsonArrayStreamParser();
  private lineParser = createJsonLineParser();
  private readonly tracker = new ContainerRateTracker();
  private spawnedAt = 0;
  private lastSampleAt: number | null = null;
  private stalled = false;
  private stderrTail = '';
  private retryMs = 0;
  private retryHandle: unknown;
  private watchdogHandle: unknown;
  private readonly pendingDockerStats = new Map<string, RawContainerStats>();
  private lastDockerPublishAt: number | null = null;

  constructor(options: ContainerStatsMonitorOptions) {
    this.options = {
      spawnStream: options.spawnStream,
      onSamples: options.onSamples,
      onStatus: options.onStatus,
      now: options.now ?? (() => Date.now()),
      schedule: options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
      cancel: options.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout)),
      stallAfterMs: options.stallAfterMs ?? 6_000,
      restartAfterMs: options.restartAfterMs ?? 20_000,
      initialRetryMs: options.initialRetryMs ?? 2_000,
      maxRetryMs: options.maxRetryMs ?? 30_000,
      dockerPublishIntervalMs: options.dockerPublishIntervalMs ?? 900,
      idleRetryMs: options.idleRetryMs ?? 3_000,
    };
  }

  public setActive(engine: StatsEngine | null): void {
    const running = this.child !== null || this.retryHandle !== undefined;
    if (engine === this.engine && (engine === null || running)) return;
    this.stop();
    this.engine = engine;
    if (!engine) {
      this.options.onStatus({ engine: this.lastEngine, state: 'idle' });
      return;
    }
    this.lastEngine = engine;
    this.retryMs = 0;
    this.options.onStatus({ engine, state: 'connecting' });
    this.spawn();
  }

  public dispose(): void {
    this.setActive(null);
  }

  private spawn(): void {
    const engine = this.engine;
    if (!engine) return;
    const generation = ++this.generation;
    this.arrayParser = createJsonArrayStreamParser();
    this.lineParser = createJsonLineParser();
    this.pendingDockerStats.clear();
    this.lastDockerPublishAt = null;
    this.tracker.reset();
    this.stderrTail = '';
    this.stalled = false;
    this.lastSampleAt = null;
    this.spawnedAt = this.options.now();

    let child: ChildProcess;
    try {
      child = this.options.spawnStream(engine);
    } catch (error) {
      this.fail(generation, error);
      return;
    }
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => {
      if (generation === this.generation) this.handleOutput(engine, text);
    });
    child.stderr?.on('data', (text: string) => {
      if (generation === this.generation) this.stderrTail = `${this.stderrTail}${text}`.slice(-2000);
    });
    child.on('error', (error: Error) => this.fail(generation, error));
    child.on('close', (code: number | null) => this.handleClose(generation, code));
    this.armWatchdog(generation);
  }

  private stop(): void {
    this.generation += 1;
    this.cancelWatchdog();
    if (this.retryHandle !== undefined) {
      this.options.cancel(this.retryHandle);
      this.retryHandle = undefined;
    }
    this.killChild();
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }

  private handleOutput(engine: StatsEngine, text: string): void {
    try {
      if (engine === 'podman') {
        for (const values of this.arrayParser.push(text)) {
          this.publish(engine, values.map((value) => normalizePodmanStats(value)).filter(isStats), this.options.now());
        }
        return;
      }
      for (const value of this.lineParser.push(text)) {
        const stats = normalizeDockerStats(value);
        if (stats) this.pendingDockerStats.set(stats.id, stats);
      }
      this.flushDockerStats(engine);
    } catch (error) {
      this.restart('unexpectedOutput', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Docker writes a frame about every 500 ms. Only the latest reading per container is kept, and
   * a batch is published at most once per interval so Docker and Podman share the same cadence.
   */
  private flushDockerStats(engine: StatsEngine): void {
    if (this.pendingDockerStats.size === 0) return;
    const at = this.options.now();
    if (this.lastDockerPublishAt !== null && at - this.lastDockerPublishAt < this.options.dockerPublishIntervalMs) {
      return;
    }
    const batch = [...this.pendingDockerStats.values()];
    this.pendingDockerStats.clear();
    this.lastDockerPublishAt = at;
    this.publish(engine, batch, at);
  }

  private publish(engine: StatsEngine, stats: RawContainerStats[], at: number): void {
    const samples = this.tracker.observe(stats, at);
    const firstSample = this.lastSampleAt === null;
    this.lastSampleAt = at;
    this.retryMs = 0;
    if (firstSample || this.stalled) {
      this.stalled = false;
      this.options.onStatus({ engine, state: 'live' });
    }
    this.options.onSamples(engine, at, samples);
  }

  private handleClose(generation: number, code: number | null): void {
    if (generation !== this.generation) return;
    const engine = this.engine;
    this.child = null;
    this.cancelWatchdog();
    const detail = this.stderrTail.trim();
    if (code === 0) {
      // Docker exits cleanly when no containers are running or when the daemon restarts; reconnect without an error.
      if (engine === 'docker') {
        this.scheduleQuietReconnect();
        return;
      }
      this.scheduleRetry('noData', 'The engine stopped the statistics stream.');
      return;
    }
    this.scheduleRetry(classifyStatsFailure(detail), detail ? detail.slice(-400) : `exit code ${code}`);
  }

  private scheduleQuietReconnect(): void {
    const engine = this.engine;
    if (!engine) return;
    this.retryHandle = this.options.schedule(() => {
      this.retryHandle = undefined;
      if (this.engine !== engine) return;
      this.spawn();
    }, this.options.idleRetryMs);
  }

  private fail(generation: number, error: unknown): void {
    const engine = this.engine;
    if (generation !== this.generation || !engine) return;
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    this.generation += 1;
    this.cancelWatchdog();
    this.killChild();
    if (code === 'ENOENT') {
      this.options.onStatus({ engine, state: 'unavailable', code: 'executableMissing', detail: message });
      return;
    }
    this.scheduleRetry(classifyStatsFailure(message), message);
  }

  private restart(code: StatsFailureCode, detail: string): void {
    this.stop();
    this.scheduleRetry(code, detail);
  }

  private scheduleRetry(code: StatsFailureCode, detail: string): void {
    const engine = this.engine;
    if (!engine) return;
    const delay = this.retryMs > 0 ? this.retryMs : this.options.initialRetryMs;
    this.retryMs = Math.min(this.options.maxRetryMs, delay * 2);
    this.options.onStatus({ engine, state: 'retrying', code, retryInMs: delay, detail });
    this.retryHandle = this.options.schedule(() => {
      this.retryHandle = undefined;
      if (this.engine !== engine) return;
      this.options.onStatus({ engine, state: 'connecting' });
      this.spawn();
    }, delay);
  }

  private armWatchdog(generation: number): void {
    this.cancelWatchdog();
    const interval = Math.min(this.options.stallAfterMs, 2_000);
    this.watchdogHandle = this.options.schedule(() => {
      this.watchdogHandle = undefined;
      const engine = this.engine;
      if (generation !== this.generation || !this.child || !engine) return;
      const idleMs = this.options.now() - (this.lastSampleAt ?? this.spawnedAt);
      if (idleMs >= this.options.restartAfterMs) {
        this.restart('noData', 'The engine stopped reporting resource usage.');
        return;
      }
      if (idleMs >= this.options.stallAfterMs && !this.stalled) {
        this.stalled = true;
        this.options.onStatus({ engine, state: 'stalled' });
      }
      this.armWatchdog(generation);
    }, interval);
  }

  private cancelWatchdog(): void {
    if (this.watchdogHandle !== undefined) {
      this.options.cancel(this.watchdogHandle);
      this.watchdogHandle = undefined;
    }
  }
}
