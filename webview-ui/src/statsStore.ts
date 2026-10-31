import { create } from 'zustand';
import {
  appendContainerSample,
  appendTotals,
  ContainerSample,
  ContainerSeries,
  emptyTotals,
  pruneStaleSeries,
  TotalsSeries,
} from './statsSeries';

export type MetricsEngine = 'docker' | 'podman';

export type MetricsConnection =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'stalled' }
  | { state: 'retrying'; code: string; retryInMs: number; detail?: string }
  | { state: 'unavailable'; code: string; detail?: string };

export interface MetricsStatusPayload {
  state?: unknown;
  code?: unknown;
  retryInMs?: unknown;
  detail?: unknown;
}

interface ContainerMetricsState {
  engine: MetricsEngine | null;
  connection: MetricsConnection;
  series: Record<string, ContainerSeries>;
  totals: TotalsSeries;
  lastSampleAt: number | null;
  version: number;
  applySamples: (engine: MetricsEngine, at: number, samples: ContainerSample[]) => void;
  applyStatus: (engine: MetricsEngine, status: MetricsStatusPayload) => void;
  reset: (engine: MetricsEngine | null) => void;
}

function isEngine(value: unknown): value is MetricsEngine {
  return value === 'docker' || value === 'podman';
}

function toConnection(status: MetricsStatusPayload): MetricsConnection {
  switch (status.state) {
    case 'connecting':
      return { state: 'connecting' };
    case 'live':
      return { state: 'live' };
    case 'stalled':
      return { state: 'stalled' };
    case 'retrying':
      return {
        state: 'retrying',
        code: typeof status.code === 'string' ? status.code : 'unknown',
        retryInMs: typeof status.retryInMs === 'number' ? status.retryInMs : 0,
        detail: typeof status.detail === 'string' ? status.detail : undefined,
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        code: typeof status.code === 'string' ? status.code : 'unknown',
        detail: typeof status.detail === 'string' ? status.detail : undefined,
      };
    default:
      return { state: 'idle' };
  }
}

/** Samples from another engine never mix with the active engine's history. */
function engineReset(current: ContainerMetricsState, engine: MetricsEngine): Partial<ContainerMetricsState> {
  if (current.engine === engine) return {};
  return {
    engine,
    connection: { state: 'idle' },
    series: {},
    totals: emptyTotals(),
    lastSampleAt: null,
  };
}

function isSample(value: ContainerSample): boolean {
  return typeof value?.id === 'string' && value.id.length > 0;
}

export const useContainerMetrics = create<ContainerMetricsState>((set, get) => ({
  engine: null,
  connection: { state: 'idle' },
  series: {},
  totals: emptyTotals(),
  lastSampleAt: null,
  version: 0,
  reset: (engine) => set((state) => ({
    engine,
    connection: { state: 'idle' },
    series: {},
    totals: emptyTotals(),
    lastSampleAt: null,
    version: state.version + 1,
  })),
  applySamples: (engine, at, samples) => {
    if (!isEngine(engine) || !Number.isFinite(at)) return;
    const current = get();
    const reset = engineReset(current, engine);
    const series = { ...(reset.series ?? current.series) };
    const batch = Array.isArray(samples) ? samples.filter(isSample) : [];
    for (const sample of batch) {
      series[sample.id] = appendContainerSample(series[sample.id], sample, at);
    }
    pruneStaleSeries(series, at);
    const totals = appendTotals(reset.totals ?? current.totals, batch, at);
    set({
      ...reset,
      engine,
      series,
      totals,
      lastSampleAt: at,
      version: current.version + 1,
    });
  },
  applyStatus: (engine, status) => {
    if (!isEngine(engine)) return;
    const current = get();
    set({
      ...engineReset(current, engine),
      engine,
      connection: toConnection(status ?? {}),
      version: current.version + 1,
    });
  },
}));
