import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react';
import { fmt, useI18n } from '../i18n';
import { useFeedbackTexts } from '../i18n/feedback';
import { BannerToast, StudioOperation, useStudioStore } from '../store';
import { postStudioMessage } from '../vscode';

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function mayTakeLonger(key: string): boolean {
  return [
    'pulling', 'image-build', 'image-push', 'container-create', 'machine-start',
    'machine-restart', 'start', 'build', 'rebuild', 'build-up', 'scale', 'native-command',
  ].includes(key) || /^compose-(up|build|rebuild|build-up)-batch$/.test(key);
}

const OperationCard: React.FC<{ operation: StudioOperation; now: number }> = ({ operation, now }) => {
  const { t } = useI18n();
  const text = useFeedbackTexts();
  const [expanded, setExpanded] = useState(false);
  const follow = useRef(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const elapsed = now - operation.startedAt;
  const quietFor = now - (operation.lastOutputAt ?? operation.startedAt);

  useEffect(() => {
    if (expanded && follow.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [expanded, operation.output]);

  return (
    <div className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2.5 text-xs text-text-primary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none text-accent-purple" />
        <span className="font-medium break-words">{operation.label}</span>
        <span className="text-text-secondary tabular-nums">{fmt(text.elapsed, { time: formatElapsed(elapsed) })}</span>
        {operation.total !== undefined && operation.completed !== undefined && (
          <span className="text-text-secondary">
            {fmt(text.processed, { completed: operation.completed, total: operation.total })}
          </span>
        )}
      </div>
      {operation.current && (
        <p className="mt-1 text-text-secondary break-words">{fmt(text.workingOn, { name: operation.current })}</p>
      )}
      {mayTakeLonger(operation.key) && <p className="mt-1 text-text-secondary">{text.longHint}</p>}
      {quietFor >= 30_000 && <p className="mt-1 text-text-secondary">{text.quiet}</p>}
      <details className="mt-1.5" onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer text-text-primary underline underline-offset-2">{text.liveOutput}</summary>
        <p className="mt-2 text-text-secondary">{text.sensitive}</p>
        {operation.outputTruncated && <p className="mt-1 text-text-secondary">{text.truncated}</p>}
        <pre
          ref={outputRef}
          aria-live="off"
          onScroll={(event) => {
            const element = event.currentTarget;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
          }}
          className="mt-2 max-h-40 overflow-auto rounded border border-panel-border bg-panel-card p-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
        >
          {operation.output || text.waiting}
        </pre>
        <button type="button" className="mt-2 underline underline-offset-2" onClick={() => postStudioMessage('output:show')}>
          {t.common.showOutput}
        </button>
      </details>
    </div>
  );
};

const NotificationCard: React.FC<{ banner: BannerToast }> = ({ banner }) => {
  const { t } = useI18n();
  const text = useFeedbackTexts();
  const { dismissBanner, pauseBanner, resumeBanner } = useStudioStore();
  const paused = useStudioStore((state) => Boolean(state.pausedBanners[banner.id]));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    pauseBanner(banner.id);
    return () => resumeBanner(banner.id);
  }, [banner.id, expanded, pauseBanner, resumeBanner]);

  useEffect(() => {
    if (banner.type === 'error' || expanded || paused) return;
    const timer = setTimeout(() => dismissBanner(banner.id), banner.details ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [banner, dismissBanner, expanded, paused]);

  return (
    <div
      role={banner.type === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border bg-panel-bg px-3 py-2.5 text-xs text-text-primary ${
        banner.type === 'error' ? 'border-accent-red' :
          banner.type === 'success' ? 'border-accent-green' : 'border-panel-border'
      }`}
    >
      <div className="flex items-start gap-2">
        {banner.type === 'error' ? (
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-red" />
        ) : banner.type === 'success' ? (
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-green" />
        ) : (
          <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-purple" />
        )}
        <span className="min-w-0 flex-1 break-words">{banner.message}</span>
        <button
          type="button"
          aria-label={t.common.close}
          onClick={() => dismissBanner(banner.id)}
          className="shrink-0 rounded p-1 hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {banner.details && (
        <details className="mt-2 pl-6" onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer underline underline-offset-2">{text.showDetails}</summary>
          <p className="mt-2 text-text-secondary">{text.sensitive}</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded border border-panel-border bg-panel-card p-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {banner.details}
          </pre>
          <div className="mt-2 flex flex-wrap gap-4">
            <button type="button" className="underline underline-offset-2" onClick={() => postStudioMessage('output:copy', { text: banner.details })}>
              {text.copy}
            </button>
            <button type="button" className="underline underline-offset-2" onClick={() => postStudioMessage('output:show')}>
              {t.common.showOutput}
            </button>
          </div>
        </details>
      )}
    </div>
  );
};

export const FeedbackCenter: React.FC = () => {
  const { t } = useI18n();
  const text = useFeedbackTexts();
  const { banners, operationTokens, operationInProgress, operationLabels } = useStudioStore();
  const operations = Object.values(operationTokens);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (operations.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [operations.length]);

  if (banners.length === 0 && !operationInProgress) return null;

  return (
    <div className="shrink-0 bg-panel-card px-6 pt-3">
      <div className="max-h-[45vh] overflow-y-auto space-y-2 pb-3">
        {[...banners].reverse().map((banner) => <NotificationCard key={banner.id} banner={banner} />)}
        <div role="status" className="sr-only">
          {operations.map((operation) => operation.label).join('. ')}
        </div>
        {operations.map((operation) => <OperationCard key={operation.id} operation={operation} now={now} />)}
        {operations.length === 0 && operationInProgress && (
          <div role="status" className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2.5 text-xs">
            {t.common.working} {operationLabels[operationInProgress]}
          </div>
        )}
        {operations.length > 0 && (
          <p className="text-[11px] text-text-secondary">{text.navigationHint}</p>
        )}
      </div>
    </div>
  );
};
