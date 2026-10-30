import React from 'react';
import { LoaderCircle } from 'lucide-react';
import { TranslationDict } from '../i18n/en';
import { useI18n } from '../i18n';
import { ServiceStatus } from '../store';
import { FeedbackCenter } from './FeedbackCenter';

export interface StatusStyle {
  dot: string;
  label: string;
  text: string;
  border: string;
  badgeBg: string;
  pulse: boolean;
}

export function getStatusTheme(status: ServiceStatus | string, t?: TranslationDict): StatusStyle {
  switch (status) {
    case 'running':
      return {
        dot: 'bg-emerald-400',
        label: t ? t.status.running : 'Running',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        badgeBg: 'bg-emerald-500/10',
        pulse: false,
      };
    case 'starting':
      return {
        dot: 'bg-sky-400',
        label: t ? t.status.starting : 'Starting',
        text: 'text-sky-300',
        border: 'border-sky-500/20',
        badgeBg: 'bg-sky-500/10',
        pulse: true,
      };
    case 'stopping':
      return {
        dot: 'bg-amber-400',
        label: t ? t.status.stopping : 'Stopping',
        text: 'text-amber-300',
        border: 'border-amber-500/20',
        badgeBg: 'bg-amber-500/10',
        pulse: true,
      };
    case 'restarting':
      return {
        dot: 'bg-indigo-400',
        label: t ? t.status.restarting : 'Restarting',
        text: 'text-indigo-300',
        border: 'border-indigo-500/20',
        badgeBg: 'bg-indigo-500/10',
        pulse: true,
      };
    case 'unhealthy':
      return {
        dot: 'bg-amber-400',
        label: t ? t.status.unhealthy : 'Degraded',
        text: 'text-amber-300',
        border: 'border-amber-500/20',
        badgeBg: 'bg-amber-500/10',
        pulse: true,
      };
    case 'paused':
      return {
        dot: 'bg-amber-400',
        label: t ? t.status.paused : 'Paused',
        text: 'text-amber-300',
        border: 'border-amber-500/20',
        badgeBg: 'bg-amber-500/10',
        pulse: false,
      };
    case 'exited':
      return {
        dot: 'bg-rose-400',
        label: t ? t.status.exited : 'Exited',
        text: 'text-rose-400',
        border: 'border-rose-500/20',
        badgeBg: 'bg-rose-500/10',
        pulse: false,
      };
    default:
      return {
        dot: 'bg-text-muted',
        label: t ? t.status.stopped : 'Stopped',
        text: 'text-text-secondary',
        border: 'border-panel-border',
        badgeBg: 'bg-white/[0.03]',
        pulse: false,
      };
  }
}

export const StatusBadge: React.FC<{ status: ServiceStatus | string; customLabel?: string; title?: string }> = ({
  status,
  customLabel,
  title,
}) => {
  const { t } = useI18n();
  const s = getStatusTheme(status, t);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${s.border} ${s.text} ${s.badgeBg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${s.pulse ? 'animate-pulse' : ''}`} />
      {customLabel || s.label}
    </span>
  );
};

export const StatCard: React.FC<{
  label: string;
  value: string | number;
  detail: string;
  accent?: string;
  icon?: React.ReactNode;
}> = ({ label, value, detail, icon }) => (
  <div className="bg-panel-card border border-panel-border rounded-xl px-4 py-3.5 shadow-card hover:bg-panel-card-hover transition-colors">
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs font-medium text-text-secondary truncate">{label}</div>
      {icon && (
        <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-panel-border flex items-center justify-center text-text-secondary shrink-0">
          {icon}
        </div>
      )}
    </div>
    <div className="text-2xl font-semibold tracking-tight tabular-nums text-text-primary mt-2">
      {value}
    </div>
    <div className="text-[11px] text-text-secondary mt-1 truncate">{detail}</div>
  </div>
);

export const ActionPillButton: React.FC<{
  label: string;
  loadingLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'podman' | 'brand' | 'danger';
  icon?: React.ReactNode;
  title?: string;
}> = ({
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  onClick,
  variant = 'default',
  icon,
  title,
}) => {
  const { engine } = useI18n();
  const brandSolid =
    engine === 'podman'
      ? 'bg-[#6941C6] hover:bg-[#5B35B5] text-white border-white/15 shadow-sm'
      : 'bg-[#0A84FF] hover:bg-[#0070E0] text-white border-white/15 shadow-sm';

  const styles =
    variant === 'podman' || variant === 'brand' || variant === 'primary'
      ? brandSolid
      : variant === 'danger'
      ? 'border-rose-500/20 text-rose-400 bg-rose-500/[0.06] hover:bg-rose-500/15'
      : 'border-panel-border bg-white/[0.03] text-text-primary hover:bg-white/[0.07]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${styles}`}
    >
      {loading ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : icon}
      <span className="min-w-0 break-words">{loading && loadingLabel ? loadingLabel : label}</span>
    </button>
  );
};

export const SmallActionButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  icon?: React.ReactNode;
  title?: string;
}> = ({ label, onClick, disabled, danger, accent, icon, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
      danger
        ? 'border-rose-500/20 text-rose-400 hover:bg-rose-500/15'
        : accent
        ? 'border-white/15 bg-white/[0.07] text-text-primary hover:bg-white/[0.12]'
        : 'border-panel-border bg-white/[0.02] text-text-primary hover:bg-white/[0.06]'
    } disabled:opacity-30 disabled:cursor-not-allowed`}
  >
    {icon}
    <span className="min-w-0 break-words">{label}</span>
  </button>
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, description, icon, action }) => (
  <div className="bg-panel-card border border-panel-border rounded-xl p-8 text-center shadow-card">
    {icon && (
      <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-panel-border flex items-center justify-center mx-auto mb-3 text-text-secondary">
        {icon}
      </div>
    )}
    <p className="text-sm font-medium text-text-primary">{title}</p>
    <p className="text-xs text-text-secondary mt-1 max-w-xl mx-auto leading-relaxed">
      {description}
    </p>
    {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
  </div>
);

export const DetailRow: React.FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <div className="space-y-0.5">
    <div className="text-[11px] font-medium text-text-secondary">{label}</div>
    <div className="text-xs font-mono text-text-primary break-all">{value === '' ? '-' : value}</div>
  </div>
);

export const CodeBlockCard: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => {
  const { t } = useI18n();
  return (
    <div className="bg-panel-card border border-panel-border rounded-xl p-3.5">
      <div className="text-xs font-medium text-text-secondary mb-2">{title}</div>
      {lines.length > 0 ? (
        <div className="space-y-1 font-mono text-xs text-text-primary">
          {lines.map((line, i) => (
            <div key={`${line}-${i}`} className="break-all">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-text-secondary">{t.common.noneConfigured}</div>
      )}
    </div>
  );
};

export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  maxWidth?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  feedback?: boolean;
  lockFields?: boolean;
}> = ({ title, subtitle, maxWidth = 'max-w-2xl', onClose, children, footer, feedback = false, lockFields = false }) => {
  const { t } = useI18n();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[calc(100vh-1rem)] sm:max-h-[88vh] flex flex-col bg-panel-card border border-panel-border rounded-xl shadow-elevated overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-panel-border flex items-start justify-between gap-4 shrink-0 max-h-[30vh] overflow-auto">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-text-primary">{title}</h3>
            {subtitle && <p className="text-xs text-text-secondary mt-1">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs rounded-lg border border-panel-border text-text-secondary hover:text-text-primary hover:bg-white/[0.06]"
          >
            {t.common.close}
          </button>
        </div>
        {feedback && <FeedbackCenter />}
        <div className="p-4 sm:p-5 overflow-auto flex-1 min-h-0">
          <fieldset disabled={lockFields} className="min-w-0 space-y-4">{children}</fieldset>
        </div>
        {footer && (
          <div className="px-4 sm:px-5 py-3 border-t border-panel-border flex items-center justify-end gap-2 flex-wrap bg-panel-bg shrink-0 max-h-[25vh] overflow-auto">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
