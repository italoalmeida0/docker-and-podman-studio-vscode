import React, { useEffect, useMemo } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, Network, Pause, Play } from 'lucide-react';
import { useI18n } from '../i18n';
import type { PodmanContainer } from '../store';
import {
  ContainerSeries,
  firstIndexAtOrAfter,
  formatBytes,
  formatCount,
  formatPercent,
  formatRate,
  MetricWindowMs,
  summarizeValues,
  SeriesSummary,
} from '../statsSeries';
import { LiveStatusChip, LiveTone, WindowSelector } from './MetricsShared';
import { ChartSeries, UPlotChart } from './UPlotChart';
import { Modal, EmptyState } from './Shared';

const CHART_HEIGHT = 168;

const SERIES = {
  cpu: { cssVar: '--vscode-charts-blue', fallback: '#3794ff' },
  memory: { cssVar: '--vscode-charts-purple', fallback: '#b180d7' },
  received: { cssVar: '--vscode-charts-green', fallback: '#89d185' },
  sent: { cssVar: '--vscode-charts-orange', fallback: '#d18616' },
  read: { cssVar: '--vscode-charts-blue', fallback: '#3794ff' },
  written: { cssVar: '--vscode-charts-yellow', fallback: '#cca700' },
  pids: { cssVar: '--vscode-charts-foreground', fallback: '#cccccc' },
};

interface ChartLine {
  label: string;
  cssVar: string;
  fallback: string;
  values: (number | null)[];
  summary: SeriesSummary;
}

const ChartCard: React.FC<{
  title: string;
  hint?: string;
  lines: ChartLine[];
  format: (value: number | null) => string;
  nowLabel: string;
  averageLabel: string;
  peakLabel: string;
  times: number[];
  series: ChartSeries[];
  windowStartMs: number;
  windowEndMs: number;
  emptyText: string;
  ariaLabel: string;
  minimumMax?: number;
  formatAxis: (value: number) => string;
}> = ({ title, hint, lines, format, nowLabel, averageLabel, peakLabel, times, series, windowStartMs, windowEndMs, emptyText, ariaLabel, minimumMax, formatAxis }) => (
  <section className="min-w-0 rounded-xl border border-panel-border bg-panel-card p-3.5 shadow-card">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
      </div>
    </div>
    <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1 text-[11px] text-text-secondary">
      <dt />
      <dt className="text-right">{nowLabel}</dt>
      <dt className="text-right">{averageLabel}</dt>
      <dt className="text-right">{peakLabel}</dt>
      {lines.map((line) => (
        <React.Fragment key={line.label}>
          <dd className="flex min-w-0 items-center gap-1.5 text-text-secondary">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${line.cssVar}, ${line.fallback})` }}
            />
            <span className="truncate">{line.label}</span>
          </dd>
          <dd className="text-right font-mono tabular-nums text-text-primary">{format(line.summary.current)}</dd>
          <dd className="text-right font-mono tabular-nums">{format(line.summary.average)}</dd>
          <dd className="text-right font-mono tabular-nums">{format(line.summary.peak)}</dd>
        </React.Fragment>
      ))}
    </dl>
    <div className="mt-3">
      <UPlotChart
        ariaLabel={ariaLabel}
        emptyText={emptyText}
        times={times}
        series={series}
        values={lines.map((line) => line.values)}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        height={CHART_HEIGHT}
        minimumMax={minimumMax}
        formatValue={formatAxis}
      />
    </div>
  </section>
);

export const ContainerMetricsDialog: React.FC<{
  container: PodmanContainer;
  series: ContainerSeries | undefined;
  windowMs: MetricWindowMs;
  onWindowChange: (value: MetricWindowMs) => void;
  live: boolean;
  onToggleLive: () => void;
  now: number;
  tone: LiveTone;
  statusLabel: string;
  onClose: () => void;
}> = ({ container, series, windowMs, onWindowChange, live, onToggleLive, now, tone, statusLabel, onClose }) => {
  const { t, fmt, engineLabel } = useI18n();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const windowStartMs = now - windowMs;
  const data = useMemo(() => {
    if (!series) return null;
    const start = firstIndexAtOrAfter(series.t, windowStartMs);
    return {
      times: series.t.slice(start),
      cpu: series.cpu.slice(start),
      mem: series.mem.slice(start),
      rx: series.rx.slice(start),
      tx: series.tx.slice(start),
      rd: series.rd.slice(start),
      wr: series.wr.slice(start),
      pids: series.pids.slice(start),
    };
  }, [series, windowStartMs]);

  const latest = series?.latest;
  const cpu = summarizeValues(data?.cpu ?? []);
  const memory = summarizeValues(data?.mem ?? []);
  const received = summarizeValues(data?.rx ?? []);
  const sent = summarizeValues(data?.tx ?? []);
  const read = summarizeValues(data?.rd ?? []);
  const written = summarizeValues(data?.wr ?? []);
  const pids = summarizeValues(data?.pids ?? []);
  const sampleCount = data?.times.length ?? 0;
  const windowLabel = fmt(t.metrics.windowOption, { minutes: windowMs / 60_000 });
  const windowEndMs = now;
  const emptyText = data ? t.metrics.chartEmpty : t.metrics.waitingDesc;
  const limit = latest?.memLimitBytes ?? null;

  return (
    <Modal
      title={fmt(t.metrics.detailsTitle, { name: container.name })}
      subtitle={fmt(t.metrics.detailsSubtitle, { image: container.image, id: container.id, engine: engineLabel })}
      maxWidth="max-w-5xl"
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveStatusChip tone={tone} label={statusLabel} />
        <div className="flex flex-wrap items-center gap-2">
          <WindowSelector
            label={t.metrics.windowLabel}
            value={windowMs}
            format={(minutes) => fmt(t.metrics.windowOption, { minutes })}
            onChange={onWindowChange}
          />
          <button
            type="button"
            aria-pressed={!live}
            onClick={onToggleLive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-panel-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? t.metrics.pause : t.metrics.resume}
          </button>
        </div>
      </div>

      {!series && (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title={container.state === 'running' ? t.metrics.waitingTitle : t.metrics.stoppedTitle}
          description={container.state === 'running' ? t.metrics.waitingDesc : t.metrics.containerStopped}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          icon={<Cpu className="h-3.5 w-3.5" />}
          label={t.metrics.cpuTitle}
          value={formatPercent(latest?.cpuPercent ?? null)}
          detail={`${t.metrics.average} ${formatPercent(cpu.average)} · ${t.metrics.peak} ${formatPercent(cpu.peak)}`}
        />
        <KpiTile
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          label={t.metrics.memoryTitle}
          value={formatBytes(latest?.memUsageBytes ?? null)}
          detail={limit ? `${t.metrics.limit} ${formatBytes(limit)}` : ''}
        />
        <KpiTile
          icon={<Network className="h-3.5 w-3.5" />}
          label={t.metrics.networkTitle}
          value={formatRate(latest?.netRxRate ?? null)}
          detail={`${t.metrics.sent} ${formatRate(latest?.netTxRate ?? null)}`}
        />
        <KpiTile
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={t.metrics.diskTitle}
          value={formatRate(latest?.blockReadRate ?? null)}
          detail={`${t.metrics.written} ${formatRate(latest?.blockWriteRate ?? null)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title={t.metrics.cpuTitle}
          hint={t.metrics.cpuUnit}
          lines={[{ label: t.metrics.cpuTitle, ...SERIES.cpu, values: data?.cpu ?? [], summary: cpu }]}
          format={(value) => formatPercent(value)}
          nowLabel={t.metrics.now}
          averageLabel={t.metrics.average}
          peakLabel={t.metrics.peak}
          times={data?.times ?? []}
          series={[{ label: t.metrics.cpuTitle, cssVar: SERIES.cpu.cssVar, fallback: SERIES.cpu.fallback, fill: true }]}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          emptyText={emptyText}
          ariaLabel={fmt(t.metrics.ariaSummary, {
            title: t.metrics.cpuTitle, now: formatPercent(cpu.current), average: formatPercent(cpu.average), peak: formatPercent(cpu.peak),
          })}
          minimumMax={100}
          formatAxis={(value) => formatPercent(value)}
        />
        <ChartCard
          title={t.metrics.memoryTitle}
          hint={limit ? `${t.metrics.limit} ${formatBytes(limit)}` : undefined}
          lines={[{ label: t.metrics.memoryTitle, ...SERIES.memory, values: data?.mem ?? [], summary: memory }]}
          format={(value) => formatBytes(value)}
          nowLabel={t.metrics.now}
          averageLabel={t.metrics.average}
          peakLabel={t.metrics.peak}
          times={data?.times ?? []}
          series={[{ label: t.metrics.memoryTitle, cssVar: SERIES.memory.cssVar, fallback: SERIES.memory.fallback, fill: true }]}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          emptyText={emptyText}
          ariaLabel={fmt(t.metrics.ariaSummary, {
            title: t.metrics.memoryTitle, now: formatBytes(memory.current), average: formatBytes(memory.average), peak: formatBytes(memory.peak),
          })}
          formatAxis={(value) => formatBytes(value)}
        />
        <ChartCard
          title={t.metrics.networkTitle}
          hint={t.metrics.rateHint}
          minimumMax={1024}
          lines={[
            { label: t.metrics.received, ...SERIES.received, values: data?.rx ?? [], summary: received },
            { label: t.metrics.sent, ...SERIES.sent, values: data?.tx ?? [], summary: sent },
          ]}
          format={(value) => formatRate(value)}
          nowLabel={t.metrics.now}
          averageLabel={t.metrics.average}
          peakLabel={t.metrics.peak}
          times={data?.times ?? []}
          series={[
            { label: t.metrics.received, cssVar: SERIES.received.cssVar, fallback: SERIES.received.fallback },
            { label: t.metrics.sent, cssVar: SERIES.sent.cssVar, fallback: SERIES.sent.fallback },
          ]}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          emptyText={emptyText}
          ariaLabel={fmt(t.metrics.ariaSummary, {
            title: t.metrics.networkTitle, now: formatRate(received.current), average: formatRate(received.average), peak: formatRate(received.peak),
          })}
          formatAxis={(value) => formatRate(value)}
        />
        <ChartCard
          title={t.metrics.diskTitle}
          hint={t.metrics.rateHint}
          minimumMax={1024}
          lines={[
            { label: t.metrics.read, ...SERIES.read, values: data?.rd ?? [], summary: read },
            { label: t.metrics.written, ...SERIES.written, values: data?.wr ?? [], summary: written },
          ]}
          format={(value) => formatRate(value)}
          nowLabel={t.metrics.now}
          averageLabel={t.metrics.average}
          peakLabel={t.metrics.peak}
          times={data?.times ?? []}
          series={[
            { label: t.metrics.read, cssVar: SERIES.read.cssVar, fallback: SERIES.read.fallback },
            { label: t.metrics.written, cssVar: SERIES.written.cssVar, fallback: SERIES.written.fallback },
          ]}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          emptyText={emptyText}
          ariaLabel={fmt(t.metrics.ariaSummary, {
            title: t.metrics.diskTitle, now: formatRate(read.current), average: formatRate(read.average), peak: formatRate(read.peak),
          })}
          formatAxis={(value) => formatRate(value)}
        />
        <div className="xl:col-span-2">
          <ChartCard
            title={t.metrics.pidsTitle}
            lines={[{ label: t.metrics.pidsTitle, ...SERIES.pids, values: data?.pids ?? [], summary: pids }]}
            format={(value) => formatCount(value)}
            nowLabel={t.metrics.now}
            averageLabel={t.metrics.average}
            peakLabel={t.metrics.peak}
            times={data?.times ?? []}
            series={[{ label: t.metrics.pidsTitle, cssVar: SERIES.pids.cssVar, fallback: SERIES.pids.fallback, stepped: true }]}
            windowStartMs={windowStartMs}
            windowEndMs={windowEndMs}
            emptyText={emptyText}
            ariaLabel={fmt(t.metrics.ariaSummary, {
              title: t.metrics.pidsTitle, now: formatCount(pids.current), average: formatCount(pids.average), peak: formatCount(pids.peak),
            })}
            minimumMax={1}
            formatAxis={(value) => formatCount(value)}
          />
        </div>
      </div>

      <p className="text-[11px] text-text-muted">
        {fmt(t.metrics.samplesInfo, { count: sampleCount, window: windowLabel })}
      </p>
    </Modal>
  );
};

const KpiTile: React.FC<{ icon: React.ReactNode; label: string; value: string; detail: string }> = ({ icon, label, value, detail }) => (
  <div className="min-w-0 rounded-xl border border-panel-border bg-panel-card px-3.5 py-3 shadow-card">
    <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
      <span className="text-text-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    <div className="mt-1.5 truncate font-mono text-lg font-semibold tabular-nums text-text-primary">{value}</div>
    {detail && <div className="mt-0.5 truncate text-[11px] text-text-secondary">{detail}</div>}
  </div>
);
