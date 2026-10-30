import React, { useMemo, useState } from 'react';
import { Database, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  ActionPillButton,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
} from '../components/Shared';
import { SelectionBar, useResourceSelection } from '../components/ResourceSelection';
import { useI18n } from '../i18n';
import { PodmanVolume, useStudioStore } from '../store';
import { useActionRequest } from '../useActionRequest';
import { useVsCodeMessaging } from '../vscode';

const volumeSelectionKey = (volume: PodmanVolume) => `${volume.name}\0${volume.created}`;

export const VolumesPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const { volumes, operationInProgress, operationsInProgress } = useStudioStore();

  const [search, setSearch] = useState('');
  const [usageFilter, setUsageFilter] = useState<'all' | 'unused' | 'inUse'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [volName, setVolName] = useState('');
  const [volDriver, setVolDriver] = useState('local');
  const [volLabels, setVolLabels] = useState('');
  const createVolume = useActionRequest('volume:create', () => {
    setVolName('');
    setVolLabels('');
    setShowCreate(false);
  });

  const busy = Boolean(operationInProgress);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return volumes.filter(
      (v) =>
        (usageFilter === 'all' || v.usage === usageFilter) &&
        (!q || v.name.toLowerCase().includes(q) ||
          v.mountpoint.toLowerCase().includes(q) ||
          v.composeProject.toLowerCase().includes(q))
    );
  }, [volumes, search, usageFilter]);

  const composeVolCount = volumes.filter((v) => Boolean(v.composeProject)).length;
  const selectable = useMemo(
    () => volumes.filter((volume) => volume.usage === 'unused' && Boolean(volume.created)),
    [volumes]
  );
  const visibleSelectable = useMemo(
    () => filtered.filter((volume) => volume.usage === 'unused' && Boolean(volume.created)),
    [filtered]
  );
  const selection = useResourceSelection(selectable, visibleSelectable, volumeSelectionKey, engine);
  const removeVolumes = (selected: PodmanVolume[]) => {
    postMessage('resource:remove:batch', {
      resource: 'volume',
      engine,
      targets: selected.map((volume) => ({ name: volume.name, identity: volume.created })),
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="studio-page-header px-3 sm:px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Database
              className={`w-5 h-5 ${engine === 'podman' ? 'text-accent-purple' : 'text-accent-blue'}`}
            />
            <span>{fmt(t.volumes.title, { engine: engineLabel })}</span>
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            {fmt(t.volumes.subtitle, { engine: engineLabel })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ActionPillButton
            label={t.volumes.createVolumeBtn}
            variant="podman"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(true)}
          />
          <ActionPillButton
            label={selection.selected.length ? `${t.common.delete} (${selection.selected.length})` : t.volumes.pruneOrphansBtn}
            variant={selection.selected.length ? 'danger' : 'default'}
            loading={Boolean(operationsInProgress['volume-remove-batch'])}
            disabled={busy}
            icon={selection.selected.length ? <Trash2 className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            onClick={() => selection.selected.length ? removeVolumes(selection.selected) : postMessage('prune:volumes')}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={Boolean(operationsInProgress['list-volumes'] || operationsInProgress['refresh-all'])}
            disabled={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('volumes:list')}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-6 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label={t.volumes.statTotal}
            value={volumes.length}
            detail={t.volumes.statTotalDetail}
          />
          <StatCard
            label={t.images.filterUnused}
            value={volumes.filter((v) => v.usage === 'unused').length}
            detail={t.common.usageHint}
          />
          <StatCard
            label={t.volumes.statCompose}
            value={composeVolCount}
            detail={t.volumes.statComposeDetail}
          />
          <StatCard
            label={t.volumes.statAnonymous}
            value={volumes.filter((v) => v.anonymous).length}
            detail={t.volumes.statAnonymousDetail}
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 basis-[180px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.volumes.searchPlaceholder}
              className="input-field pl-9"
            />
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 bg-panel-card border border-panel-border rounded-md p-1">
            {([['all', t.common.all], ['unused', t.images.filterUnused], ['inUse', t.images.filterInUse]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setUsageFilter(id)}
                className={`max-w-full break-words px-2.5 py-1 text-xs rounded ${usageFilter === id ? 'bg-accent-purple text-white' : 'text-text-secondary'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <SelectionBar selection={selection} busy={busy} inline />
        </div>
        <p className="text-xs text-text-secondary">{t.common.usageHint}</p>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Database className="w-8 h-8" />}
            title={t.volumes.emptyTitle}
            description={t.volumes.emptyDesc}
            action={
              <ActionPillButton
                label={t.volumes.createVolumeBtn}
                variant="podman"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCreate(true)}
              />
            }
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((v) => (
              <div
                key={v.name}
                className="bg-panel-card border border-panel-border rounded-md px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap shadow-card"
              >
                <input
                  type="checkbox"
                  aria-label={fmt(t.common.selectResource, { name: v.name })}
                  checked={selection.selectedIds.has(volumeSelectionKey(v))}
                  disabled={busy || v.usage !== 'unused' || !v.created}
                  onChange={() => selection.toggle(volumeSelectionKey(v))}
                />
                <div className="min-w-0 flex-1 basis-[10rem] space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-text-primary font-mono break-all">
                      {v.name}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-panel-bg border border-panel-border text-text-secondary">
                      {v.driver}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-panel-bg border border-panel-border text-text-secondary" title={t.common.usageHint}>
                      {v.usage === 'unused' ? t.images.filterUnused : t.images.filterInUse}
                    </span>
                    {v.composeProject && (
                      <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/15 text-accent-purple border border-accent-purple font-mono">
                        compose:{v.composeProject}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-text-secondary break-all">
                    {t.volumes.mountpointPrefix}: {v.mountpoint || '-'}
                  </div>
                </div>

                <SmallActionButton
                  label={t.common.delete}
                  danger
                  disabled={busy || v.usage !== 'unused' || !v.created}
                  icon={<Trash2 className="w-3 h-3" />}
                  onClick={() => removeVolumes([v])}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Volume Modal */}
      {showCreate && (
        <Modal
          title={fmt(t.volumes.createModalTitle, { engine: engineLabel })}
          subtitle={`${engineCmd} volume create`}
          maxWidth="max-w-lg"
          feedback
          lockFields={createVolume.pending}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <ActionPillButton label={createVolume.pending ? t.common.close : t.common.cancel} onClick={() => setShowCreate(false)} />
              <ActionPillButton
                label={t.volumes.createVolumeBtn}
                variant="podman"
                loading={createVolume.pending}
                disabled={!volName.trim() || busy}
                onClick={() => {
                  if (busy) return;
                  createVolume.run({
                    name: volName.trim(),
                    driver: volDriver.trim() || 'local',
                    labels: volLabels
                      .split(',')
                      .map((l) => l.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.volumes.volumeNameLabel}
              </label>
              <input
                type="text"
                value={volName}
                onChange={(e) => setVolName(e.target.value)}
                placeholder="postgres-data"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.volumes.driverLabel}
              </label>
              <input
                type="text"
                value={volDriver}
                onChange={(e) => setVolDriver(e.target.value)}
                placeholder="local"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.volumes.labelsLabel}
              </label>
              <input
                type="text"
                value={volLabels}
                onChange={(e) => setVolLabels(e.target.value)}
                placeholder="app=api, env=dev"
                className="input-field font-mono"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
