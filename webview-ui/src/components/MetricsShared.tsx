import React, { useEffect, useId, useState } from 'react';
import { METRIC_WINDOWS_MS, MetricWindowMs, sparklinePaths } from '../statsSeries';

export type LiveTone = 'live' | 'paused' | 'waiting' | 'connecting' | 'unavailable';

const TONE_CLASSES: Record<LiveTone, string> = {
  live: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
  paused: 'border-panel-border bg-white/[0.04] text-text-secondary',
  waiting: 'border-accent-orange/40 bg-accent-orange/10 text-accent-orange',
  connecting: 'border-accent-blue/40 bg-accent-blue/10 text-text-primary',
  unavailable: 'border-accent-orange/40 bg-accent-orange/10 text-accent-orange',
};

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

export const LiveStatusChip: React.FC<{ tone: LiveTone; label: string }> = ({ tone, label }) => (
  <span
    role="status"
    className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE_CLASSES[tone]}`}
  >
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${tone === 'live' ? 'animate-pulse' : ''}`}
    />
    <span className="min-w-0 break-words">{label}</span>
  </span>
);

export const WindowSelector: React.FC<{
  label: string;
  value: MetricWindowMs;
  format: (minutes: number) => string;
  onChange: (value: MetricWindowMs) => void;
}> = ({ label, value, format, onChange }) => (
  <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-panel-border bg-panel-card p-0.5">
    {METRIC_WINDOWS_MS.map((windowMs) => (
      <button
        key={windowMs}
        type="button"
        aria-pressed={value === windowMs}
        onClick={() => onChange(windowMs)}
        className={`rounded px-2.5 py-1 text-xs transition-colors ${
          value === windowMs ? 'bg-accent-blue font-medium text-white' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {format(windowMs / 60_000)}
      </button>
    ))}
  </div>
);

export const Sparkline: React.FC<{
  values: (number | null)[];
  cssVar: string;
  fallback: string;
  label: string;
  height?: number;
  minScale?: number;
}> = ({ values, cssVar, fallback, label, height = 36, minScale = 1 }) => {
  const id = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { line, area } = sparklinePaths(values, 240, height, minScale);
  const color = `var(${cssVar}, ${fallback})`;
  return (
    <svg
      viewBox={`0 0 240 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block w-full"
      style={{ height }}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${id})`} />}
      {line && (
        <path
          d={line}
          fill="none"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: color }}
        />
      )}
    </svg>
  );
};

export const MetricChip: React.FC<{ label: string; title?: string; icon?: React.ReactNode }> = ({ label, title, icon }) => (
  <span
    title={title}
    className="inline-flex max-w-full items-center gap-1 rounded-md border border-panel-border bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] tabular-nums text-text-secondary"
  >
    {icon}
    <span className="min-w-0 truncate">{label}</span>
  </span>
);
