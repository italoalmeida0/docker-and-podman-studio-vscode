import React, { useMemo, useState } from 'react';
import {
  FileText,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { LogViewer } from '../components/LogViewer';
import {
  isRunningState,
  PodmanBatchActions,
  usePodmanSelection,
} from '../components/PodmanBatchActions';
import {
  ActionPillButton,
  DetailRow,
  Modal,
  ResourceCardHeader,
  SmallActionButton,
  StatusBadge,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { useFeedbackTexts } from '../i18n/feedback';
import { PodmanPod, ServiceStatus, useStudioStore } from '../store';
import { useActionRequest } from '../useActionRequest';
import { useVsCodeMessaging } from '../vscode';

export const PodGroups: React.FC<{
  visiblePods: PodmanPod[];
  statusForPod: (pod: PodmanPod) => ServiceStatus;
  expandedPods: Record<string, boolean>;
  onTogglePod: (id: string) => void;
  renderContainers: (pod: PodmanPod) => React.ReactNode;
}> = ({ visiblePods, statusForPod, expandedPods, onTogglePod, renderContainers }) => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt } = useI18n();
  const feedback = useFeedbackTexts();
  const {
    pods,
    networks,
    operationInProgress,
    logEntries,
    logFilter,
    setLogFilter,
    clearLogs,
  } = useStudioStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [logModalPod, setLogModalPod] = useState<PodmanPod | null>(null);
  const [confirmDeletePod, setConfirmDeletePod] = useState<PodmanPod | null>(null);

  // Create Pod Form
  const [podName, setPodName] = useState('');
  const [hostname, setHostname] = useState('');
  const [portsText, setPortsText] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [addHostsText, setAddHostsText] = useState('');
  const [cpuShares, setCpuShares] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const createPod = useActionRequest('pod:create', () => {
    setShowCreateModal(false);
    setPodName('');
    setHostname('');
    setPortsText('');
    setSelectedNetwork('');
    setAddHostsText('');
    setCpuShares('');
    setLabelsText('');
  });

  const busy = Boolean(operationInProgress);

  const selectable = useMemo(() => pods.filter((pod) => Boolean(pod.fullId)), [pods]);
  const visibleSelectable = useMemo(
    () => visiblePods.filter((pod) => Boolean(pod.fullId)),
    [visiblePods]
  );
  const selection = usePodmanSelection(selectable, visibleSelectable, true);

  const handleCreatePod = () => {
    if (busy || createPod.pending) return;
    const splitCsvOrLines = (raw: string) =>
      raw
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

    createPod.run({
      name: podName.trim() || undefined,
      hostname: hostname.trim() || undefined,
      ports: splitCsvOrLines(portsText),
      network: selectedNetwork.trim() || undefined,
      additionalHosts: splitCsvOrLines(addHostsText),
      cpuShares: cpuShares.trim() || undefined,
      labels: splitCsvOrLines(labelsText),
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{t.pods.title}</h2>
        <ActionPillButton
          label={t.pods.createPodBtn}
          variant="podman"
          disabled={busy}
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCreateModal(true)}
        />
      </div>

      <PodmanBatchActions
        selection={selection}
        busy={busy}
        resourceLabel={t.pods.title}
        onAction={(action, ids) => postMessage('pod:batch', { action, ids })}
      />

      <div className="space-y-3">
        {visiblePods.map((pod) => {
          const podKey = pod.fullId || pod.id;
          const expanded = expandedPods[podKey] !== false;
          const isRunning = isRunningState(pod.state);
          const isPaused = pod.state === 'paused';
          return (
            <div
              key={pod.fullId || pod.id}
              className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card"
            >
              <ResourceCardHeader
                name={pod.name}
                expanded={expanded}
                onToggle={() => onTogglePod(podKey)}
                selection={pod.fullId && (
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    aria-label={fmt(t.common.selectResource, { name: pod.name })}
                    checked={selection.selectedIds.has(pod.fullId)}
                    disabled={busy}
                    onChange={() => selection.toggle(pod.fullId)}
                  />
                )}
                status={<StatusBadge status={statusForPod(pod)} title={feedback.groupStatusHint} />}
                actions={
                  <>
                    <SmallActionButton
                      label={t.common.start}
                      accent
                      disabled={busy || isRunning || isPaused}
                      icon={<Play className="w-3 h-3" />}
                      onClick={() => postMessage('pod:start', { podId: pod.fullId || pod.id })}
                    />
                    <SmallActionButton
                      label={t.common.stop}
                      disabled={busy || !isRunning || pod.state === 'stopping'}
                      icon={<Square className="w-3 h-3" />}
                      onClick={() => postMessage('pod:stop', { podId: pod.fullId || pod.id })}
                    />
                    <SmallActionButton
                      label={t.common.restart}
                      disabled={busy || isPaused || pod.state === 'stopping'}
                      icon={<RotateCcw className="w-3 h-3" />}
                      onClick={() => postMessage('pod:restart', { podId: pod.fullId || pod.id })}
                    />
                    <SmallActionButton
                      label={isPaused ? t.common.resume : t.common.pause}
                      disabled={busy || (!isPaused && !isRunning)}
                      icon={isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      onClick={() =>
                        postMessage(isPaused ? 'pod:unpause' : 'pod:pause', {
                          podId: pod.fullId,
                        })
                      }
                    />
                    <SmallActionButton
                      label={t.common.logs}
                      icon={<FileText className="w-3 h-3" />}
                      onClick={() => {
                        clearLogs();
                        setLogModalPod(pod);
                        postMessage('pod:logs', { podId: pod.fullId || pod.id, podName: pod.name });
                      }}
                    />
                    <SmallActionButton
                      label={t.common.delete}
                      danger
                      disabled={busy}
                      icon={<Trash2 className="w-3 h-3" />}
                      onClick={() => setConfirmDeletePod(pod)}
                    />
                  </>
                }
              >
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-text-primary break-all">
                    {pod.name}
                  </span>
                  <span className="text-xs font-mono text-text-muted break-all">{pod.id}</span>
                  <span className="max-w-full break-words px-2 py-0.5 text-[11px] rounded bg-panel-bg border border-panel-border text-text-secondary">
                    {fmt(t.pods.containersCount, { count: pod.containers.length })}
                  </span>
                </span>
                <span className="block text-xs text-text-secondary mt-0.5 truncate"
                  title={`${t.pods.networksLabel}: ${pod.networks.join(', ') || t.common.default} · ${t.pods.createdLabel}: ${pod.created || '-'}`}>
                  {t.pods.networksLabel}: {pod.networks.join(', ') || t.common.default} ·{' '}
                  {t.pods.createdLabel}: {pod.created || '-'}
                </span>
              </ResourceCardHeader>

              {expanded && (
                <div className="border-t border-panel-border bg-panel-bg px-2 sm:px-4 py-4 space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <DetailRow label={t.pods.fullPodId} value={pod.fullId} />
                    <DetailRow label={t.pods.infraContainerId} value={pod.infraId || '-'} />
                    <DetailRow label={t.pods.rawStatus} value={pod.status} />
                    <DetailRow label={t.pods.networksLabel} value={pod.networks.join(', ') || '-'} />
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
                      {fmt(t.pods.memberContainers, { count: pod.containers.length })}
                    </div>
                    <div className="space-y-2 border-l-2 border-panel-border pl-2 sm:pl-4">
                      {renderContainers(pod)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Pod Modal */}
      {showCreateModal && (
        <Modal
          title={t.pods.createModalTitle}
          subtitle={t.pods.createModalSubtitle}
          feedback
          lockFields={createPod.pending}
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <ActionPillButton label={createPod.pending ? t.common.close : t.common.cancel} onClick={() => setShowCreateModal(false)} />
              <ActionPillButton
                label={t.pods.createPodBtn}
                variant="podman"
                loading={createPod.pending}
                disabled={busy}
                onClick={handleCreatePod}
              />
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">{t.pods.podNameLabel}</label>
              <input
                type="text"
                value={podName}
                onChange={(e) => setPodName(e.target.value)}
                placeholder="backend-pod"
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">{t.pods.hostnameLabel}</label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="api.local"
                className="input-field"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.pods.publishedPortsLabel}
              </label>
              <input
                type="text"
                value={portsText}
                onChange={(e) => setPortsText(e.target.value)}
                placeholder="8080:80, 5432:5432"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">{t.pods.networkLabel}</label>
              <select
                value={selectedNetwork}
                onChange={(e) => setSelectedNetwork(e.target.value)}
                className="input-field"
              >
                <option value="">{t.pods.defaultPodmanNetwork}</option>
                {networks.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} ({n.driver})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.pods.extraHostsLabel}
              </label>
              <input
                type="text"
                value={addHostsText}
                onChange={(e) => setAddHostsText(e.target.value)}
                placeholder="auth.internal:10.88.0.5"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.pods.cpuSharesLabel}
              </label>
              <input
                type="number"
                value={cpuShares}
                onChange={(e) => setCpuShares(e.target.value)}
                placeholder="1024"
                className="input-field font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t.pods.labelsLabel}
            </label>
            <input
              type="text"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder="env=dev, tier=backend"
              className="input-field font-mono"
            />
          </div>
        </Modal>
      )}

      {/* Pod Logs Modal */}
      {logModalPod && (
        <Modal
          title={fmt(t.pods.logsModalTitle, { name: logModalPod.name })}
          subtitle={fmt(t.pods.logsModalSubtitle, {
            id: logModalPod.id,
            count: logEntries.length,
          })}
          maxWidth="max-w-4xl"
          feedback
          onClose={() => setLogModalPod(null)}
          footer={
            <>
              <SmallActionButton
                label={t.common.reloadLogs}
                onClick={() =>
                  postMessage('pod:logs', {
                    podId: logModalPod.fullId || logModalPod.id,
                    podName: logModalPod.name,
                  })
                }
              />
              <ActionPillButton label={t.common.close} onClick={() => setLogModalPod(null)} />
            </>
          }
        >
          <div className="h-[460px] flex flex-col gap-3">
            <input
              type="text"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              placeholder={t.common.filterLogsPlaceholder}
              className="input-field"
            />
            <LogViewer entries={logEntries} filter={logFilter} />
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeletePod && (
        <Modal
          title={t.pods.deleteModalTitle}
          subtitle={t.pods.deleteModalSubtitle}
          maxWidth="max-w-md"
          onClose={() => setConfirmDeletePod(null)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setConfirmDeletePod(null)} />
              <ActionPillButton
                label={t.pods.deleteModalTitle}
                variant="danger"
                onClick={() => {
                  postMessage('pod:remove', { podId: confirmDeletePod.fullId || confirmDeletePod.id });
                  setConfirmDeletePod(null);
                }}
              />
            </>
          }
        >
          <p className="text-xs text-text-secondary leading-5">
            {fmt(t.pods.deleteModalConfirm, {
              name: confirmDeletePod.name,
              count: confirmDeletePod.containers.length,
            })}
          </p>
        </Modal>
      )}
    </>
  );
};
