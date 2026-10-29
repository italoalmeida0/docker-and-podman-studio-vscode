import React, { useMemo, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  FileText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { LogViewer } from '../components/LogViewer';
import {
  ActionPillButton,
  DetailRow,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
  StatusBadge,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { PodmanPod, useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

export const PodsPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, changeEngine } = useI18n();
  const {
    pods,
    networks,
    operationInProgress,
    logEntries,
    logFilter,
    setLogFilter,
    clearLogs,
  } = useStudioStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [expandedPods, setExpandedPods] = useState<Record<string, boolean>>({});
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

  const busy = Boolean(operationInProgress);

  const filteredPods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pods.filter((pod) => {
      if (statusFilter === 'running' && pod.state !== 'running') {
        return false;
      }
      if (statusFilter === 'stopped' && pod.state === 'running') {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        pod.name.toLowerCase().includes(q) ||
        pod.id.toLowerCase().includes(q) ||
        pod.networks.some((n) => n.toLowerCase().includes(q)) ||
        pod.containers.some((c) => c.name.toLowerCase().includes(q))
      );
    });
  }, [pods, search, statusFilter]);

  const runningCount = pods.filter((p) => p.state === 'running').length;
  const totalPodContainers = pods.reduce((acc, p) => acc + p.containers.length, 0);

  const handleCreatePod = () => {
    const splitCsvOrLines = (raw: string) =>
      raw
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

    postMessage('pod:create', {
      name: podName.trim() || undefined,
      hostname: hostname.trim() || undefined,
      ports: splitCsvOrLines(portsText),
      network: selectedNetwork.trim() || undefined,
      additionalHosts: splitCsvOrLines(addHostsText),
      cpuShares: cpuShares.trim() || undefined,
      labels: splitCsvOrLines(labelsText),
    });
    setShowCreateModal(false);
    setPodName('');
    setHostname('');
    setPortsText('');
    setSelectedNetwork('');
    setAddHostsText('');
    setCpuShares('');
    setLabelsText('');
  };

  if (engine === 'docker') {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Boxes className="w-5 h-5 text-accent-blue" />
              <span>{t.pods.title}</span>
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">{t.pods.subtitle}</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
          <div className="max-w-xl w-full">
            <EmptyState
              icon={<Boxes className="w-10 h-10 text-accent-purple" />}
              title={t.pods.dockerModeTitle}
              description={t.pods.dockerModeDesc}
              action={
                <ActionPillButton
                  label={t.pods.switchToPodmanBtn}
                  variant="brand"
                  icon={<Boxes className="w-3.5 h-3.5" />}
                  onClick={() => changeEngine('podman')}
                />
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-text-primary">
            {t.pods.title}
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.pods.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.pods.createPodBtn}
            variant="podman"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreateModal(true)}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('pods:list')}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={t.pods.totalPods}
            value={pods.length}
            detail={fmt(t.pods.runningDetail, { count: runningCount })}
            accent={runningCount > 0 ? 'border-accent-purple' : 'border-panel-border'}
          />
          <StatCard
            label={t.pods.stoppedPods}
            value={pods.length - runningCount}
            detail={t.pods.readyToStart}
          />
          <StatCard
            label={t.pods.containersInPods}
            value={totalPodContainers}
            detail={t.pods.includingInfra}
          />
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.pods.searchPlaceholder}
              className="input-field pl-9"
            />
          </div>
          <div className="flex items-center gap-1.5 bg-panel-card border border-panel-border rounded-md p-1">
            {(
              [
                ['all', t.common.all],
                ['running', t.pods.filterRunning],
                ['stopped', t.pods.filterStopped],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`px-3 py-1 text-xs rounded-md transition-colors border ${
                  statusFilter === id
                    ? 'bg-white/[0.11] text-text-primary border-white/[0.12] font-medium shadow-sm'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Pods List */}
        {filteredPods.length === 0 ? (
          <EmptyState
            icon={<Boxes className="w-8 h-8" />}
            title={pods.length === 0 ? t.pods.emptyNoPods : t.pods.emptyNoMatch}
            description={t.pods.emptyDesc}
            action={
              <ActionPillButton
                label={t.pods.createNewPodBtn}
                variant="podman"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCreateModal(true)}
              />
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredPods.map((pod) => {
              const expanded = Boolean(expandedPods[pod.id]);
              const isRunning = pod.state === 'running';
              return (
                <div
                  key={pod.fullId || pod.id}
                  className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card"
                >
                  <div className="px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                    <div
                      className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                      onClick={() =>
                        setExpandedPods((prev) => ({ ...prev, [pod.id]: !prev[pod.id] }))
                      }
                    >
                      <StatusBadge status={pod.state} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-text-primary truncate">
                            {pod.name}
                          </span>
                          <span className="text-xs font-mono text-text-muted">{pod.id}</span>
                          <span className="px-2 py-0.5 text-[11px] rounded bg-panel-bg border border-panel-border text-text-secondary">
                            {fmt(t.pods.containersCount, { count: pod.containers.length })}
                          </span>
                        </div>
                        <div className="text-xs text-text-secondary mt-0.5 truncate">
                          {t.pods.networksLabel}: {pod.networks.join(', ') || t.common.default} ·{' '}
                          {t.pods.createdLabel}: {pod.created || '-'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <SmallActionButton
                        label={t.common.start}
                        accent
                        disabled={busy || isRunning}
                        icon={<Play className="w-3 h-3" />}
                        onClick={() => postMessage('pod:start', { podId: pod.id })}
                      />
                      <SmallActionButton
                        label={t.common.stop}
                        disabled={busy || !isRunning}
                        icon={<Square className="w-3 h-3" />}
                        onClick={() => postMessage('pod:stop', { podId: pod.id })}
                      />
                      <SmallActionButton
                        label={t.common.restart}
                        disabled={busy}
                        icon={<RotateCcw className="w-3 h-3" />}
                        onClick={() => postMessage('pod:restart', { podId: pod.id })}
                      />
                      <SmallActionButton
                        label={t.common.logs}
                        icon={<FileText className="w-3 h-3" />}
                        onClick={() => {
                          clearLogs();
                          setLogModalPod(pod);
                          postMessage('pod:logs', { podId: pod.id, podName: pod.name });
                        }}
                      />
                      <SmallActionButton
                        label={t.common.delete}
                        danger
                        disabled={busy}
                        icon={<Trash2 className="w-3 h-3" />}
                        onClick={() => setConfirmDeletePod(pod)}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPods((prev) => ({ ...prev, [pod.id]: !prev[pod.id] }))
                        }
                        className="p-1.5 rounded border border-panel-border text-text-secondary hover:text-text-primary"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-panel-border bg-panel-bg px-4 py-4 space-y-4">
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
                        <div className="grid grid-cols-2 gap-2">
                          {pod.containers.map((c) => (
                            <div
                              key={c.id}
                              className="bg-panel-card border border-panel-border rounded px-3 py-2 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-text-primary truncate">{c.name}</div>
                                <div className="font-mono text-[11px] text-text-muted">
                                  {c.id.slice(0, 12)} · {t.pods.restarts}: {c.restartCount}
                                </div>
                              </div>
                              <StatusBadge
                                status={c.status.toLowerCase().includes('run') ? 'running' : 'stopped'}
                                customLabel={c.status}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Pod Modal */}
      {showCreateModal && (
        <Modal
          title={t.pods.createModalTitle}
          subtitle={t.pods.createModalSubtitle}
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setShowCreateModal(false)} />
              <ActionPillButton
                label={t.pods.createPodBtn}
                variant="podman"
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
          onClose={() => setLogModalPod(null)}
          footer={
            <>
              <SmallActionButton
                label={t.common.reloadLogs}
                onClick={() =>
                  postMessage('pod:logs', { podId: logModalPod.id, podName: logModalPod.name })
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
                  postMessage('pod:remove', { podId: confirmDeletePod.id });
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
    </div>
  );
};
