import React, { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatClock } from '../statsSeries';

export interface ChartSeries {
  label: string;
  cssVar: string;
  fallback: string;
  fill?: boolean;
  stepped?: boolean;
}

export interface UPlotChartProps {
  ariaLabel: string;
  emptyText: string;
  times: number[];
  series: ChartSeries[];
  values: (number | null)[][];
  windowStartMs: number;
  windowEndMs: number;
  height: number;
  minimumMax?: number;
  formatValue: (value: number) => string;
}

function readCssValue(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((digit) => digit + digit).join('') : hex[1];
    const red = parseInt(digits.slice(0, 2), 16);
    const green = parseInt(digits.slice(2, 4), 16);
    const blue = parseInt(digits.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [red, green, blue] = rgb[1].split(',').map((part) => part.trim());
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return color;
}

function buildData(props: UPlotChartProps): uPlot.AlignedData {
  const xs = props.times.map((time) => time / 1000);
  return [xs, ...props.values] as unknown as uPlot.AlignedData;
}

/**
 * Time-series chart on a canvas. Colours come from the active VS Code theme, and the
 * chart is rebuilt when the theme changes. Tooltip content is built with DOM APIs.
 */
export const UPlotChart: React.FC<UPlotChartProps> = (props) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [width, setWidth] = useState(0);
  const [theme, setTheme] = useState(0);
  const hasData = props.times.length > 1;
  const specKey = props.series
    .map((spec) => `${spec.label}|${spec.cssVar}|${spec.fill ? 1 : 0}|${spec.stepped ? 1 : 0}`)
    .join(';');
  const widthReady = width > 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((value) => value + 1));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const plotHost = plotHostRef.current;
    if (!plotHost || !hasData || !widthReady) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return undefined;
    }
    const current = propsRef.current;
    const plot = new uPlot(buildOptions(current, width, hostRef, tooltipRef, propsRef), buildData(current), plotHost);
    plotRef.current = plot;
    return () => {
      plot.destroy();
      if (plotRef.current === plot) plotRef.current = null;
    };
  }, [hasData, widthReady, theme, specKey, props.height]);

  useEffect(() => {
    const plot = plotRef.current;
    if (plot && widthReady) plot.setSize({ width, height: propsRef.current.height });
  }, [width, widthReady]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setData(buildData(props), false);
    plot.setScale('x', { min: props.windowStartMs / 1000, max: props.windowEndMs / 1000 });
  }, [props.times, props.values, props.windowStartMs, props.windowEndMs]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={props.ariaLabel}
      className="relative w-full min-w-0"
      style={{ height: props.height }}
    >
      <div ref={plotHostRef} className="h-full w-full" />
      <div
        ref={tooltipRef}
        hidden
        className="pointer-events-none absolute left-0 top-0 z-10 min-w-[10rem] rounded-lg border border-panel-border bg-panel-card px-3 py-2 text-[11px] text-text-primary shadow-elevated"
      />
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-text-muted">
          {props.emptyText}
        </div>
      )}
    </div>
  );
};

function buildOptions(
  props: UPlotChartProps,
  width: number,
  hostRef: React.RefObject<HTMLDivElement>,
  tooltipRef: React.RefObject<HTMLDivElement>,
  latest: React.MutableRefObject<UPlotChartProps>
): uPlot.Options {
  const axisColor = readCssValue('--vscode-descriptionForeground', '#9d9d9d');
  const gridColor = readCssValue('--vscode-editorWidget-border', 'rgba(128, 128, 128, 0.18)');
  const background = readCssValue('--vscode-sideBar-background', '#181818');
  const fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';

  const seriesOptions: uPlot.Series[] = props.series.map((spec) => {
    const color = readCssValue(spec.cssVar, spec.fallback);
    return {
      label: spec.label,
      stroke: color,
      width: 2,
      spanGaps: true,
      points: { show: false },
      paths: spec.stepped ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
      fill: spec.fill
        ? (plot: uPlot) => {
          const gradient = plot.ctx.createLinearGradient(0, plot.bbox.top, 0, plot.bbox.top + plot.bbox.height);
          gradient.addColorStop(0, withAlpha(color, 0.34));
          gradient.addColorStop(1, withAlpha(color, 0.02));
          return gradient;
        }
        : undefined,
    };
  });

  const updateTooltip = (plot: uPlot) => {
    const tooltip = tooltipRef.current;
    const host = hostRef.current;
    if (!tooltip || !host) return;
    const index = plot.cursor.idx;
    const xs = plot.data[0] as number[] | undefined;
    if (index === null || index === undefined || xs?.[index] === undefined) {
      tooltip.hidden = true;
      return;
    }
    const current = latest.current;
    tooltip.hidden = false;
    tooltip.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'mb-1.5 font-mono text-[10px] text-text-muted';
    heading.textContent = formatClock(xs[index] * 1000);
    tooltip.append(heading);
    current.series.forEach((spec, seriesIndex) => {
      const value = (plot.data[seriesIndex + 1] as Array<number | null> | undefined)?.[index];
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-4';
      const label = document.createElement('span');
      label.className = 'flex items-center gap-1.5 text-text-secondary';
      const dot = document.createElement('span');
      dot.className = 'h-2 w-2 shrink-0 rounded-full';
      dot.style.backgroundColor = readCssValue(spec.cssVar, spec.fallback);
      label.append(dot, document.createTextNode(spec.label));
      const amount = document.createElement('span');
      amount.className = 'font-mono tabular-nums text-text-primary';
      amount.textContent = typeof value === 'number' ? current.formatValue(value) : '—';
      row.append(label, amount);
      tooltip.append(row);
    });
    const overRect = plot.over.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = overRect.left - hostRect.left + (plot.cursor.left ?? 0);
    const top = overRect.top - hostRect.top + (plot.cursor.top ?? 0);
    const flip = left > host.clientWidth * 0.6;
    const x = flip ? left - tooltip.offsetWidth - 14 : left + 14;
    const y = Math.max(0, Math.min(top - tooltip.offsetHeight / 2, host.clientHeight - tooltip.offsetHeight - 4));
    tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  return {
    width,
    height: props.height,
    legend: { show: false },
    cursor: {
      drag: { x: false, y: false },
      x: true,
      y: false,
      points: { size: 7, width: 2, fill: background },
    },
    scales: {
      x: { time: true },
      y: {
        range: (_plot: uPlot, _min: number, max: number) => [
          0,
          Math.max(Number.isFinite(max) ? max : 0, props.minimumMax ?? 1) * 1.12,
        ],
      },
    },
    axes: [
      {
        stroke: axisColor,
        font: `11px ${fontFamily}`,
        size: 28,
        space: 84,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: true, stroke: gridColor, width: 1, size: 4 },
        values: (_plot: uPlot, values: number[]) => values.map((value) => formatClock(value * 1000)),
      },
      {
        stroke: axisColor,
        font: `11px ${fontFamily}`,
        size: 64,
        grid: { show: true, stroke: gridColor, width: 1 },
        ticks: { show: false },
        values: (_plot: uPlot, values: number[]) =>
          values.map((value) => latest.current.formatValue(value)),
      },
    ],
    series: [{ value: (_plot: uPlot, value: number | null) => (value === null ? '—' : formatClock(value * 1000)) }, ...seriesOptions],
    hooks: {
      setCursor: [updateTooltip],
    },
  };
}
