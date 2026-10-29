import React, { useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { ServiceStatus } from '../store';
import { SmallActionButton } from './Shared';

type BatchAction = 'start' | 'stop' | 'restart';

interface SelectableResource {
  fullId: string;
  state: ServiceStatus;
}

export function isRunningState(state: ServiceStatus): boolean {
  return ['running', 'starting', 'stopping', 'restarting', 'unhealthy'].includes(state);
}

export function usePodmanSelection(
  available: SelectableResource[],
  visible: SelectableResource[],
  enabled: boolean
) {
  const [ids, setIds] = useState<string[]>([]);
  const availableIds = useMemo(() => new Set(available.map((item) => item.fullId)), [available]);
  const visibleIds = useMemo(() => visible.map((item) => item.fullId), [visible]);
  const selectedIds = useMemo(() => new Set(ids), [ids]);
  const selected = useMemo(
    () => available.filter((item) => selectedIds.has(item.fullId)),
    [available, selectedIds]
  );
  const visibleSelected = visibleIds.filter((id) => selectedIds.has(id)).length;

  useEffect(() => {
    setIds((previous) => {
      const next = enabled ? previous.filter((id) => availableIds.has(id)) : [];
      return next.length === previous.length ? previous : next;
    });
  }, [availableIds, enabled]);

  function toggle(id: string) {
    setIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }

  function toggleVisible() {
    const visibleSet = new Set(visibleIds);
    setIds((previous) =>
      visibleIds.every((id) => previous.includes(id))
        ? previous.filter((id) => !visibleSet.has(id))
        : Array.from(new Set([...previous, ...visibleIds]))
    );
  }

  return {
    selected,
    selectedIds,
    visibleCount: visibleIds.length,
    visibleSelected,
    toggle,
    toggleVisible,
    clear: () => setIds([]),
  };
}

export const PodmanBatchActions: React.FC<{
  selection: ReturnType<typeof usePodmanSelection>;
  busy: boolean;
  onAction: (action: BatchAction, ids: string[]) => void;
}> = ({ selection, busy, onAction }) => {
  const { t, fmt } = useI18n();
  const start = selection.selected.filter(
    (item) => item.state === 'stopped' || item.state === 'exited'
  );
  const stop = selection.selected.filter(
    (item) => isRunningState(item.state) && item.state !== 'stopping'
  );
  const restart = selection.selected.filter(
    (item) => item.state !== 'paused' && item.state !== 'stopping'
  );

  if (selection.visibleCount === 0 && selection.selected.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 flex-wrap bg-panel-card border border-panel-border rounded-md px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={selection.visibleCount > 0 && selection.visibleSelected === selection.visibleCount}
          aria-checked={
            selection.visibleSelected > 0 && selection.visibleSelected < selection.visibleCount
              ? 'mixed'
              : selection.visibleSelected === selection.visibleCount && selection.visibleCount > 0
          }
          disabled={busy || selection.visibleCount === 0}
          onChange={selection.toggleVisible}
        />
        {t.common.selectVisible}
      </label>
      <span className="text-xs text-text-secondary">
        {fmt(t.common.selectedCount, { count: selection.selected.length })}
      </span>
      {selection.selected.length > 0 && (
        <>
          <SmallActionButton
            label={`${t.common.start} (${start.length})`}
            accent
            disabled={busy || start.length === 0}
            icon={<Play className="w-3 h-3" />}
            onClick={() => onAction('start', start.map((item) => item.fullId))}
          />
          <SmallActionButton
            label={`${t.common.stop} (${stop.length})`}
            disabled={busy || stop.length === 0}
            icon={<Square className="w-3 h-3" />}
            onClick={() => onAction('stop', stop.map((item) => item.fullId))}
          />
          <SmallActionButton
            label={`${t.common.restart} (${restart.length})`}
            disabled={busy || restart.length === 0}
            icon={<RotateCcw className="w-3 h-3" />}
            onClick={() => onAction('restart', restart.map((item) => item.fullId))}
          />
          <SmallActionButton
            label={t.common.clearSelection}
            disabled={busy}
            onClick={selection.clear}
          />
        </>
      )}
    </div>
  );
};
