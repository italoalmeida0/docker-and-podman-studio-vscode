import React, { useMemo, useState } from 'react';
import { Database, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import {
  ActionPillButton,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

export const VolumesPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const { volumes, operationInProgress } = useStudioStore();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [volName, setVolName] = useState('');
  const [volDriver, setVolDriver] = useState('local');
  const [volLabels, setVolLabels] = useState('');

  const busy = Boolean(operationInProgress);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return volumes;
    }
    return volumes.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.mountpoint.toLowerCase().includes(q) ||
        v.composeProject.toLowerCase().includes(q)
    );
  }, [volumes, search]);

  const composeVolCount = volumes.filter((v) => Boolean(v.composeProject)).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
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

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.volumes.createVolumeBtn}
            variant="podman"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(true)}
          />
          <ActionPillButton
            label={t.volumes.pruneOrphansBtn}
            disabled={busy}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            onClick={() => postMessage('prune:volumes')}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('volumes:list')}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={t.volumes.statTotal}
            value={volumes.length}
            detail={t.volumes.statTotalDetail}
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

        <div className="relative">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.volumes.searchPlaceholder}
            className="input-field pl-9"
          />
        </div>

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
                className="bg-panel-card border border-panel-border rounded-md px-4 py-3.5 flex items-center justify-between gap-4 shadow-card"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-text-primary font-mono break-all">
                      {v.name}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] rounded bg-panel-bg border border-panel-border text-text-secondary">
                      {v.driver}
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
                  disabled={busy}
                  icon={<Trash2 className="w-3 h-3" />}
                  onClick={() => postMessage('volume:remove', { volumeName: v.name })}
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
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setShowCreate(false)} />
              <ActionPillButton
                label={t.volumes.createVolumeBtn}
                variant="podman"
                disabled={!volName.trim()}
                onClick={() => {
                  postMessage('volume:create', {
                    name: volName.trim(),
                    driver: volDriver.trim() || 'local',
                    labels: volLabels
                      .split(',')
                      .map((l) => l.trim())
                      .filter(Boolean),
                  });
                  setVolName('');
                  setVolLabels('');
                  setShowCreate(false);
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
