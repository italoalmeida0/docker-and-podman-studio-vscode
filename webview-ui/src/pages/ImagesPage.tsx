import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FolderOpen,
  Hammer,
  Layers,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ActionPillButton,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { PodmanImage, useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

export const ImagesPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const {
    images,
    dockerfileSelection,
    settings,
    operationInProgress,
  } = useStudioStore();

  const [pullName, setPullName] = useState('');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'inUse' | 'unused' | 'dangling'>('all');

  // Build Modal
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [buildDockerfile, setBuildDockerfile] = useState(
    engine === 'podman' ? 'Containerfile' : 'Dockerfile'
  );
  const [buildContext, setBuildContext] = useState('.');
  const [buildTag, setBuildTag] = useState(
    engine === 'podman' ? 'localhost/my-app:latest' : 'my-app:latest'
  );

  // Push Modal
  const [pushTargetImage, setPushTargetImage] = useState<PodmanImage | null>(null);
  const [pushDestTag, setPushDestTag] = useState('');

  // Quick Run Modal
  const [runImageTarget, setRunImageTarget] = useState<PodmanImage | null>(null);
  const [runContainerName, setRunContainerName] = useState('');
  const [runPorts, setRunPorts] = useState('');

  useEffect(() => {
    if (dockerfileSelection) {
      setBuildDockerfile(dockerfileSelection.dockerfile);
      setBuildContext(dockerfileSelection.contextDir);
    }
  }, [dockerfileSelection]);

  const busy = Boolean(operationInProgress);
  const inUseCount = images.filter((i) => i.inUse).length;
  const danglingCount = images.filter((i) => i.dangling).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      if (filterMode === 'inUse' && !img.inUse) {
        return false;
      }
      if (filterMode === 'unused' && img.inUse) {
        return false;
      }
      if (filterMode === 'dangling' && !img.dangling) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        img.repository.toLowerCase().includes(q) ||
        img.tag.toLowerCase().includes(q) ||
        img.id.toLowerCase().includes(q)
      );
    });
  }, [images, search, filterMode]);

  const handlePull = () => {
    if (!pullName.trim()) {
      return;
    }
    postMessage('image:pull', { imageName: pullName.trim() });
    setPullName('');
  };

  const openPushModal = (img: PodmanImage) => {
    const sourceRef = img.dangling ? img.id : `${img.repository}:${img.tag}`;
    const defReg = settings?.pushDefaultRegistry?.trim();
    const shortName = img.repository.split('/').pop() || 'app';
    setPushTargetImage(img);
    setPushDestTag(defReg ? `${defReg.replace(/\/$/, '')}/${shortName}:${img.tag || 'latest'}` : sourceRef);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Layers
              className={`w-5 h-5 ${engine === 'podman' ? 'text-accent-purple' : 'text-accent-blue'}`}
            />
            <span>{fmt(t.images.title, { engine: engineLabel })}</span>
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.images.subtitle}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ActionPillButton
            label={t.images.buildImageBtn}
            variant="podman"
            icon={<Hammer className="w-3.5 h-3.5" />}
            onClick={() => setShowBuildModal(true)}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('images:list')}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Pull Bar */}
        <div className="bg-panel-card border border-panel-border rounded-md p-4 shadow-card flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <input
              type="text"
              value={pullName}
              onChange={(e) => setPullName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePull();
                }
              }}
              placeholder={t.images.pullPlaceholder}
              className="input-field font-mono"
            />
          </div>
          <ActionPillButton
            label={t.images.pullBtn}
            variant="primary"
            loading={operationInProgress === 'pulling'}
            loadingLabel={t.common.downloadingOp}
            disabled={!pullName.trim() || busy}
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handlePull}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={t.images.statTotal}
            value={images.length}
            detail={fmt(t.images.statInUseDetail, { count: inUseCount })}
          />
          <StatCard
            label={t.images.statUnused}
            value={images.length - inUseCount}
            detail={t.images.statUnusedDetail}
          />
          <StatCard
            label={t.images.statDangling}
            value={danglingCount}
            detail="<none>:<none>"
            accent={danglingCount > 0 ? 'border-accent-orange' : 'border-panel-border'}
          />
        </div>

        {/* Filter + Prune Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.images.searchPlaceholder}
              className="input-field pl-9"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-panel-card border border-panel-border rounded-md p-1">
              {(
                [
                  ['all', t.images.filterAll],
                  ['inUse', t.images.filterInUse],
                  ['unused', t.images.filterUnused],
                  ['dangling', t.images.filterDangling],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilterMode(id)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    filterMode === id
                      ? 'bg-accent-purple text-white font-medium'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <SmallActionButton
              label={t.images.pruneDanglingBtn}
              disabled={busy}
              icon={<Sparkles className="w-3 h-3" />}
              onClick={() => postMessage('prune:images')}
            />
            <SmallActionButton
              label={t.images.pruneUnusedBtn}
              disabled={busy}
              onClick={() => postMessage('prune:all:images')}
            />
            <SmallActionButton
              label={t.images.clearBuildCacheBtn}
              disabled={busy}
              onClick={() => postMessage('prune:builder')}
            />
          </div>
        </div>

        {/* Images Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-8 h-8" />}
            title={t.images.emptyTitle}
            description={t.images.emptyDesc}
          />
        ) : (
          <div className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-panel-border text-text-secondary text-left bg-panel-bg">
                  <th className="px-4 py-3 font-medium">{t.images.colRepository}</th>
                  <th className="px-4 py-3 font-medium">{t.images.colTag}</th>
                  <th className="px-4 py-3 font-medium">{t.images.colId}</th>
                  <th className="px-4 py-3 font-medium">{t.images.colSize}</th>
                  <th className="px-4 py-3 font-medium">{t.images.colStatus}</th>
                  <th className="px-4 py-3 font-medium text-right">{t.images.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-border">
                {filtered.map((img) => (
                  <tr key={`${img.id}-${img.repository}-${img.tag}`} className="hover:bg-panel-card-hover">
                    <td className="px-4 py-3 font-mono font-medium text-text-primary break-all">
                      {img.repository}
                    </td>
                    <td className="px-4 py-3 font-mono text-accent-purple">{img.tag}</td>
                    <td className="px-4 py-3 font-mono text-text-muted">{img.id}</td>
                    <td className="px-4 py-3 font-mono text-text-secondary">{img.size}</td>
                    <td className="px-4 py-3">
                      {img.inUse ? (
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-green-500/15 text-accent-green border border-accent-green">
                          {fmt(t.status.inUse, { count: img.containers })}
                        </span>
                      ) : img.dangling ? (
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-yellow-500/15 text-accent-orange border border-accent-orange">
                          {t.status.dangling}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-panel-bg text-text-secondary border border-panel-border">
                          {t.status.available}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {!img.dangling && (
                          <SmallActionButton
                            label={t.common.run}
                            accent
                            icon={<Play className="w-3 h-3" />}
                            onClick={() => {
                              setRunImageTarget(img);
                              setRunContainerName('');
                              setRunPorts('');
                            }}
                          />
                        )}
                        {(settings?.enablePushCommand ?? true) && !img.dangling && (
                          <SmallActionButton
                            label={t.common.push}
                            icon={<Upload className="w-3 h-3" />}
                            onClick={() => openPushModal(img)}
                          />
                        )}
                        <SmallActionButton
                          label={t.common.delete}
                          danger
                          disabled={busy}
                          icon={<Trash2 className="w-3 h-3" />}
                          onClick={() =>
                            postMessage('image:remove', {
                              imageId: img.dangling ? img.id : `${img.repository}:${img.tag}`,
                            })
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Build Image Modal */}
      {showBuildModal && (
        <Modal
          title={fmt(t.images.buildModalTitle, { cmd: engineCmd })}
          subtitle={t.images.buildModalSubtitle}
          onClose={() => setShowBuildModal(false)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setShowBuildModal(false)} />
              <ActionPillButton
                label={t.images.startBuildBtn}
                variant="podman"
                disabled={!buildTag.trim() || !buildDockerfile.trim()}
                onClick={() => {
                  postMessage('image:build', {
                    dockerfile: buildDockerfile.trim(),
                    contextDir: buildContext.trim() || '.',
                    tag: buildTag.trim(),
                  });
                  setShowBuildModal(false);
                }}
              />
            </>
          }
        >
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t.images.containerfileLabel}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={buildDockerfile}
                onChange={(e) => setBuildDockerfile(e.target.value)}
                placeholder="Containerfile"
                className="input-field font-mono"
              />
              <ActionPillButton
                label={t.common.browse}
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                onClick={() => postMessage('image:dockerfile:pick')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.images.contextDirLabel}
              </label>
              <input
                type="text"
                value={buildContext}
                onChange={(e) => setBuildContext(e.target.value)}
                placeholder="."
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.images.targetTagLabel}
              </label>
              <input
                type="text"
                value={buildTag}
                onChange={(e) => setBuildTag(e.target.value)}
                placeholder="localhost/my-api:1.0.0"
                className="input-field font-mono"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Push Image Modal */}
      {pushTargetImage && (
        <Modal
          title={fmt(t.images.pushModalTitle, { cmd: engineCmd })}
          subtitle={fmt(t.images.pushModalSubtitle, {
            source: `${pushTargetImage.repository}:${pushTargetImage.tag}`,
          })}
          maxWidth="max-w-lg"
          onClose={() => setPushTargetImage(null)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setPushTargetImage(null)} />
              <ActionPillButton
                label={t.images.executePushBtn}
                variant="podman"
                disabled={!pushDestTag.trim()}
                onClick={() => {
                  postMessage('image:push', {
                    sourceImage: `${pushTargetImage.repository}:${pushTargetImage.tag}`,
                    targetTag: pushDestTag.trim(),
                  });
                  setPushTargetImage(null);
                }}
              />
            </>
          }
        >
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t.images.destRegistryTagLabel}
            </label>
            <input
              type="text"
              value={pushDestTag}
              onChange={(e) => setPushDestTag(e.target.value)}
              placeholder="quay.io/my-org/my-app:latest"
              className="input-field font-mono"
            />
          </div>
        </Modal>
      )}

      {/* Quick Run Modal */}
      {runImageTarget && (
        <Modal
          title={t.images.quickRunModalTitle}
          subtitle={`${runImageTarget.repository}:${runImageTarget.tag}`}
          maxWidth="max-w-lg"
          onClose={() => setRunImageTarget(null)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setRunImageTarget(null)} />
              <ActionPillButton
                label={t.images.runContainerBtn}
                variant="podman"
                onClick={() => {
                  postMessage('container:create', {
                    image: `${runImageTarget.repository}:${runImageTarget.tag}`,
                    name: runContainerName.trim() || undefined,
                    ports: runPorts
                      .split(',')
                      .map((p) => p.trim())
                      .filter(Boolean),
                  });
                  setRunImageTarget(null);
                }}
              />
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.images.containerNameOptional}
              </label>
              <input
                type="text"
                value={runContainerName}
                onChange={(e) => setRunContainerName(e.target.value)}
                placeholder="web-app"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.images.portsSimpleLabel}
              </label>
              <input
                type="text"
                value={runPorts}
                onChange={(e) => setRunPorts(e.target.value)}
                placeholder="8080:80"
                className="input-field font-mono"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
