export const METRIC_RETENTION_POINTS = 900;
export const METRIC_WINDOWS_MS = [60_000, 300_000, 900_000] as const;
export type MetricWindowMs = (typeof METRIC_WINDOWS_MS)[number];

const STALE_SERIES_MS = 20 * 60_000;

export interface ContainerSample {
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

export interface ContainerSeries {
  id: string;
  name: string;
  t: number[];
  cpu: (number | null)[];
  mem: (number | null)[];
  rx: (number | null)[];
  tx: (number | null)[];
  rd: (number | null)[];
  wr: (number | null)[];
  pids: (number | null)[];
  latest: ContainerSample;
  lastAt: number;
}

export interface TotalsSeries {
  t: number[];
  cpu: (number | null)[];
  mem: (number | null)[];
  rx: (number | null)[];
  tx: (number | null)[];
  rd: (number | null)[];
  wr: (number | null)[];
}

export interface SeriesSummary {
  current: number | null;
  average: number | null;
  peak: number | null;
}

export function emptyTotals(): TotalsSeries {
  return { t: [], cpu: [], mem: [], rx: [], tx: [], rd: [], wr: [] };
}

function pushBounded<T>(values: T[], value: T): void {
  values.push(value);
  if (values.length > METRIC_RETENTION_POINTS) {
    values.splice(0, values.length - METRIC_RETENTION_POINTS);
  }
}

export function appendContainerSample(
  series: ContainerSeries | undefined,
  sample: ContainerSample,
  at: number
): ContainerSeries {
  const target: ContainerSeries = series ?? {
    id: sample.id,
    name: sample.name,
    t: [],
    cpu: [],
    mem: [],
    rx: [],
    tx: [],
    rd: [],
    wr: [],
    pids: [],
    latest: sample,
    lastAt: at,
  };
  target.name = sample.name;
  pushBounded(target.t, at);
  pushBounded(target.cpu, sample.cpuPercent);
  pushBounded(target.mem, sample.memUsageBytes);
  pushBounded(target.rx, sample.netRxRate);
  pushBounded(target.tx, sample.netTxRate);
  pushBounded(target.rd, sample.blockReadRate);
  pushBounded(target.wr, sample.blockWriteRate);
  pushBounded(target.pids, sample.pids);
  target.latest = sample;
  target.lastAt = at;
  return target;
}

function sumKnown(values: (number | null)[]): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/** Totals only cover containers whose value is known at that tick, so an unknown rate is never shown as zero. */
export function appendTotals(totals: TotalsSeries, samples: ContainerSample[], at: number): TotalsSeries {
  pushBounded(totals.t, at);
  pushBounded(totals.cpu, sumKnown(samples.map((sample) => sample.cpuPercent)));
  pushBounded(totals.mem, sumKnown(samples.map((sample) => sample.memUsageBytes)));
  pushBounded(totals.rx, sumKnown(samples.map((sample) => sample.netRxRate)));
  pushBounded(totals.tx, sumKnown(samples.map((sample) => sample.netTxRate)));
  pushBounded(totals.rd, sumKnown(samples.map((sample) => sample.blockReadRate)));
  pushBounded(totals.wr, sumKnown(samples.map((sample) => sample.blockWriteRate)));
  return totals;
}

export function pruneStaleSeries(
  series: Record<string, ContainerSeries>,
  now: number
): Record<string, ContainerSeries> {
  for (const [id, entry] of Object.entries(series)) {
    if (now - entry.lastAt > STALE_SERIES_MS) delete series[id];
  }
  return series;
}

/** Index of the first point at or after `since`; the times are always ascending. */
export function firstIndexAtOrAfter(times: number[], since: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < since) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function windowSlice<T>(times: number[], values: T[], since: number): T[] {
  return values.slice(firstIndexAtOrAfter(times, since));
}

export function summarizeValues(values: (number | null)[]): SeriesSummary {
  let current: number | null = null;
  let peak: number | null = null;
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    current = value;
    total += value;
    count += 1;
    if (peak === null || value > peak) peak = value;
  }
  return { current, average: count > 0 ? total / count : null, peak };
}

function scaleDecimal(value: number, units: readonly string[]): string {
  let scaled = Math.max(0, value);
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(digits)} ${units[unit]}`;
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return scaleDecimal(value, BYTE_UNITS);
}

export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${scaleDecimal(value, BYTE_UNITS)}/s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Math.round(value));
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatClock(epochMs: number): string {
  return clockFormatter.format(epochMs);
}

/**
 * SVG path data for a sparkline. Unknown values break the line instead of being drawn as zero.
 * The scale starts at `minScale` so a quiet container does not look busy.
 */
export function sparklinePaths(
  values: (number | null)[],
  width: number,
  height: number,
  minScale = 1
): { line: string; area: string } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length < 2 || known.length === 0) return { line: '', area: '' };
  let maxValue = minScale;
  for (const value of known) if (value > maxValue) maxValue = value;
  const stepX = width / (values.length - 1);
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      return;
    }
    const ratio = Math.min(1, Math.max(0, value / maxValue));
    segment.push({ x: index * stepX, y: height - ratio * height });
  });
  if (segment.length > 0) segments.push(segment);

  const round = (number: number) => number.toFixed(2);
  let line = '';
  let area = '';
  for (const points of segments) {
    line += points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`).join(' ');
    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      area += `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`).join(' ')} L${round(last.x)} ${height} L${round(first.x)} ${height} Z `;
    }
  }
  return { line: line.trim(), area: area.trim() };
}
