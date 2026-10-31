import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Pause,
  Play,
  Radio,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { PodmanContainer, useStudioStore } from '../store';
import {
  ContainerSample,
  ContainerSeries,
  firstIndexAtOrAfter,
  formatBytes,
  formatCount,
  formatPercent,
  formatRate,
  MetricWindowMs,
  windowSlice,
} from '../statsSeries';
import { MetricsConnection, useContainerMetrics } from '../statsStore';
import { useVsCodeMessaging } from '../vscode';
import { isRunningState } from './PodmanBatchActions';
import { ContainerMetricsDialog } from './ContainerMetricsDialog';
import { EmptyState } from './Shared';
import {
  LiveStatusChip,
  LiveTone,
  MetricChip,
  Sparkline,
  useNow,
  WindowSelector,
} from './MetricsShared';

type SortKey = 'cpu' | 'memory' | 'name';

const FRESH_SAMPLE_MS = 4_000;

function sumSeries(first: (number | null)[], second: (number | null)[]): (number | null)[] {
  return first.map((value, index) => {
    const other = second[index] ?? null;
    if (value === null && other === null) return null;
    return (value ?? 0) + (other ?? 0);
  });
}

const TotalTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  values: (number | null)[];
  cssVar: string;
  fallback: string;
  minScale: number;
}> = ({ icon, label, value, detail, values, cssVar, fallback, minScale }) => (
  <div className="min-w-0 rounded-xl border border-panel-border bg-panel-card px-4 py-3.5 shadow-card">
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-xs font-medium text-text-secondary">{label}</span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-panel-border bg-white/[0.04] text-text-secondary">
        {icon}
      </span>
    </div>
    <div className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight text-text-primary">{value}</div>
    <div className="mt-0.5 truncate text-[11px] text-text-secondary" title={detail}>{detail}</div>
    <div className="mt-2">
      <Sparkline values={values} cssVar={cssVar} fallback={fallback} label={label} height={28} minScale={minScale} />
    </div>
  </div>
);

const MetricCard: React.FC<{
  container: PodmanContainer;
  series: ContainerSeries | undefined;
  windowMs: MetricWindowMs;
  now: number;
  onOpen: () => void;
}> = ({ container, series, windowMs, now, onOpen }) => {
  const { t, fmt } = useI18n();
  const since = now - windowMs;
  const cpuValues = series ? windowSlice(series.t, series.cpu, since) : [];
  const memValues = series ? windowSlice(series.t, series.mem, since) : [];
  const latest = series?.latest;
  const limit = latest?.memLimitBytes ?? null;
  const label = fmt(t.metrics.detailsTitle, { name: container.name });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group min-w-0 cursor-pointer rounded-xl border border-panel-border bg-panel-card p-4 shadow-card transition-colors hover:bg-panel-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary" title={container.name}>{container.name}</div>
          <div className="truncate font-mono text-[11px] text-text-muted" title={container.image}>{container.image}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-text-secondary group-hover:text-text-primary">
          <Activity className="h-3.5 w-3.5" />
          {t.metrics.detailsBtn}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-text-secondary">
            <span>{t.metrics.cpuTitle}</span>
            <span className="font-mono text-sm tabular-nums text-text-primary">{formatPercent(latest?.cpuPercent ?? null)}</span>
          </div>
          <div className="mt-1">
            <Sparkline
              values={cpuValues}
              cssVar="--vscode-charts-blue"
              fallback="#3794ff"
              label={`${t.metrics.cpuTitle}: ${formatPercent(latest?.cpuPercent ?? null)}`}
              minScale={100}
            />
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-text-secondary">
            <span>{t.metrics.memoryTitle}</span>
            <span className="font-mono text-sm tabular-nums text-text-primary">{formatBytes(latest?.memUsageBytes ?? null)}</span>
          </div>
          <div className="mt-1">
            <Sparkline
              values={memValues}
              cssVar="--vscode-charts-purple"
              fallback="#b180d7"
              label={`${t.metrics.memoryTitle}: ${formatBytes(latest?.memUsageBytes ?? null)}`}
              minScale={limit ?? 1}
            />
          </div>
          <div className="mt-0.5 truncate text-[10px] text-text-muted">
            {limit !== null
              ? fmt(t.metrics.cardMemoryPercent, { percent: formatPercent(latest?.memPercent ?? null), limit: formatBytes(limit) })
              : '\u00a0'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <MetricChip
          icon={<ArrowDownToLine className="h-3 w-3" />}
          label={formatRate(latest?.netRxRate ?? null)}
          title={t.metrics.received}
        />
        <MetricChip
          icon={<ArrowUpFromLine className="h-3 w-3" />}
          label={formatRate(latest?.netTxRate ?? null)}
          title={t.metrics.sent}
        />
        <MetricChip
          icon={<HardDrive className="h-3 w-3" />}
          label={`${formatRate(latest?.blockReadRate ?? null)} · ${formatRate(latest?.blockWriteRate ?? null)}`}
          title={`${t.metrics.read} · ${t.metrics.written}`}
        />
        <MetricChip label={`${t.metrics.pidsTitle} ${formatCount(latest?.pids ?? null)}`} />
      </div>
    </div>
  );
};

export const LiveMetricsView: React.FC<{
  containers: PodmanContainer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}> = ({ containers, selectedId, onSelect }) => {
  const { t, fmt, engine } = useI18n();
  const { postMessage } = useVsCodeMessaging();
  const metrics = useContainerMetrics();
  const systemInfo = useStudioStore((state) => state.systemInfo);
  const now = useNow(1000);
  const [live, setLive] = useState(true);
  const [windowMs, setWindowMs] = useState<MetricWindowMs>(60_000);
  const [sort, setSort] = useState<SortKey>('cpu');

  useEffect(() => {
    const watch = (active: boolean) => postMessage('stats:watch', { engine, active });
    const sync = () => watch(live && document.visibilityState !== 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      watch(false);
    };
  }, [engine, live, postMessage]);

  const matches = metrics.engine === engine;
  const seriesById = matches ? metrics.series : {};
  const connection: MetricsConnection = matches ? metrics.connection : { state: 'idle' };
  const lastSampleAt = matches ? metrics.lastSampleAt : null;

  const running = containers.filter((container) => !container.isInfra && isRunningState(container.state));
  const stoppedCount = containers.filter((container) => !container.isInfra && !isRunningState(container.state)).length;
  const rows = running
    .map((container) => {
      const series = seriesById[container.id];
      return { container, series, latest: series?.latest as ContainerSample | undefined };
    })
    .sort((left, right) => {
      if (sort === 'name') return left.container.name.localeCompare(right.container.name);
      if (sort === 'memory') return (right.latest?.memUsageBytes ?? -1) - (left.latest?.memUsageBytes ?? -1);
      return (right.latest?.cpuPercent ?? -1) - (left.latest?.cpuPercent ?? -1);
    });

  const sumLatest = (pick: (sample: ContainerSample) => number | null): number | null =>
    rows.reduce<number | null>((sum, row) => {
      const value = row.latest ? pick(row.latest) : null;
      return value === null ? sum : (sum ?? 0) + value;
    }, null);
  const cpuTotal = sumLatest((sample) => sample.cpuPercent);
  const memoryTotal = sumLatest((sample) => sample.memUsageBytes);
  const rxTotal = sumLatest((sample) => sample.netRxRate);
  const txTotal = sumLatest((sample) => sample.netTxRate);
  const readTotal = sumLatest((sample) => sample.blockReadRate);
  const writeTotal = sumLatest((sample) => sample.blockWriteRate);
  const hostMemory = rows.reduce<number | null>((largest, row) => {
    const limit = row.latest?.memLimitBytes ?? null;
    return limit !== null && (largest === null || limit > largest) ? limit : largest;
  }, null);
  const cores = systemInfo?.cpus && systemInfo.cpus > 0 ? systemInfo.cpus : null;

  const since = now - windowMs;
  const windowStart = matches ? firstIndexAtOrAfter(metrics.totals.t, since) : 0;
  const totalsWindow = (values: (number | null)[]) => (matches ? values.slice(windowStart) : []);

  const freshness = lastSampleAt === null ? null : now - lastSampleAt;
  let tone: LiveTone;
  let statusLabel: string;
  if (!live) {
    tone = 'paused';
    statusLabel = t.metrics.statusPaused;
  } else if (connection.state === 'unavailable') {
    tone = 'unavailable';
    statusLabel = t.metrics.statusUnavailable;
  } else if (connection.state === 'retrying') {
    tone = 'waiting';
    statusLabel = fmt(t.metrics.statusRetrying, { seconds: Math.max(1, Math.ceil(connection.retryInMs / 1000)) });
  } else if (freshness !== null && freshness < FRESH_SAMPLE_MS) {
    tone = 'live';
    statusLabel = t.metrics.statusLive;
  } else if (lastSampleAt === null || connection.state === 'connecting' || connection.state === 'idle') {
    tone = 'connecting';
    statusLabel = t.metrics.statusConnecting;
  } else {
    tone = 'waiting';
    statusLabel = t.metrics.statusWaiting;
  }

  const selected = selectedId ? containers.find((container) => container.id === selectedId) ?? null : null;
  const selectedSeries = selected ? seriesById[selected.id] : undefined;
  const unavailableDetail = connection.state === 'unavailable' ? connection.detail : undefined;

  return (
    <section aria-label={t.metrics.liveTitle} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{t.metrics.liveTitle}</h2>
          <p className="mt-0.5 text-xs text-text-secondary">{t.metrics.liveSubtitle}</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>{t.metrics.sortLabel}</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="input-field !w-auto py-1 text-xs"
            >
              <option value="cpu">{t.metrics.sortCpu}</option>
              <option value="memory">{t.metrics.sortMemory}</option>
              <option value="name">{t.metrics.sortName}</option>
            </select>
          </label>
          <WindowSelector
            label={t.metrics.windowLabel}
            value={windowMs}
            format={(minutes) => fmt(t.metrics.windowOption, { minutes })}
            onChange={setWindowMs}
          />
          <button
            type="button"
            aria-pressed={!live}
            onClick={() => setLive((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-panel-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? t.metrics.pause : t.metrics.resume}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LiveStatusChip tone={tone} label={statusLabel} />
        {live && freshness !== null && (
          <span className="text-[11px] text-text-muted">
            {fmt(t.metrics.updatedAgo, { seconds: Math.max(0, Math.round(freshness / 1000)) })}
          </span>
        )}
        <span className="text-xs text-text-secondary">{fmt(t.metrics.runningCount, { count: running.length })}</span>
        {unavailableDetail && (
          <span className="min-w-0 break-words text-[11px] text-text-muted" title={unavailableDetail}>{unavailableDetail}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <TotalTile
          icon={<Cpu className="h-3.5 w-3.5" />}
          label={t.metrics.totalCpu}
          value={formatPercent(cpuTotal)}
          detail={cores !== null && cpuTotal !== null
            ? fmt(t.metrics.totalCpuDetail, { percent: formatPercent(cpuTotal / cores), cores })
            : ''}
          values={totalsWindow(metrics.totals.cpu)}
          cssVar="--vscode-charts-blue"
          fallback="#3794ff"
          minScale={100 * (cores ?? 1)}
        />
        <TotalTile
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          label={t.metrics.totalMemory}
          value={formatBytes(memoryTotal)}
          detail={hostMemory !== null ? fmt(t.metrics.totalMemoryDetail, { total: formatBytes(hostMemory) }) : ''}
          values={totalsWindow(metrics.totals.mem)}
          cssVar="--vscode-charts-purple"
          fallback="#b180d7"
          minScale={hostMemory ?? 1}
        />
        <TotalTile
          icon={<Network className="h-3.5 w-3.5" />}
          label={t.metrics.totalNetwork}
          value={formatRate(rxTotal !== null || txTotal !== null ? (rxTotal ?? 0) + (txTotal ?? 0) : null)}
          detail={fmt(t.metrics.totalNetworkDetail, { rx: formatRate(rxTotal), tx: formatRate(txTotal) })}
          values={matches ? sumSeries(totalsWindow(metrics.totals.rx), totalsWindow(metrics.totals.tx)) : []}
          cssVar="--vscode-charts-green"
          fallback="#89d185"
          minScale={1}
        />
        <TotalTile
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={t.metrics.totalDisk}
          value={formatRate(readTotal !== null || writeTotal !== null ? (readTotal ?? 0) + (writeTotal ?? 0) : null)}
          detail={fmt(t.metrics.totalDiskDetail, { read: formatRate(readTotal), write: formatRate(writeTotal) })}
          values={matches ? sumSeries(totalsWindow(metrics.totals.rd), totalsWindow(metrics.totals.wr)) : []}
          cssVar="--vscode-charts-yellow"
          fallback="#cca700"
          minScale={1}
        />
      </div>

      {running.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-5 w-5" />}
          title={t.metrics.emptyTitle}
          description={t.metrics.emptyDesc}
        />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18.5rem),1fr))]">
          {rows.map((row) => (
            <MetricCard
              key={row.container.id}
              container={row.container}
              series={row.series}
              windowMs={windowMs}
              now={now}
              onOpen={() => onSelect(row.container.id)}
            />
          ))}
        </div>
      )}

      {stoppedCount > 0 && (
        <p className="text-[11px] text-text-muted">{fmt(t.metrics.stoppedNote, { count: stoppedCount })}</p>
      )}

      {selected && (
        <ContainerMetricsDialog
          container={selected}
          series={selectedSeries}
          windowMs={windowMs}
          onWindowChange={setWindowMs}
          live={live}
          onToggleLive={() => setLive((value) => !value)}
          now={now}
          tone={tone}
          statusLabel={statusLabel}
          onClose={() => onSelect(null)}
        />
      )}
    </section>
  );
};
