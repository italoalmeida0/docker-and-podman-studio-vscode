import React, { useMemo, useState } from 'react';
import {
  Box,
  ChevronDown,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Terminal,
} from 'lucide-react';
import { ContainerCard } from '../components/ContainerCard';
import { LogViewer } from '../components/LogViewer';
import {
  isRunningState,
  PodmanBatchActions,
  usePodmanSelection,
} from '../components/PodmanBatchActions';
import {
  ActionPillButton,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
} from '../components/Shared';
import { buildContainerTree, containerFilterForEngine } from '../containerTree';
import { useI18n } from '../i18n';
import { PodmanContainer, useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';
import { PodGroups } from './PodsPage';

export const ContainersPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const isPodman = engine === 'podman';
  const {
    allContainers,
    pods,
    images,
    volumes,
    networks,
    operationInProgress,
    logEntries,
    logFilter,
    setLogFilter,
    clearLogs,
  } = useStudioStore();

  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'running' | 'stopped' | 'pod' | 'compose'>('all');
  const [showInfra, setShowInfra] = useState(false);
  const [expandedPods, setExpandedPods] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<'simple' | 'advanced'>('simple');
  const [logContainer, setLogContainer] = useState<PodmanContainer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PodmanContainer | null>(null);

  // Create Container Form
  const [cImage, setCImage] = useState('docker.io/library/nginx:alpine');
  const [cName, setCName] = useState('');
  const [cPod, setCPod] = useState('');
  const [cPorts, setCPorts] = useState('');
  const [cVolumeSpec, setCVolumeSpec] = useState('');
  const [cNetwork, setCNetwork] = useState('');
  const [cEnv, setCEnv] = useState('');
  const [cCpus, setCCpus] = useState('');
  const [cMemory, setCMemory] = useState('');
  const [cMounts, setCMounts] = useState('');
  const [cRestart, setCRestart] = useState('unless-stopped');
  const [cCommand, setCCommand] = useState('');

  const busy = Boolean(operationInProgress);

  const visibleBase = useMemo(
    () => (showInfra ? allContainers : allContainers.filter((c) => !c.isInfra)),
    [allContainers, showInfra]
  );

  const activeFilter = containerFilterForEngine(filterTab, engine);
  const tree = useMemo(
    () => buildContainerTree(visibleBase, pods, engine, activeFilter, search),
    [visibleBase, pods, engine, activeFilter, search]
  );
  const visiblePods = useMemo(() => tree.podGroups.map((group) => group.pod), [tree.podGroups]);

  const selectable = useMemo(
    () => allContainers.filter((c) => !c.isInfra && Boolean(c.fullId)),
    [allContainers]
  );
  const visibleSelectable = useMemo(
    () => [
      ...tree.standalone,
      ...tree.podGroups.flatMap(({ pod, containers }) =>
        expandedPods[pod.fullId || pod.id] === false ? [] : containers
      ),
      ...tree.composeGroups.flatMap(({ project, containers }) =>
        expandedProjects[project] === false ? [] : containers
      ),
    ].filter((c) => !c.isInfra && Boolean(c.fullId)),
    [tree, expandedPods, expandedProjects]
  );
  const selection = usePodmanSelection(selectable, visibleSelectable, isPodman);
  const runningCount = visibleBase.filter((c) => isRunningState(c.state)).length;
  const stoppedCount = visibleBase.filter(
    (c) => c.state === 'stopped' || c.state === 'exited'
  ).length;
  const podBoundCount = visibleBase.filter((c) => Boolean(c.podId)).length;
  const composeBoundCount = visibleBase.filter((c) => c.isCompose).length;

  const handleCreateContainer = () => {
    if (!cImage.trim()) {
      return;
    }
    const splitList = (raw: string) =>
      raw
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const splitLines = (raw: string) =>
      raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

    postMessage('container:create', {
      image: cImage.trim(),
      name: cName.trim() || undefined,
      pod: createMode === 'advanced' && cPod ? cPod : undefined,
      ports: isPodman && createMode === 'advanced' && cPod ? [] : splitList(cPorts),
      volumes: createMode === 'advanced' ? splitLines(cVolumeSpec) : [],
      network: createMode === 'advanced' && cNetwork && !cPod ? cNetwork : undefined,
      env: createMode === 'advanced' ? splitLines(cEnv) : [],
      cpus: createMode === 'advanced' && cCpus.trim() ? cCpus.trim() : undefined,
      memory: createMode === 'advanced' && cMemory.trim() ? cMemory.trim() : undefined,
      mounts: createMode === 'advanced' ? splitLines(cMounts) : [],
      restart: createMode === 'advanced' ? cRestart : undefined,
      command: createMode === 'advanced' && cCommand.trim() ? cCommand.trim() : undefined,
    });
    setShowCreateModal(false);
  };

  const renderContainers = (containers: PodmanContainer[], pod?: (typeof pods)[number]) =>
    containers.map((container) => {
      const podMember = pod?.containers.find((member) =>
        member.id && container.fullId &&
        (container.fullId.startsWith(member.id) || member.id.startsWith(container.fullId))
      );
      return (
        <ContainerCard
          key={container.fullId || container.id}
          container={container}
          busy={busy}
          selected={selection.selectedIds.has(container.fullId)}
          onToggleSelection={() => selection.toggle(container.fullId)}
          onLogs={() => {
            clearLogs();
            setLogContainer(container);
            postMessage('container:logs', {
              containerId: isPodman ? container.fullId || container.id : container.id,
              name: container.name,
            });
          }}
          onDelete={() => setDeleteTarget(container)}
          restartCount={podMember?.restartCount}
        />
      );
    });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Box className={`w-5 h-5 ${isPodman ? 'text-accent-purple' : 'text-accent-blue'}`} />
            <span>{fmt(t.containers.title, { engine: engineLabel })}</span>
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.containers.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.containers.createContainerBtn}
            variant="brand"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreateModal(true)}
          />
          <ActionPillButton
            label={t.common.refresh}
            loading={busy}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('containers:list')}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={t.containers.statRunning}
            value={runningCount}
            detail={fmt(t.containers.statTotalDetail, { count: visibleBase.length })}
            accent={runningCount > 0 ? 'border-accent-green' : 'border-panel-border'}
          />
          <StatCard
            label={t.containers.statStopped}
            value={stoppedCount}
            detail={t.containers.statStoppedDetail}
          />
          {isPodman ? (
            <StatCard
              label={t.containers.statInPods}
              value={podBoundCount}
              detail={t.containers.statInPodsDetail}
            />
          ) : (
            <StatCard
              label={t.containers.statCompose}
              value={composeBoundCount}
              detail={t.containers.statComposeDetail}
            />
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.containers.searchPlaceholder}
              className="input-field pl-9"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isPodman && (
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={showInfra}
                  onChange={(e) => setShowInfra(e.target.checked)}
                />
                {t.containers.showInfra}
              </label>
            )}

            <div className="flex items-center gap-1 bg-panel-card border border-panel-border rounded-md p-1">
              {(
                [
                  ['all', t.common.all],
                  ['running', t.containers.tabRunning],
                  ['stopped', t.containers.tabStopped],
                  ...(isPodman ? ([['pod', t.containers.tabInPods]] as const) : []),
                  ['compose', t.containers.tabCompose],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilterTab(id)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    activeFilter === id
                      ? `${isPodman ? 'bg-accent-purple' : 'bg-accent-blue'} text-white font-medium`
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isPodman && (
          <PodmanBatchActions
            selection={selection}
            busy={busy}
            onAction={(action, ids) => postMessage('container:batch', { action, ids })}
          />
        )}

        {isPodman && (
          <PodGroups
            visiblePods={visiblePods}
            expandedPods={expandedPods}
            onTogglePod={(id) => setExpandedPods((previous) => ({
              ...previous,
              [id]: previous[id] === false,
            }))}
            renderContainers={(pod) => {
              const group = tree.podGroups.find((item) => item.pod === pod);
              return group?.containers.length
                ? renderContainers(group.containers, pod)
                : <div className="text-xs text-text-muted">{t.common.none}</div>;
            }}
          />
        )}

        {tree.composeGroups.map(({ project, containers }) => {
          const expanded = expandedProjects[project] !== false;
          return (
            <section key={project} className="bg-panel-card border border-panel-border rounded-md overflow-hidden">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedProjects((previous) => ({
                  ...previous,
                  [project]: previous[project] === false,
                }))}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left"
              >
                <span className="font-semibold text-sm text-text-primary">
                  Compose: {project} <span className="text-text-muted">({containers.length})</span>
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && (
                <div className="border-t border-panel-border bg-panel-bg p-4 space-y-2 border-l-2">
                  {renderContainers(containers)}
                </div>
              )}
            </section>
          );
        })}

        {tree.standalone.length > 0 && (
          <div className="space-y-2.5">{renderContainers(tree.standalone)}</div>
        )}

        {tree.filtered.length === 0 && tree.podGroups.length === 0 && (
          <EmptyState
            icon={<Box className="w-8 h-8" />}
            title={t.containers.emptyTitle}
            description={fmt(t.containers.emptyDesc, { engine: engineLabel })}
            action={
              <ActionPillButton
                label={t.containers.createContainerBtn}
                variant="brand"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCreateModal(true)}
              />
            }
          />
        )}
      </div>

      {/* Create Container Modal (Simple & Advanced) */}
      {showCreateModal && (
        <Modal
          title={fmt(t.containers.createModalTitle, { engine: engineLabel })}
          subtitle={t.containers.createModalSubtitle}
          maxWidth="max-w-3xl"
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setShowCreateModal(false)} />
              <ActionPillButton
                label={fmt(t.containers.runContainerBtn, { cmd: engineCmd })}
                variant="brand"
                disabled={!cImage.trim()}
                onClick={handleCreateContainer}
              />
            </>
          }
        >
          <div className="flex items-center gap-2 border-b border-panel-border pb-3">
            <button
              type="button"
              onClick={() => setCreateMode('simple')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium ${
                createMode === 'simple'
                  ? 'bg-accent-purple text-white'
                  : 'bg-panel-bg text-text-secondary border border-panel-border'
              }`}
            >
              {t.containers.simpleMode}
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('advanced')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium ${
                createMode === 'advanced'
                  ? 'bg-accent-purple text-white'
                  : 'bg-panel-bg text-text-secondary border border-panel-border'
              }`}
            >
              {t.containers.advancedMode}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.containers.ociImageLabel}
              </label>
              <input
                type="text"
                list="podman-local-images"
                value={cImage}
                onChange={(e) => setCImage(e.target.value)}
                placeholder="docker.io/library/nginx:alpine"
                className="input-field font-mono"
              />
              <datalist id="podman-local-images">
                {images
                  .filter((i) => !i.dangling)
                  .map((i) => (
                    <option key={i.id} value={`${i.repository}:${i.tag}`} />
                  ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.containers.containerNameLabel}
              </label>
              <input
                type="text"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="my-container"
                className="input-field font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t.containers.portsLabel}
            </label>
            <input
              type="text"
              value={cPorts}
              onChange={(e) => setCPorts(e.target.value)}
              disabled={isPodman && createMode === 'advanced' && Boolean(cPod)}
              placeholder="8080:80, 8443:443"
              className="input-field font-mono"
            />
          </div>

          {createMode === 'advanced' && (
            <div className="space-y-3 pt-2 border-t border-panel-border">
              <div className={`grid ${isPodman ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
                {isPodman && (
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.containers.joinPodLabel}
                    </label>
                    <select
                      value={cPod}
                      onChange={(e) => setCPod(e.target.value)}
                      className="input-field"
                    >
                      <option value="">{t.containers.noneStandalone}</option>
                      {pods.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name} ({p.state})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.networkLabel}
                  </label>
                  <select
                    value={cNetwork}
                    onChange={(e) => setCNetwork(e.target.value)}
                    disabled={Boolean(cPod)}
                    className="input-field"
                  >
                    <option value="">{t.common.default}</option>
                    {networks.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.restartPolicyLabel}
                  </label>
                  <select
                    value={cRestart}
                    onChange={(e) => setCRestart(e.target.value)}
                    className="input-field"
                  >
                    <option value="no">no</option>
                    <option value="on-failure">on-failure</option>
                    <option value="always">always</option>
                    <option value="unless-stopped">unless-stopped</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.volumesLabel}
                  </label>
                  <textarea
                    value={cVolumeSpec}
                    onChange={(e) => setCVolumeSpec(e.target.value)}
                    placeholder={
                      volumes[0] ? `${volumes[0].name}:/data` : 'app-data:/var/lib/data'
                    }
                    className="input-field min-h-20 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.envVarsLabel}
                  </label>
                  <textarea
                    value={cEnv}
                    onChange={(e) => setCEnv(e.target.value)}
                    placeholder={'NODE_ENV=production\nPORT=3000'}
                    className="input-field min-h-20 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.cpuLimitLabel}
                  </label>
                  <input
                    type="text"
                    value={cCpus}
                    onChange={(e) => setCCpus(e.target.value)}
                    placeholder="1.5"
                    className="input-field font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.memoryLimitLabel}
                  </label>
                  <input
                    type="text"
                    value={cMemory}
                    onChange={(e) => setCMemory(e.target.value)}
                    placeholder={t.containers.memoryPlaceholder}
                    className="input-field font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">
                    {t.containers.customCommandLabel}
                  </label>
                  <input
                    type="text"
                    value={cCommand}
                    onChange={(e) => setCCommand(e.target.value)}
                    placeholder="nginx -g 'daemon off;'"
                    className="input-field font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t.containers.advancedMountsLabel}
                </label>
                <input
                  type="text"
                  value={cMounts}
                  onChange={(e) => setCMounts(e.target.value)}
                  placeholder="type=tmpfs,destination=/tmp"
                  className="input-field font-mono text-xs"
                />
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Logs Modal with Flexible External Output */}
      {logContainer && (
        <Modal
          title={fmt(t.containers.logsModalTitle, { name: logContainer.name })}
          subtitle={`${logContainer.image} (${logContainer.id})`}
          maxWidth="max-w-4xl"
          onClose={() => setLogContainer(null)}
          footer={
            <>
              <SmallActionButton
                label={t.containers.openOutputChannel}
                icon={<ExternalLink className="w-3 h-3" />}
                onClick={() =>
                  postMessage('container:logs:external', {
                    containerId: isPodman ? logContainer.fullId || logContainer.id : logContainer.id,
                    name: logContainer.name,
                    mode: 'outputChannel',
                  })
                }
              />
              <SmallActionButton
                label={t.containers.followInTerminal}
                icon={<Terminal className="w-3 h-3" />}
                onClick={() =>
                  postMessage('container:logs:external', {
                    containerId: isPodman ? logContainer.fullId || logContainer.id : logContainer.id,
                    name: logContainer.name,
                    mode: 'terminal',
                  })
                }
              />
              <SmallActionButton
                label={t.common.refresh}
                onClick={() =>
                  postMessage('container:logs', {
                    containerId: isPodman ? logContainer.fullId || logContainer.id : logContainer.id,
                    name: logContainer.name,
                  })
                }
              />
              <ActionPillButton label={t.common.close} onClick={() => setLogContainer(null)} />
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

      {/* Delete Modal */}
      {deleteTarget && (
        <Modal
          title={t.containers.deleteModalTitle}
          subtitle={fmt(t.containers.deleteModalSubtitle, {
            engine: engineLabel,
            cmd: engineCmd,
          })}
          maxWidth="max-w-md"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setDeleteTarget(null)} />
              <ActionPillButton
                label={t.containers.deleteModalTitle}
                variant="danger"
                onClick={() => {
                  postMessage('container:remove', {
                    containerId: isPodman ? deleteTarget.fullId || deleteTarget.id : deleteTarget.id,
                  });
                  setDeleteTarget(null);
                }}
              />
            </>
          }
        >
          <p className="text-xs text-text-secondary leading-5">
            {fmt(t.containers.deleteModalConfirm, { name: deleteTarget.name })}
          </p>
        </Modal>
      )}
    </div>
  );
};
