import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';

export function useResourceSelection<T>(
  available: T[],
  visible: T[],
  keyOf: (item: T) => string,
  scope: string
) {
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({
    scope,
    ids: [],
  });
  const availableIds = useMemo(() => new Set(available.map(keyOf)), [available, keyOf]);
  const visibleIds = useMemo(() => visible.map(keyOf), [visible, keyOf]);
  const ids = selection.scope === scope
    ? selection.ids.filter((id) => availableIds.has(id))
    : [];
  const selectedIds = new Set(ids);
  const selected = available.filter((item) => selectedIds.has(keyOf(item)));
  const visibleSelected = visibleIds.filter((id) => selectedIds.has(id)).length;

  useEffect(() => {
    setSelection((previous) => {
      const next = previous.scope === scope
        ? previous.ids.filter((id) => availableIds.has(id))
        : [];
      return previous.scope === scope && next.length === previous.ids.length
        ? previous
        : { scope, ids: next };
    });
  }, [availableIds, scope]);

  function toggle(id: string) {
    if (!availableIds.has(id)) return;
    setSelection((previous) => {
      const current = previous.scope === scope
        ? previous.ids.filter((item) => availableIds.has(item))
        : [];
      return {
        scope,
        ids: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      };
    });
  }

  function toggleVisible() {
    const visibleSet = new Set(visibleIds);
    setSelection((previous) => {
      const current = previous.scope === scope
        ? previous.ids.filter((id) => availableIds.has(id))
        : [];
      return {
        scope,
        ids: visibleIds.every((id) => current.includes(id))
          ? current.filter((id) => !visibleSet.has(id))
          : Array.from(new Set([...current, ...visibleIds])),
      };
    });
  }

  return {
    selected,
    selectedIds,
    visibleCount: visibleIds.length,
    visibleSelected,
    toggle,
    toggleVisible,
    clear: () => setSelection({ scope, ids: [] }),
  };
}

interface SelectionBarState {
  selected: unknown[];
  visibleCount: number;
  visibleSelected: number;
  toggleVisible: () => void;
  clear: () => void;
}

export const SelectionBar: React.FC<{
  selection: SelectionBarState;
  busy: boolean;
  children?: React.ReactNode;
}> = ({ selection, busy, children }) => {
  const { t, fmt } = useI18n();
  const checkbox = useRef<HTMLInputElement>(null);
  const mixed = selection.visibleSelected > 0 && selection.visibleSelected < selection.visibleCount;
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = mixed;
  }, [mixed]);

  if (selection.visibleCount === 0 && selection.selected.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap bg-panel-card border border-panel-border rounded-md px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
        <input
          ref={checkbox}
          type="checkbox"
          checked={selection.visibleCount > 0 && selection.visibleSelected === selection.visibleCount}
          aria-checked={mixed ? 'mixed' : selection.visibleSelected === selection.visibleCount && selection.visibleCount > 0}
          disabled={busy || selection.visibleCount === 0}
          onChange={selection.toggleVisible}
        />
        {t.common.selectVisible}
      </label>
      <span className="text-xs text-text-secondary">
        {fmt(t.common.selectedCount, { count: selection.selected.length })}
      </span>
      {selection.selected.length > 0 && children}
      {selection.selected.length > 0 && (
        <button
          type="button"
          disabled={busy}
          className="text-xs text-text-secondary underline underline-offset-2 disabled:opacity-40"
          onClick={selection.clear}
        >
          {t.common.clearSelection}
        </button>
      )}
    </div>
  );
};
