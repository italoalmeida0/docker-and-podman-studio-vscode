export type StatsEngine = 'docker' | 'podman';

export type StatsFailureCode =
  | 'engineUnavailable'
  | 'permissionDenied'
  | 'executableMissing'
  | 'unexpectedOutput'
  | 'noData'
  | 'unknown';

export interface RawContainerStats {
  id: string;
  name: string;
  cpuPercent: number | null;
  memUsageBytes: number | null;
  memLimitBytes: number | null;
  memPercent: number | null;
  netRxTotal: number | null;
  netTxTotal: number | null;
  blockReadTotal: number | null;
  blockWriteTotal: number | null;
  pids: number | null;
}

export interface ContainerStatsSample {
  id: string;
  name: string;
  cpuPercent: number | null;
  memUsageBytes: number | null;
  memLimitBytes: number | null;
  memPercent: number | null;
  netRxRate: number | null;
  netTxRate: number | null;
  blockReadRate: number | null;
  blockWriteRate: number | null;
  pids: number | null;
}

export class StatsOutputError extends Error {}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5,
};

export function parseStatsSize(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(raw);
  if (!match) return null;
  const factor = SIZE_UNITS[(match[2] || 'b').toLowerCase()];
  return factor === undefined ? null : Math.round(Number(match[1]) * factor);
}

export function parseStatsPercent(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(raw);
  return match ? Number(match[1]) : null;
}

export function parseStatsCount(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const match = /^\s*(\d+)\s*$/.exec(String(raw));
  return match ? Number(match[1]) : null;
}

export function parseStatsPair(raw: unknown): [number | null, number | null] {
  if (typeof raw !== 'string') return [null, null];
  const [first, second] = raw.split('/');
  return [parseStatsSize(first ?? ''), second === undefined ? null : parseStatsSize(second)];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePodmanStats(raw: unknown): RawContainerStats | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (!id) return null;
  const [memUsageBytes, memLimitBytes] = parseStatsPair(raw.mem_usage);
  const [netRxTotal, netTxTotal] = parseStatsPair(raw.net_io);
  const [blockReadTotal, blockWriteTotal] = parseStatsPair(raw.block_io);
  return {
    id,
    name: text(raw.name) || id,
    cpuPercent: parseStatsPercent(raw.cpu_percent),
    memUsageBytes,
    memLimitBytes,
    memPercent: parseStatsPercent(raw.mem_percent),
    netRxTotal,
    netTxTotal,
    blockReadTotal,
    blockWriteTotal,
    pids: parseStatsCount(raw.pids),
  };
}

export function normalizeDockerStats(raw: unknown): RawContainerStats | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.ID) || text(raw.Container);
  if (!id) return null;
  const [memUsageBytes, memLimitBytes] = parseStatsPair(raw.MemUsage);
  const [netRxTotal, netTxTotal] = parseStatsPair(raw.NetIO);
  const [blockReadTotal, blockWriteTotal] = parseStatsPair(raw.BlockIO);
  return {
    id,
    name: text(raw.Name) || id,
    cpuPercent: parseStatsPercent(raw.CPUPerc),
    memUsageBytes,
    memLimitBytes,
    memPercent: parseStatsPercent(raw.MemPerc),
    netRxTotal,
    netTxTotal,
    blockReadTotal,
    blockWriteTotal,
    pids: parseStatsCount(raw.PIDs),
  };
}

export interface JsonArrayStreamParser {
  push(chunk: string): unknown[][];
}

/**
 * `podman stats --format json` prints one pretty-printed JSON array per interval.
 * The arrays can be split across chunks, so the parser tracks nesting outside strings.
 */
export function createJsonArrayStreamParser(): JsonArrayStreamParser {
  let pending = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inArray = false;
  return {
    push(chunk: string): unknown[][] {
      const arrays: unknown[][] = [];
      let start = inArray ? 0 : -1;
      for (let index = 0; index < chunk.length; index += 1) {
        const char = chunk[index];
        if (!inArray) {
          if (char === '[') {
            inArray = true;
            depth = 1;
            inString = false;
            escaped = false;
            start = index;
            pending = '';
          }
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') {
          inString = true;
        } else if (char === '[' || char === '{') {
          depth += 1;
        } else if (char === ']' || char === '}') {
          depth -= 1;
          if (depth === 0) {
            const complete = pending + chunk.slice(start, index + 1);
            pending = '';
            inArray = false;
            start = -1;
            let value: unknown;
            try {
              value = JSON.parse(complete);
            } catch {
              throw new StatsOutputError('The engine returned statistics that could not be read.');
            }
            if (!Array.isArray(value)) {
              throw new StatsOutputError('The engine returned statistics in an unexpected shape.');
            }
            arrays.push(value);
          }
        }
      }
      if (inArray) pending += chunk.slice(start);
      return arrays;
    },
  };
}

export interface JsonLineParser {
  push(chunk: string): unknown[];
}

/** `docker stats --format "{{json .}}"` prints one JSON object per line. */
export function createJsonLineParser(): JsonLineParser {
  let pending = '';
  return {
    push(chunk: string): unknown[] {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      return lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            throw new StatsOutputError('The engine returned a statistics line that could not be read.');
          }
        });
    },
  };
}

function rateBetween(
  current: number | null,
  before: number | null,
  elapsedMs: number,
  maxGapMs: number
): number | null {
  if (current === null || before === null || elapsedMs <= 0 || elapsedMs > maxGapMs) return null;
  const delta = current - before;
  // Engines round cumulative counters for display, so a tiny decrease is noise. A large drop means the container restarted.
  if (delta < 0) return current < before / 2 ? null : 0;
  return (delta * 1000) / elapsedMs;
}

interface CounterSnapshot {
  at: number;
  rx: number | null;
  tx: number | null;
  read: number | null;
  write: number | null;
}

export class ContainerRateTracker {
  private readonly snapshots = new Map<string, CounterSnapshot>();

  constructor(private readonly maxGapMs = 15_000) {}

  public observe(stats: RawContainerStats[], at: number): ContainerStatsSample[] {
    const seen = new Set<string>();
    const samples = stats.map((stat): ContainerStatsSample => {
      seen.add(stat.id);
      const previous = this.snapshots.get(stat.id);
      const elapsedMs = previous ? at - previous.at : 0;
      const rate = (current: number | null, before: number | null | undefined) =>
        previous ? rateBetween(current, before ?? null, elapsedMs, this.maxGapMs) : null;
      this.snapshots.set(stat.id, {
        at,
        rx: stat.netRxTotal,
        tx: stat.netTxTotal,
        read: stat.blockReadTotal,
        write: stat.blockWriteTotal,
      });
      return {
        id: stat.id,
        name: stat.name,
        cpuPercent: stat.cpuPercent,
        memUsageBytes: stat.memUsageBytes,
        memLimitBytes: stat.memLimitBytes,
        memPercent: stat.memPercent,
        netRxRate: rate(stat.netRxTotal, previous?.rx),
        netTxRate: rate(stat.netTxTotal, previous?.tx),
        blockReadRate: rate(stat.blockReadTotal, previous?.read),
        blockWriteRate: rate(stat.blockWriteTotal, previous?.write),
        pids: stat.pids,
      };
    });
    for (const [id, snapshot] of this.snapshots) {
      if (!seen.has(id) && at - snapshot.at > this.maxGapMs) this.snapshots.delete(id);
    }
    return samples;
  }

  public reset(): void {
    this.snapshots.clear();
  }
}

export function classifyStatsFailure(detail: string): StatsFailureCode {
  if (/cannot connect|can't connect|unable to connect|connection refused|error during connect|failed to connect|is the docker daemon running|podman machine|not running|socket|dial unix/i.test(detail)) {
    return 'engineUnavailable';
  }
  if (/permission denied|access is denied|operation not permitted/i.test(detail)) {
    return 'permissionDenied';
  }
  return 'unknown';
}
