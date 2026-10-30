import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  Edit3,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Hammer,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { CreateComposeModal } from '../components/CreateComposeModal';
import { ComposeOptionsModal } from '../components/ComposeOptionsModal';
import { LogViewer } from '../components/LogViewer';
import { SelectionBar, useResourceSelection } from '../components/ResourceSelection';
import {
  ActionPillButton,
  CodeBlockCard,
  DetailRow,
  EmptyState,
  Modal,
  SmallActionButton,
  StatCard,
  StatusBadge,
} from '../components/Shared';
import { TopologyView } from '../components/TopologyView';
import { VisualServiceEditor } from '../components/VisualServiceEditor';
import { groupComposeContainers, parseDesiredReplicas, summarizeComposeService } from '../composeStatus';
import { displayEnvironmentValue, environmentLines } from '../composeSecrets';
import { composeLogKey, composeLogReplicaSignature } from '../../../src/shared/composeLogs';
import { ComposeBuilderSpec, validateComposeBuilder } from '../../../src/shared/composeBuilder';
import { applyVisualServiceDraft, createVisualServiceDraft } from '../../../src/shared/composeVisualEdit';
import { useI18n } from '../i18n';
import { useComposeExtras } from '../i18n/composeExtras';
import { LogEntry, useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

type ComposeTab =
  | 'overview'
  | 'topology'
  | 'services'
  | 'variables'
  | 'resources'
  | 'yaml'
  | 'logs'
  | 'builder';

const serviceSelectionKey = (name: string) => name;

function toStringList(value: any): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) =>
      v === null || v === undefined || typeof v === 'object' ? k : `${k}=${v}`
    );
  }
  return [String(value)];
}

export const ComposePage: React.FC = () => {
  const { t, fmt, engine, engineLabel } = useI18n();
  const extra = useComposeExtras();
  const { postMessage, onMessage } = useVsCodeMessaging();
  const {
    document,
    activeFile,
    rawYaml,
    composeParseError,
    composeProject,
    serviceFragments,
    composeDrafts,
    composeServiceDrafts,
    pendingComposeEdits,
    setComposeDraft,
    setComposeServiceDraft,
    beginComposeEdit,
    composeFiles,
    composeContainers,
    operationInProgress,
    logEntries,
    logFilter,
    setLogFilter,
    clearLogs,
    setActiveLogTarget,
  } = useStudioStore();

  const [tab, setTab] = useState<ComposeTab>('overview');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProjectOptions, setShowProjectOptions] = useState(false);
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({});
  const [removeServiceTarget, setRemoveServiceTarget] = useState<string | null>(null);
  const [scaleTarget, setScaleTarget] = useState<string | null>(null);
  const [scaleReplicas, setScaleReplicas] = useState('');
  const [showSensitive, setShowSensitive] = useState(false);
  const [serviceEditError, setServiceEditError] = useState('');

  useEffect(() => {
    setScaleTarget(null);
    setShowProjectOptions(false);
    setServiceEditError('');
  }, [activeFile, engine]);

  const draft = activeFile ? composeDrafts[activeFile] : undefined;
  const yamlDraft = draft?.text ?? rawYaml;
  const yamlDirty = Boolean(draft && draft.text !== draft.base);
  const yamlConflict = Boolean(yamlDirty && draft && draft.base !== rawYaml);
  const serviceDraft = activeFile ? composeServiceDrafts[activeFile] : undefined;
  const editingService = serviceDraft?.name ?? null;
  const serviceYamlDraft = serviceDraft?.text ?? '';
  const savingYaml = Object.values(pendingComposeEdits).some((edit) =>
    edit.file === activeFile && edit.kind === 'raw');
  const projectReady = Boolean(composeProject.revision && !composeProject.error && !composeProject.resolving);
  const editorContextBlocked = yamlDirty || savingYaml || Boolean(composeParseError) || !projectReady;
  const projectActionsBlocked = editorContextBlocked || Boolean(serviceDraft);
  const visualEditingBlocked = editorContextBlocked || composeProject.customized;
  const otherVisualEditsBlocked = visualEditingBlocked || Boolean(serviceDraft);
  const editContext = { file: activeFile, engine, projectRevision: composeProject.revision };
  const actionContext = { ...editContext, rawYaml };
  const pendingEdits = useRef(new Map<string, {
    file: string;
    kind: 'service' | 'builder' | 'raw';
    name: string;
    snapshot?: string;
  }>());
  const builderSnapshot = useRef('');

  useEffect(() => onMessage((message) => {
    if ((message.command !== 'compose:edit:saved' && message.command !== 'compose:edit:failed') ||
        !message.requestId) return;
    const pending = pendingEdits.current.get(message.requestId);
    pendingEdits.current.delete(message.requestId);
    if (pending?.kind === 'builder' && message.command === 'compose:edit:saved' &&
        useStudioStore.getState().activeFile === pending.file &&
        message.payload?.file === pending.file && builderSnapshot.current === pending.snapshot) {
      setBName((current) => current === pending.name ? '' : current);
    }
  }), [onMessage]);

  const newEditRequest = (kind: 'service' | 'builder' | 'raw', name: string, base: string, text?: string) => {
    if (!activeFile) return undefined;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingEdits.current.set(requestId, { file: activeFile, kind, name, snapshot: text });
    beginComposeEdit(requestId, { file: activeFile, kind, name, base, snapshot: text });
    return requestId;
  };
  const savingService = Object.values(pendingComposeEdits).some((edit) =>
    edit.file === activeFile && edit.kind === 'service');
  const savingBuilder = Object.values(pendingComposeEdits).some((edit) =>
    edit.file === activeFile && edit.kind === 'builder');

  // Logs tab state
  const [selectedLogService, setSelectedLogService] = useState<string>('');
  const [selectedLogContainer, setSelectedLogContainer] = useState('');
  const [logPaused, setLogPaused] = useState(false);
  const [pausedLogEntries, setPausedLogEntries] = useState<LogEntry[]>([]);

  // Resources tab forms
  const [newNetName, setNewNetName] = useState('');
  const [newNetDriver, setNewNetDriver] = useState('bridge');
  const [newVolName, setNewVolName] = useState('');
  const [newVolDriver, setNewVolDriver] = useState('local');

  // Builder tab form
  const [bName, setBName] = useState('');
  const [bImage, setBImage] = useState('docker.io/library/redis:7-alpine');
  const [bBuildImage, setBBuildImage] = useState('');
  const [bSource, setBSource] = useState<'image' | 'build'>('image');
  const [bBuildContext, setBBuildContext] = useState('.');
  const [bDockerfile, setBDockerfile] = useState(engine === 'podman' ? 'Containerfile' : 'Dockerfile');
  const [bContainerName, setBContainerName] = useState('');
  const [bCommand, setBCommand] = useState('');
  const [bPorts, setBPorts] = useState('');
  const [bEnv, setBEnv] = useState('');
  const [bVolumes, setBVolumes] = useState('');
  const [bDepends, setBDepends] = useState('');
  const [bRestart, setBRestart] = useState('unless-stopped');
  const builderSpec = useMemo<ComposeBuilderSpec>(() => ({
    services: [{
      name: bName, containerName: bContainerName, source: bSource,
      image: bSource === 'build' ? bBuildImage : bImage,
      buildContext: bBuildContext, buildDockerfile: bDockerfile,
      ports: bPorts.split(/[\r\n,]+/), restartPolicy: bRestart,
      networkName: '', volumeName: '', volumesText: bVolumes, environmentText: bEnv,
      dependsText: bDepends, commandText: bCommand,
    }],
  }), [bName, bContainerName, bSource, bImage, bBuildImage, bBuildContext, bDockerfile,
    bPorts, bRestart, bVolumes, bEnv, bDepends, bCommand]);
  const builderErrors = useMemo(
    () => validateComposeBuilder(builderSpec, document?.services || {}),
    [builderSpec, document]
  );
  builderSnapshot.current = JSON.stringify(builderSpec);

  const busy = Boolean(operationInProgress);

  const servicesEntries = useMemo(
    () => Object.entries(document?.services || {}),
    [document]
  );
  const serviceNames = useMemo(() => servicesEntries.map(([name]) => name), [servicesEntries]);
  const serviceSelection = useResourceSelection(
    serviceNames, serviceNames, serviceSelectionKey, `${engine}\0${activeFile || ''}`
  );
  type ServiceAction = 'up' | 'stop' | 'restart' | 'down' | 'build' | 'rebuild' | 'build-up';
  const runServices = (action: ServiceAction, services: string[]) => {
    if (busy || !projectReady || (action !== 'stop' && action !== 'down' && projectActionsBlocked)) return;
    postMessage('stack:services:batch', {
      ...actionContext,
      action,
      services,
    });
  };
  const runSelectedServices = (action: ServiceAction) => runServices(action, serviceSelection.selected);
  const selectedServicesBuildable = serviceSelection.selected.length > 0 &&
    serviceSelection.selected.every((name) => Boolean(document?.services?.[name]?.build));

  const summaryByService = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeComposeService>>();
    for (const [service, containers] of groupComposeContainers(composeContainers)) {
      map.set(service, summarizeComposeService(containers, engine === 'podman'));
    }
    return map;
  }, [composeContainers, engine]);

  const activeServicesCount = useMemo(
    () =>
      servicesEntries.filter(([name]) => {
        return summaryByService.get(name)?.active;
      }).length,
    [servicesEntries, summaryByService]
  );

  const stackHasActiveContainers = engine === 'podman'
    ? Array.from(summaryByService.values()).some((summary) => summary.active)
    : activeServicesCount > 0;
  const activePodName = useMemo(
    () => composeContainers.find((c) => c.podName)?.podName || '',
    [composeContainers]
  );
  const desiredScaleReplicas = parseDesiredReplicas(scaleReplicas);

  const allVariables = useMemo(() => {
    const rows: Array<{ service: string; key: string; value: string }> = [];
    for (const [svcName, svc] of servicesEntries) {
      const env = svc?.environment;
      if (Array.isArray(env)) {
        for (const item of env) {
          const s = String(item);
          const idx = s.indexOf('=');
          rows.push({
            service: svcName,
            key: idx === -1 ? s : s.slice(0, idx),
            value: idx === -1 ? '' : s.slice(idx + 1),
          });
        }
      } else if (env && typeof env === 'object') {
        for (const [k, v] of Object.entries(env)) {
          rows.push({ service: svcName, key: k, value: String(v ?? '') });
        }
      }
    }
    return rows;
  }, [servicesEntries]);

  const [varSearch, setVarSearch] = useState('');
  const filteredVars = useMemo(() => {
    const q = varSearch.trim().toLowerCase();
    if (!q) {
      return allVariables;
    }
    return allVariables.filter(
      (r) =>
        r.service.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        displayEnvironmentValue(r.key, r.value, showSensitive, extra.maskedValue).toLowerCase().includes(q)
    );
  }, [allVariables, varSearch, showSensitive, extra.maskedValue]);

  const openLogsForService = (svcName: string) => {
    setSelectedLogService(svcName);
    setSelectedLogContainer('');
    setLogPaused(false);
    setTab('logs');
  };

  const selectedLogServiceExists = Boolean(
    selectedLogService && document?.services &&
    Object.prototype.hasOwnProperty.call(document.services, selectedLogService)
  );
  const logReplicaSet = useMemo(() => composeLogReplicaSignature(
    composeContainers, selectedLogService, selectedLogContainer
  ), [composeContainers, selectedLogContainer, selectedLogService]);

  useEffect(() => {
    clearLogs();
    setLogPaused(false);
    setSelectedLogContainer('');
  }, [activeFile, clearLogs]);

  useEffect(() => {
    if (tab === 'logs' && !selectedLogServiceExists) {
      const next = servicesEntries[0]?.[0] || '';
      if (next !== selectedLogService) {
        setSelectedLogService(next);
        setSelectedLogContainer('');
        setLogPaused(false);
      }
    }
  }, [tab, selectedLogService, selectedLogServiceExists, servicesEntries]);

  useEffect(() => {
    if (selectedLogContainer && !composeContainers.some((item) =>
      item.service === selectedLogService && item.fullId === selectedLogContainer
    )) {
      setSelectedLogContainer('');
      setLogPaused(false);
    }
  }, [composeContainers, selectedLogContainer, selectedLogService]);

  useEffect(() => {
    if (tab !== 'logs' || !activeFile || !selectedLogServiceExists ||
        !projectReady || !composeProject.revision) {
      return;
    }
    const key = composeLogKey(activeFile, engine, composeProject.revision, selectedLogService, selectedLogContainer);
    const target = {
      ...actionContext, service: selectedLogService,
      containerId: selectedLogContainer || undefined,
    };
    clearLogs();
    setActiveLogTarget(key);
    postMessage('logs:start', target);
    return () => {
      postMessage('logs:stop', target);
      if (useStudioStore.getState().activeLogTarget === key) setActiveLogTarget(null);
    };
  }, [tab, activeFile, selectedLogService, selectedLogContainer, selectedLogServiceExists, projectReady,
    composeProject.revision, engine, rawYaml, logReplicaSet, clearLogs, setActiveLogTarget, postMessage]);

  const handleServiceAction = (
    action: 'start' | 'stop' | 'down' | 'restart',
    serviceName: string
  ) => {
    if (action === 'start') {
      runServices('up', [serviceName]);
    } else if (action === 'stop') {
      runServices('stop', [serviceName]);
    } else if (action === 'restart') {
      runServices('restart', [serviceName]);
    } else if (action === 'down') {
      runServices('down', [serviceName]);
    }
  };

  const handleBuilderAdd = () => {
    if (builderErrors.length || visualEditingBlocked || serviceDraft || savingBuilder) return;
    postMessage('service:add', {
      ...editContext,
      baseYaml: rawYaml,
      spec: builderSpec,
    }, newEditRequest('builder', bName.trim(), rawYaml, builderSnapshot.current));
  };

  const tabs: Array<{ id: ComposeTab; label: string; count?: number }> = [
    { id: 'overview', label: t.compose.tabs.overview },
    { id: 'topology', label: t.compose.tabs.topology },
    { id: 'services', label: t.compose.tabs.services, count: servicesEntries.length },
    { id: 'variables', label: t.compose.tabs.variables, count: allVariables.length },
    {
      id: 'resources',
      label: t.compose.tabs.resources,
      count:
        Object.keys(document?.networks || {}).length +
        Object.keys(document?.volumes || {}).length,
    },
    { id: 'yaml', label: t.compose.tabs.yaml },
    { id: 'logs', label: t.compose.tabs.logs },
    { id: 'builder', label: t.compose.tabs.builder },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Studio Compose Top Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[17px] font-semibold tracking-tight text-text-primary">{t.compose.title}</h1>
              {activePodName && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono">
                  {fmt(t.compose.podBadge, { name: activePodName })}
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-text-secondary mt-0.5 truncate max-w-3xl">
              {activeFile || t.compose.noFileSelected}
            </p>
          </div>

          {/* File Selector & Wizard Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <ActionPillButton
              label={t.compose.newCompose}
              variant="podman"
              icon={<FilePlus2 className="w-3.5 h-3.5" />}
              onClick={() => setShowCreateModal(true)}
            />
            <ActionPillButton
              label={t.compose.selectCompose}
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              onClick={() => postMessage('compose:file:pick')}
            />
            {activeFile && composeProject.options && (
              <ActionPillButton
                label={extra.projectOptions}
                disabled={busy || Boolean(serviceDraft) || yamlDirty || savingYaml}
                title={serviceDraft ? extra.finishServiceEdit : yamlDirty ? extra.draftPending : undefined}
                icon={<Settings2 className="w-3.5 h-3.5" />}
                onClick={() => setShowProjectOptions(true)}
              />
            )}
            {composeFiles.length > 0 && (
              <select
                value={activeFile || ''}
                onChange={(e) => postMessage('compose:file:select', { file: e.target.value })}
                className="input-field w-64 py-1.5 text-xs font-mono"
              >
                {composeFiles.map((f) => {
                  const parts = f.replace(/\\/g, '/').split('/');
                  const label = parts.slice(-2).join('/');
                  return (
                    <option key={f} value={f}>
                      {label}
                    </option>
                  );
                })}
              </select>
            )}
            <ActionPillButton
              label={t.common.refresh}
              loading={busy}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => {
                postMessage('compose:get');
                postMessage('status:get');
              }}
            />
          </div>
        </div>

        {/* Stack Action Toolbar + Sub-navigation Tabs */}
        <div className="flex items-center justify-between gap-4 pt-1 flex-wrap">
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setTab(tabItem.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 border ${
                  tab === tabItem.id
                    ? 'bg-white/[0.09] text-text-primary border-white/[0.12] shadow-sm'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                }`}
              >
                <span>{tabItem.label}</span>
                {tabItem.count !== undefined && (
                  <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-panel-bg text-text-muted font-mono">
                    {tabItem.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeFile && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <ActionPillButton
                label={t.common.upStart}
                variant="primary"
                loading={operationInProgress === 'start'}
                loadingLabel={t.common.startingOp}
                disabled={busy || projectActionsBlocked}
                icon={<Play className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:up', actionContext)}
              />
              <ActionPillButton
                label={t.common.stop}
                loading={operationInProgress === 'stop'}
                loadingLabel={t.common.stoppingOp}
                disabled={busy || !projectReady}
                icon={<Square className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:stop', actionContext)}
              />
              <ActionPillButton
                label={t.common.restart}
                loading={operationInProgress === 'restart'}
                loadingLabel={t.common.restartingOp}
                disabled={busy || projectActionsBlocked}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:restart', actionContext)}
              />
              <ActionPillButton
                label={t.common.build}
                loading={operationInProgress === 'build'}
                loadingLabel={t.common.buildingOp}
                disabled={busy || projectActionsBlocked}
                title={extra.buildOnlyHint}
                icon={<Hammer className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:build', actionContext)}
              />
              <ActionPillButton
                label={extra.rebuild}
                loading={operationInProgress === 'rebuild'}
                disabled={busy || projectActionsBlocked}
                title={extra.rebuildHint}
                icon={<Hammer className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:build', { ...actionContext, noCache: true })}
              />
              <ActionPillButton
                label={extra.buildUp}
                loading={operationInProgress === 'build-up'}
                disabled={busy || projectActionsBlocked}
                title={extra.buildUpHint}
                icon={<Play className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:build:up', actionContext)}
              />
              <ActionPillButton
                label={t.common.down}
                variant="danger"
                loading={operationInProgress === 'down'}
                loadingLabel={t.common.removingOp}
                disabled={busy || !projectReady}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:down', actionContext)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 overflow-auto p-6">
        {activeFile && (composeProject.resolving || composeProject.error || composeProject.customized) && (
          <div role={composeProject.error ? 'alert' : 'status'}
            className="mb-4 bg-panel-card border border-panel-border rounded-md px-4 py-2.5 text-xs text-text-secondary space-y-1">
            {composeProject.resolving ? extra.projectResolving : composeProject.error
              ? `${extra.projectFailed} ${composeProject.error}`
              : extra.projectResolved}
            {composeProject.customized && !composeProject.error && !composeProject.resolving && (
              <p>{extra.projectEditingHint}</p>
            )}
          </div>
        )}
        {activeFile && composeProject.dependenciesIncomplete && !composeParseError && (
          <div role="status" className="mb-4 bg-yellow-500/10 border border-accent-orange rounded-md px-4 py-2.5 text-xs text-accent-orange">
            {extra.projectDependenciesIncomplete}
          </div>
        )}
        {activeFile && yamlDirty && tab !== 'yaml' && (
          <div role="status" className="mb-4 bg-yellow-500/10 border border-accent-orange rounded-md px-4 py-2.5 text-xs text-accent-orange flex items-center justify-between gap-3">
            <span>{yamlConflict ? extra.draftConflict : extra.draftPending}</span>
            <SmallActionButton label={extra.openYaml} onClick={() => setTab('yaml')} />
          </div>
        )}
        {!document || !activeFile ? (
          <EmptyState
            icon={<FileCode2 className="w-10 h-10 text-accent-purple" />}
            title={t.compose.emptyTitle}
            description={t.compose.emptyDesc}
            action={
              <>
                <ActionPillButton
                  label={t.compose.emptyNewBtn}
                  variant="podman"
                  icon={<FilePlus2 className="w-3.5 h-3.5" />}
                  onClick={() => setShowCreateModal(true)}
                />
                <ActionPillButton
                  label={t.compose.emptySelectBtn}
                  icon={<FolderOpen className="w-3.5 h-3.5" />}
                  onClick={() => postMessage('compose:file:pick')}
                />
              </>
            }
          />
        ) : composeParseError && tab !== 'yaml' ? (
          <EmptyState
            title={extra.invalidYaml}
            description={composeParseError}
            action={<ActionPillButton label={extra.openYaml} onClick={() => setTab('yaml')} />}
          />
        ) : (
          <>
            {/* TAB 1: OVERVIEW */}
            {tab === 'overview' && (
              <div className="space-y-5">
                <div className="grid grid-cols-4 gap-3">
                  <StatCard
                    label={t.compose.statServices}
                    value={`${activeServicesCount}/${servicesEntries.length}`}
                    detail={
                      activeServicesCount > 0
                        ? fmt(t.compose.statServicesRunning, {
                            count: activeServicesCount,
                            engine: engineLabel,
                          })
                        : t.compose.statServicesStopped
                    }
                    accent={activeServicesCount > 0 ? 'border-accent-green' : 'border-panel-border'}
                  />
                  <StatCard
                    label={t.compose.statNetworks}
                    value={Object.keys(document.networks || {}).length}
                    detail={t.compose.statNetworksDetail}
                  />
                  <StatCard
                    label={t.compose.statVolumes}
                    value={Object.keys(document.volumes || {}).length}
                    detail={t.compose.statVolumesDetail}
                  />
                  <StatCard
                    label={t.compose.statVariables}
                    value={allVariables.length}
                    detail={
                      activePodName
                        ? fmt(t.compose.podBadge, { name: activePodName })
                        : t.compose.statVariablesDetail
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {servicesEntries.map(([svcName, svc]) => {
                    const summary = summaryByService.get(svcName);
                    const st = summary?.container;
                    const status = summary?.status || 'stopped';
                    const isRunning = Boolean(summary?.active);
                    const ports = toStringList(svc?.ports);
                    const nets = toStringList(svc?.networks);
                    const deps = toStringList(svc?.depends_on);

                    return (
                      <div
                        key={svcName}
                        className="bg-panel-card border border-panel-border rounded-md p-4 shadow-card flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-sm text-text-primary truncate">
                                {svcName}
                              </span>
                              {st?.podName && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/15 text-accent-purple font-mono">
                                  {st.podName}
                                </span>
                              )}
                            </div>
                            <StatusBadge status={status} />
                          </div>

                          <div className="text-xs font-mono text-text-secondary truncate">
                            {svc?.image ||
                              (svc?.build ? t.compose.localBuild : t.compose.noImageDefined)}
                          </div>

                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {ports.map((p, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-[11px] rounded bg-panel-bg border border-panel-border font-mono text-text-primary"
                              >
                                {fmt(t.compose.portBadge, { port: p })}
                              </span>
                            ))}
                            {nets.map((n, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-[11px] rounded bg-panel-bg border border-panel-border font-mono text-accent-purple"
                              >
                                {fmt(t.compose.netBadge, { net: n })}
                              </span>
                            ))}
                            {deps.map((d, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-[11px] rounded bg-panel-bg border border-panel-border font-mono text-text-secondary"
                              >
                                {fmt(t.compose.depBadge, { dep: d })}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-panel-border flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-text-muted">
                            {st?.id
                              ? fmt(t.compose.containerPrefix, { id: st.id })
                              : t.common.notInstantiated}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <SmallActionButton
                              label={t.common.start}
                              accent
                              disabled={busy || isRunning || projectActionsBlocked}
                              onClick={() => handleServiceAction('start', svcName)}
                            />
                            <SmallActionButton
                              label={t.common.stop}
                              disabled={busy || !isRunning || !projectReady}
                              onClick={() => handleServiceAction('stop', svcName)}
                            />
                            <SmallActionButton
                              label={t.common.logs}
                              onClick={() => openLogsForService(svcName)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: TOPOLOGY */}
            {tab === 'topology' && (
              <TopologyView
                document={document}
                containers={composeContainers}
                busy={busy || !projectReady}
                startDisabled={projectActionsBlocked}
                onServiceAction={handleServiceAction}
                onOpenLogs={openLogsForService}
                onOpenResources={() => setTab('resources')}
                onSelectService={(svcName) => {
                  setExpandedServices((prev) => ({ ...prev, [svcName]: true }));
                  setTab('services');
                }}
              />
            )}

            {/* TAB 3: SERVICES */}
            {tab === 'services' && (
              <div className="space-y-3">
                <SelectionBar selection={serviceSelection} busy={busy}>
                  <SmallActionButton
                    label={`${t.common.start} (${serviceSelection.selected.length})`}
                    accent
                    disabled={busy || projectActionsBlocked}
                    icon={<Play className="w-3 h-3" />}
                    title={extra.batchStartHint}
                    onClick={() => runSelectedServices('up')}
                  />
                  <SmallActionButton
                    label={`${t.common.stop} (${serviceSelection.selected.length})`}
                    disabled={busy || !projectReady}
                    icon={<Square className="w-3 h-3" />}
                    onClick={() => runSelectedServices('stop')}
                  />
                  <SmallActionButton
                    label={`${t.common.restart} (${serviceSelection.selected.length})`}
                    disabled={busy || projectActionsBlocked}
                    icon={<RotateCcw className="w-3 h-3" />}
                    onClick={() => runSelectedServices('restart')}
                  />
                  <SmallActionButton
                    label={`${t.common.build} (${serviceSelection.selected.length})`}
                    disabled={busy || projectActionsBlocked || !selectedServicesBuildable}
                    icon={<Hammer className="w-3 h-3" />}
                    title={selectedServicesBuildable ? extra.buildOnlyHint : extra.selectedBuildHint}
                    onClick={() => runSelectedServices('build')}
                  />
                  <SmallActionButton
                    label={`${extra.rebuild} (${serviceSelection.selected.length})`}
                    disabled={busy || projectActionsBlocked || !selectedServicesBuildable}
                    icon={<Hammer className="w-3 h-3" />}
                    title={selectedServicesBuildable ? extra.rebuildHint : extra.selectedBuildHint}
                    onClick={() => runSelectedServices('rebuild')}
                  />
                  <SmallActionButton
                    label={`${extra.buildUp} (${serviceSelection.selected.length})`}
                    disabled={busy || projectActionsBlocked || !selectedServicesBuildable}
                    icon={<Play className="w-3 h-3" />}
                    title={selectedServicesBuildable ? extra.buildUpHint : extra.selectedBuildHint}
                    onClick={() => runSelectedServices('build-up')}
                  />
                  <SmallActionButton
                    label={`${t.common.down} (${serviceSelection.selected.length})`}
                    danger
                    disabled={busy || !projectReady}
                    icon={<Trash2 className="w-3 h-3" />}
                    onClick={() => runSelectedServices('down')}
                  />
                </SelectionBar>
                {serviceSelection.selected.length > 0 && (
                  <p className="text-xs text-text-secondary">{extra.batchStartHint}</p>
                )}
                {servicesEntries.map(([svcName, svc]) => {
                  const summary = summaryByService.get(svcName);
                  const st = summary?.container;
                  const terminalContainer = summary?.terminalContainer;
                  const status = summary?.status || 'stopped';
                  const isActive = Boolean(summary?.active);
                  const isOpen = Boolean(expandedServices[svcName]);
                  const isEditing = editingService === svcName;

                  return (
                    <div
                      key={svcName}
                      className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card"
                    >
                      <div className="px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                        <input
                          type="checkbox"
                          aria-label={fmt(t.common.selectResource, { name: svcName })}
                          checked={serviceSelection.selectedIds.has(svcName)}
                          disabled={busy}
                          onChange={() => serviceSelection.toggle(svcName)}
                        />
                        <div
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                          onClick={() =>
                            setExpandedServices((prev) => ({
                              ...prev,
                              [svcName]: !prev[svcName],
                            }))
                          }
                        >
                          <StatusBadge status={status} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-text-primary">
                                {svcName}
                              </span>
                              {st?.id && (
                                <span className="text-xs font-mono text-text-muted">{st.id}</span>
                              )}
                              {engine === 'podman' && summary && summary.count > 1 && (
                                <span className="text-xs text-text-secondary">
                                  {fmt(t.compose.scaleCurrent, { count: summary.count })}
                                </span>
                              )}
                              {st?.podName && (
                                <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/15 text-accent-purple border border-accent-purple font-mono">
                                  {fmt(t.compose.podBadge, { name: st.podName })}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-text-secondary truncate mt-0.5">
                              {svc?.image || t.compose.localBuild}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SmallActionButton
                            label={t.common.start}
                            accent
                            disabled={busy || isActive || projectActionsBlocked}
                            icon={<Play className="w-3 h-3" />}
                            onClick={() => handleServiceAction('start', svcName)}
                          />
                          <SmallActionButton
                            label={t.common.stop}
                            disabled={busy || !isActive || !projectReady}
                            icon={<Square className="w-3 h-3" />}
                            onClick={() => handleServiceAction('stop', svcName)}
                          />
                          <SmallActionButton
                            label={t.common.restart}
                            disabled={busy || projectActionsBlocked}
                            icon={<RotateCcw className="w-3 h-3" />}
                            onClick={() => handleServiceAction('restart', svcName)}
                          />
                          <SmallActionButton
                            label={t.common.build}
                            disabled={busy || projectActionsBlocked || !svc?.build}
                            icon={<Hammer className="w-3 h-3" />}
                            title={svc?.build ? extra.buildOnlyHint : extra.selectedBuildHint}
                            onClick={() => runServices('build', [svcName])}
                          />
                          <SmallActionButton
                            label={extra.rebuild}
                            disabled={busy || projectActionsBlocked || !svc?.build}
                            icon={<Hammer className="w-3 h-3" />}
                            title={svc?.build ? extra.rebuildHint : extra.selectedBuildHint}
                            onClick={() => runServices('rebuild', [svcName])}
                          />
                          <SmallActionButton
                            label={extra.buildUp}
                            disabled={busy || projectActionsBlocked || !svc?.build}
                            icon={<Play className="w-3 h-3" />}
                            title={svc?.build ? extra.buildUpHint : extra.selectedBuildHint}
                            onClick={() => runServices('build-up', [svcName])}
                          />
                          {engine === 'podman' && (
                            <SmallActionButton
                              label={t.compose.scaleService}
                              disabled={busy || projectActionsBlocked}
                              icon={<Boxes className="w-3 h-3" />}
                              onClick={() => {
                                setScaleReplicas('');
                                setScaleTarget(svcName);
                              }}
                            />
                          )}
                          {terminalContainer?.id && (
                            <SmallActionButton
                              label={t.common.terminal}
                              disabled={!isActive}
                              icon={<Terminal className="w-3 h-3" />}
                              onClick={() =>
                                postMessage('container:terminal', {
                                  containerId: terminalContainer.id,
                                  name: terminalContainer.name || svcName,
                                })
                              }
                            />
                          )}
                          <SmallActionButton
                            label={t.common.logs}
                            onClick={() => openLogsForService(svcName)}
                          />
                          <SmallActionButton
                            label={extra.editService}
                            disabled={isActive || visualEditingBlocked || serviceFragments[svcName] === undefined ||
                              Boolean(serviceDraft)}
                            title={
                              isActive
                                ? t.compose.editLockedTooltip
                                : serviceDraft
                                ? extra.finishServiceEdit
                                : serviceFragments[svcName] === undefined
                                ? extra.fragmentUnavailable
                                : t.compose.editTooltip
                            }
                            icon={isActive ? <Lock className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                            onClick={() => {
                              setExpandedServices((prev) => ({ ...prev, [svcName]: true }));
                              setServiceEditError('');
                              let visual;
                              try {
                                visual = createVisualServiceDraft(serviceFragments[svcName]);
                              } catch (error) {
                                visual = undefined;
                                setServiceEditError(error instanceof Error ? error.message : String(error));
                              }
                              setComposeServiceDraft(activeFile, {
                                name: svcName, base: rawYaml, text: serviceFragments[svcName], visual,
                              });
                            }}
                          />
                          <SmallActionButton
                            label={t.common.remove}
                            danger
                            disabled={busy || isActive || otherVisualEditsBlocked}
                            title={
                              isActive
                                ? t.compose.removeLockedTooltip
                                : t.compose.removeTooltip
                            }
                            icon={<Trash2 className="w-3 h-3" />}
                            onClick={() => setRemoveServiceTarget(svcName)}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedServices((prev) => ({
                                ...prev,
                                [svcName]: !prev[svcName],
                              }))
                            }
                            className="p-1.5 rounded border border-panel-border text-text-secondary hover:text-text-primary"
                          >
                            <ChevronDown
                              className={`w-4 h-4 transition-transform ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="border-t border-panel-border bg-panel-bg p-4 space-y-4">
                          {isEditing ? (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-text-primary">
                                  {t.compose.editingServiceHeader}{' '}
                                  <code className="font-mono text-accent-purple">{svcName}</code>
                                </span>
                                <div className="flex items-center gap-2">
                                  <SmallActionButton
                                    label={t.common.cancel}
                                    disabled={savingService}
                                    onClick={() => {
                                      setServiceEditError('');
                                      setComposeServiceDraft(activeFile, null);
                                    }}
                                  />
                                  <ActionPillButton
                                    label={t.compose.saveServiceBtn}
                                    variant="podman"
                                    loading={savingService}
                                    loadingLabel={extra.savingService}
                                    disabled={isActive || visualEditingBlocked || serviceDraft?.base !== rawYaml}
                                    icon={<Save className="w-3.5 h-3.5" />}
                                    onClick={() => {
                                      if (!serviceDraft) return;
                                      let fragment: string;
                                      try {
                                        fragment = serviceDraft.visual
                                          ? applyVisualServiceDraft(serviceDraft.visual)
                                          : serviceDraft.text;
                                      } catch (error) {
                                        setServiceEditError(error instanceof Error ? error.message : String(error));
                                        return;
                                      }
                                      setServiceEditError('');
                                      postMessage('service:update', {
                                        ...editContext,
                                        baseYaml: serviceDraft?.base,
                                        name: svcName,
                                        definitionYaml: fragment,
                                      }, newEditRequest('service', svcName, serviceDraft.base, JSON.stringify(serviceDraft)));
                                    }}
                                  />
                                </div>
                              </div>
                              {serviceDraft?.base !== rawYaml && (
                                <p role="alert" className="text-xs text-accent-orange">{extra.serviceConflict}</p>
                              )}
                              {serviceEditError && <p role="alert" className="text-xs text-accent-orange">{serviceEditError}</p>}
                              <div className="flex gap-2">
                                <SmallActionButton label={extra.visualEdit} disabled={Boolean(serviceDraft?.visual)}
                                  onClick={() => {
                                    if (!serviceDraft) return;
                                    try {
                                      setComposeServiceDraft(activeFile, {
                                        ...serviceDraft, visual: createVisualServiceDraft(serviceDraft.text),
                                      });
                                      setServiceEditError('');
                                    } catch (error) {
                                      setServiceEditError(error instanceof Error ? error.message : String(error));
                                    }
                                  }} />
                                <SmallActionButton label={extra.yamlEdit} disabled={!serviceDraft?.visual}
                                  onClick={() => {
                                    if (!serviceDraft?.visual) return;
                                    try {
                                      const text = applyVisualServiceDraft(serviceDraft.visual);
                                      setComposeServiceDraft(activeFile, { ...serviceDraft, text, visual: undefined });
                                      setServiceEditError('');
                                    } catch (error) {
                                      setServiceEditError(error instanceof Error ? error.message : String(error));
                                    }
                                  }} />
                              </div>
                              {serviceDraft?.visual ? (
                                <VisualServiceEditor
                                  draft={serviceDraft.visual}
                                  disabled={isActive || visualEditingBlocked}
                                  onChange={(visual) => setComposeServiceDraft(activeFile, { ...serviceDraft, visual })}
                                />
                              ) : (
                                <textarea
                                  value={serviceYamlDraft}
                                  readOnly={isActive}
                                  onChange={(e) => serviceDraft && setComposeServiceDraft(activeFile, {
                                    ...serviceDraft, text: e.target.value,
                                  })}
                                  className="input-field font-mono text-xs min-h-[220px]"
                                />
                              )}
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-4 gap-3">
                                <DetailRow
                                  label={t.compose.detailContainer}
                                  value={st?.name || svc?.container_name || '-'}
                                />
                                <DetailRow
                                  label={t.compose.detailStatusUptime}
                                  value={st?.uptime || status}
                                />
                                <DetailRow
                                  label={t.compose.detailRestartPolicy}
                                  value={svc?.restart || 'no'}
                                />
                                <DetailRow
                                  label={t.compose.detailCommand}
                                  value={
                                    Array.isArray(svc?.command)
                                      ? svc.command.join(' ')
                                      : svc?.command || '-'
                                  }
                                />
                              </div>

                              <div className="grid grid-cols-3 gap-3">
                                <CodeBlockCard
                                  title={t.compose.cardPorts}
                                  lines={toStringList(svc?.ports)}
                                />
                                <CodeBlockCard
                                  title={t.compose.cardVolumesMounts}
                                  lines={toStringList(svc?.volumes)}
                                />
                                <CodeBlockCard
                                  title={t.compose.cardNetworksDepends}
                                  lines={[
                                    ...toStringList(svc?.networks).map((n) => `net: ${n}`),
                                    ...toStringList(svc?.depends_on).map((d) => `dep: ${d}`),
                                  ]}
                                />
                              </div>

                              {composeContainers.some((item) => item.service === svcName) && (
                                <div className="space-y-2">
                                  <div className="text-xs font-medium text-text-secondary">{extra.replicaDetails}</div>
                                  {composeContainers.filter((item) => item.service === svcName).map((item) => (
                                    <div key={item.fullId || item.id}
                                      className="bg-panel-card border border-panel-border rounded p-3 flex flex-wrap items-center gap-3 text-xs">
                                      <span className="font-mono text-text-primary">{item.name || item.id}</span>
                                      <StatusBadge status={item.status} />
                                      {item.health && <span>{extra.health}: {item.health}</span>}
                                      {item.exitCode !== undefined && <span>{extra.exitCode}: {item.exitCode}</span>}
                                      {item.ports.length > 0 && (
                                        <span className="font-mono text-text-secondary">
                                          {extra.publishedPorts}: {item.ports.map((port) =>
                                            `${port.hostIp ? `${port.hostIp}:` : ''}${port.host || '-'}:${port.container}/${port.protocol}`
                                          ).join(', ')}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              <CodeBlockCard
                                title={t.compose.cardEnvVars}
                                lines={environmentLines(svc?.environment, showSensitive, extra.maskedValue)}
                              />
                              <div className="flex items-center gap-3">
                                <SmallActionButton
                                  label={showSensitive ? extra.hideSecrets : extra.maskSecrets}
                                  onClick={() => setShowSensitive((current) => !current)}
                                />
                                <span className="text-xs text-text-secondary">{extra.maskSecretsHint}</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB 4: VARIABLES */}
            {tab === 'variables' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <SmallActionButton
                    label={showSensitive ? extra.hideSecrets : extra.maskSecrets}
                    onClick={() => setShowSensitive((current) => !current)}
                  />
                  <span className="text-xs text-text-secondary">{extra.maskSecretsHint}</span>
                </div>
                <input
                  type="text"
                  value={varSearch}
                  onChange={(e) => setVarSearch(e.target.value)}
                  placeholder={t.compose.filterVarsPlaceholder}
                  className="input-field"
                />
                {filteredVars.length === 0 ? (
                  <EmptyState
                    title={t.compose.emptyVarsTitle}
                    description={t.compose.emptyVarsDesc}
                  />
                ) : (
                  <div className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-panel-border bg-panel-bg text-left text-text-secondary">
                          <th className="px-4 py-3 font-medium">{t.compose.colService}</th>
                          <th className="px-4 py-3 font-medium">{t.compose.colVariable}</th>
                          <th className="px-4 py-3 font-medium">{t.compose.colValue}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-panel-border font-mono">
                        {filteredVars.map((row, idx) => (
                          <tr key={`${row.service}-${row.key}-${idx}`}>
                            <td className="px-4 py-2.5 text-accent-purple">{row.service}</td>
                            <td className="px-4 py-2.5 text-text-primary font-semibold">{row.key}</td>
                            <td className="px-4 py-2.5 text-text-secondary break-all">
                              {displayEnvironmentValue(row.key, row.value, showSensitive, extra.maskedValue) || '""'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: RESOURCES */}
            {tab === 'resources' && (
              <div className="grid grid-cols-2 gap-5">
                {/* Networks */}
                <div className="bg-panel-card border border-panel-border rounded-md p-4 shadow-card space-y-4">
                  <div className="text-sm font-semibold text-text-primary">
                    {fmt(t.compose.composeNetworksTitle, {
                      count: Object.keys(document.networks || {}).length,
                    })}
                  </div>
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                    <input
                      type="text"
                      value={newNetName}
                      onChange={(e) => setNewNetName(e.target.value)}
                      placeholder={t.compose.newNetworkPlaceholder}
                      className="input-field font-mono text-xs"
                    />
                    <select
                      value={newNetDriver}
                      onChange={(e) => setNewNetDriver(e.target.value)}
                      className="input-field text-xs"
                    >
                      <option value="bridge">bridge</option>
                      <option value="macvlan">macvlan</option>
                    </select>
                    <ActionPillButton
                      label={t.common.add}
                      variant="podman"
                      disabled={!newNetName.trim() || otherVisualEditsBlocked}
                      icon={<Plus className="w-3.5 h-3.5" />}
                      onClick={() => {
                        postMessage('compose:network:add', {
                          ...editContext,
                          baseYaml: rawYaml,
                          name: newNetName.trim(),
                          driver: newNetDriver,
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    {Object.entries(document.networks || {}).map(([name, cfg]: [string, any]) => (
                      <div
                        key={name}
                        className="bg-panel-bg border border-panel-border rounded px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-mono font-semibold text-text-primary">{name}</span>
                          <span className="ml-2 text-text-secondary">
                            driver: {cfg?.driver || 'bridge'}
                          </span>
                        </div>
                        <SmallActionButton
                          label={t.common.remove}
                          danger
                          disabled={otherVisualEditsBlocked}
                          onClick={() => postMessage('compose:network:remove', { ...editContext, baseYaml: rawYaml, name })}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Volumes */}
                <div className="bg-panel-card border border-panel-border rounded-md p-4 shadow-card space-y-4">
                  <div className="text-sm font-semibold text-text-primary">
                    {fmt(t.compose.composeVolumesTitle, {
                      count: Object.keys(document.volumes || {}).length,
                    })}
                  </div>
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                    <input
                      type="text"
                      value={newVolName}
                      onChange={(e) => setNewVolName(e.target.value)}
                      placeholder={t.compose.newVolumePlaceholder}
                      className="input-field font-mono text-xs"
                    />
                    <input
                      type="text"
                      value={newVolDriver}
                      onChange={(e) => setNewVolDriver(e.target.value)}
                      placeholder="local"
                      className="input-field font-mono text-xs"
                    />
                    <ActionPillButton
                      label={t.common.add}
                      variant="podman"
                      disabled={!newVolName.trim() || otherVisualEditsBlocked}
                      icon={<Plus className="w-3.5 h-3.5" />}
                      onClick={() => {
                        postMessage('compose:volume:add', {
                          ...editContext,
                          baseYaml: rawYaml,
                          name: newVolName.trim(),
                          driver: newVolDriver.trim() || 'local',
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    {Object.entries(document.volumes || {}).map(([name, cfg]: [string, any]) => (
                      <div
                        key={name}
                        className="bg-panel-bg border border-panel-border rounded px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-mono font-semibold text-text-primary">{name}</span>
                          <span className="ml-2 text-text-secondary">
                            driver: {cfg?.driver || 'local'}
                          </span>
                        </div>
                        <SmallActionButton
                          label={t.common.remove}
                          danger
                          disabled={otherVisualEditsBlocked}
                          onClick={() => postMessage('compose:volume:remove', { ...editContext, baseYaml: rawYaml, name })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: RAW YAML */}
            {tab === 'yaml' && (
              <div className="space-y-3 h-full flex flex-col">
                {composeParseError && (
                  <div role="alert" className="bg-red-500/10 border border-accent-red rounded-md px-4 py-2.5 text-xs text-accent-red">
                    {extra.invalidYaml} {composeParseError}
                  </div>
                )}
                {yamlConflict && (
                  <div role="alert" className="bg-yellow-500/10 border border-accent-orange rounded-md px-4 py-2.5 text-xs text-accent-orange">
                    {extra.draftConflict}
                    <details className="mt-2 text-text-primary">
                      <summary className="cursor-pointer">{extra.compareDraft}</summary>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                          <div className="font-semibold mb-1">{extra.currentFile}</div>
                          <pre className="bg-panel-bg border border-panel-border p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all">{rawYaml}</pre>
                        </div>
                        <div>
                          <div className="font-semibold mb-1">{extra.yourDraft}</div>
                          <pre className="bg-panel-bg border border-panel-border p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all">{yamlDraft}</pre>
                        </div>
                      </div>
                    </details>
                  </div>
                )}
                {serviceDraft && <p className="text-xs text-accent-orange">{extra.finishServiceEdit}</p>}
                {stackHasActiveContainers && (
                  <div className="bg-yellow-500/10 border border-accent-orange rounded-md px-4 py-2.5 text-xs text-accent-orange flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      {fmt(t.compose.yamlLockedBanner, { engine: engineLabel })}
                    </span>
                    <SmallActionButton
                      label={t.compose.stopStackNow}
                      disabled={busy || !projectReady}
                      onClick={() => postMessage('stack:stop', actionContext)}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-secondary">{activeFile}</span>
                  <div className="flex items-center gap-2">
                    <SmallActionButton
                      label={yamlConflict ? extra.reloadDraft : t.compose.restoreOriginal}
                      disabled={savingYaml || (!yamlDirty && yamlDraft === rawYaml)}
                      onClick={() => setComposeDraft(activeFile, { base: rawYaml, text: rawYaml })}
                    />
                    <ActionPillButton
                      label={t.compose.saveYamlBtn}
                      variant="podman"
                      loading={savingYaml}
                      loadingLabel={extra.savingYaml}
                      disabled={stackHasActiveContainers || !yamlDirty || yamlConflict || !projectReady || busy ||
                        Boolean(serviceDraft)}
                      icon={<Save className="w-3.5 h-3.5" />}
                      onClick={() => {
                        const base = draft?.base ?? rawYaml;
                        postMessage('compose:raw:save', {
                          ...editContext, baseYaml: base, rawYaml: yamlDraft,
                        }, newEditRequest('raw', '', base, yamlDraft));
                      }}
                    />
                  </div>
                </div>

                <textarea
                  value={yamlDraft}
                  readOnly={stackHasActiveContainers}
                  onChange={(e) => setComposeDraft(activeFile, {
                    base: draft?.base ?? rawYaml, text: e.target.value,
                  })}
                  className={`input-field font-mono text-xs leading-5 min-h-[460px] flex-1 ${
                    stackHasActiveContainers ? 'opacity-75 cursor-not-allowed' : ''
                  }`}
                />
              </div>
            )}

            {/* TAB 7: LOGS STREAMING */}
            {tab === 'logs' && (
              <div className="h-[520px] flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {servicesEntries.map(([svcName]) => (
                      <button
                        key={svcName}
                        type="button"
                        onClick={() => openLogsForService(svcName)}
                        className={`px-3 py-1 text-xs rounded-lg border font-mono transition-colors ${
                          selectedLogService === svcName
                            ? 'bg-white/[0.11] text-text-primary border-white/[0.14] shadow-sm'
                            : 'bg-panel-card border-panel-border text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                        }`}
                      >
                        {svcName}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-secondary" htmlFor="compose-log-replica">{extra.logReplica}</label>
                    <select id="compose-log-replica" value={selectedLogContainer}
                      onChange={(event) => {
                        setSelectedLogContainer(event.target.value);
                        setLogPaused(false);
                      }}
                      className="input-field w-48 py-1 text-xs">
                      <option value="">{extra.allReplicas}</option>
                      {composeContainers.filter((item) => item.service === selectedLogService && item.fullId).map((item) => (
                        <option key={item.fullId} value={item.fullId}>{item.name || item.id}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      placeholder={t.compose.filterLinesPlaceholder}
                      className="input-field w-56 py-1 text-xs"
                    />
                    <SmallActionButton label={t.common.clear} onClick={() => {
                      postMessage('logs:clear', {
                        ...actionContext, service: selectedLogService,
                        containerId: selectedLogContainer || undefined,
                      });
                      clearLogs();
                      setPausedLogEntries([]);
                    }} />
                    {selectedLogService && (
                      <SmallActionButton
                        label={logPaused ? t.common.resume : t.common.pause}
                        onClick={() => {
                          if (!logPaused) setPausedLogEntries([...logEntries]);
                          setLogPaused((paused) => !paused);
                        }}
                      />
                    )}
                  </div>
                </div>
                {logPaused && <p role="status" className="text-xs text-text-secondary">{extra.pausedLogsHint}</p>}
                {logEntries.some((entry) => !entry.sourceTimestamp) && (
                  <p role="status" className="text-xs text-accent-orange">{extra.logReplayLimited}</p>
                )}
                <LogViewer entries={logPaused ? pausedLogEntries : logEntries} filter={logFilter} />
              </div>
            )}

            {/* TAB 8: BUILDER */}
            {tab === 'builder' && (
              <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card max-w-3xl space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">
                    {t.compose.builderTitle}
                  </h2>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t.compose.builderSubtitle}{' '}
                    <code className="font-mono text-accent-purple">{activeFile}</code>.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.serviceNameLabel}
                    </label>
                    <input
                      type="text"
                      value={bName}
                      onChange={(e) => setBName(e.target.value)}
                      placeholder="redis-cache"
                      className="input-field font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {extra.builderSource}
                    </label>
                    <select value={bSource} onChange={(e) => setBSource(e.target.value as 'image' | 'build')}
                      className="input-field">
                      <option value="image">{extra.builderImageSource}</option>
                      <option value="build">{extra.builderBuildSource}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.ociImageLabel}
                    </label>
                    <input
                      type="text"
                      value={bSource === 'build' ? bBuildImage : bImage}
                      onChange={(e) => bSource === 'build' ? setBBuildImage(e.target.value) : setBImage(e.target.value)}
                      placeholder={bSource === 'build' ? extra.optionalBuildImage : 'docker.io/library/redis:7-alpine'}
                      className="input-field font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.detailRestartPolicy}
                    </label>
                    <select
                      value={bRestart}
                      onChange={(e) => setBRestart(e.target.value)}
                      className="input-field"
                    >
                      <option value="unless-stopped">unless-stopped</option>
                      <option value="always">always</option>
                      <option value="on-failure">on-failure</option>
                      <option value="no">no</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{extra.builderContainerName}</label>
                    <input type="text" value={bContainerName} onChange={(e) => setBContainerName(e.target.value)}
                      className="input-field font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{extra.builderCommand}</label>
                    <input type="text" value={bCommand} onChange={(e) => setBCommand(e.target.value)}
                      className="input-field font-mono" />
                  </div>
                </div>

                {bSource === 'build' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">{extra.visualBuildContext}</label>
                      <input type="text" value={bBuildContext} onChange={(e) => setBBuildContext(e.target.value)}
                        className="input-field font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">{extra.visualDockerfile}</label>
                      <input type="text" value={bDockerfile} onChange={(e) => setBDockerfile(e.target.value)}
                        className="input-field font-mono" />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.portsLabel}
                    </label>
                    <input
                      type="text"
                      value={bPorts}
                      onChange={(e) => setBPorts(e.target.value)}
                      placeholder="6379:6379"
                      className="input-field font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.dependsOnLabel}
                    </label>
                    <input
                      type="text"
                      value={bDepends}
                      onChange={(e) => setBDepends(e.target.value)}
                      placeholder="db"
                      className="input-field font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.envVarsLabel}
                    </label>
                    <textarea
                      value={bEnv}
                      onChange={(e) => setBEnv(e.target.value)}
                      placeholder="ALLOW_EMPTY_PASSWORD=yes"
                      className="input-field min-h-24 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.compose.volumesMountsLabel}
                    </label>
                    <textarea
                      value={bVolumes}
                      onChange={(e) => setBVolumes(e.target.value)}
                      placeholder="redis-data:/data"
                      className="input-field min-h-24 font-mono text-xs"
                    />
                    <p className="text-xs text-text-secondary mt-1">{extra.builderVolumeHint}</p>
                  </div>
                </div>

                {bName.trim() && builderErrors.length > 0 && (
                  <div role="alert" className="text-xs text-accent-orange">
                    <p>{extra.builderValidation}</p>
                    {builderErrors.map((error, index) => <p key={`${index}-${error}`}>{error}</p>)}
                  </div>
                )}
                {serviceDraft && <p className="text-xs text-accent-orange">{extra.finishServiceEdit}</p>}
                <div className="flex justify-end pt-2">
                  <ActionPillButton
                    label={t.compose.addServiceBtn}
                    variant="podman"
                    loading={savingBuilder}
                    loadingLabel={extra.savingService}
                    disabled={builderErrors.length > 0 || visualEditingBlocked || Boolean(serviceDraft)}
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={handleBuilderAdd}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Compose Wizard Modal */}
      {showCreateModal && <CreateComposeModal onClose={() => setShowCreateModal(false)} />}
      {showProjectOptions && activeFile && composeProject.options && (
        <ComposeOptionsModal
          file={activeFile}
          rawYaml={rawYaml}
          revision={composeProject.revision}
          options={composeProject.options}
          busy={busy}
          onClose={() => setShowProjectOptions(false)}
        />
      )}

      {scaleTarget && engine === 'podman' && activeFile && (
        <Modal
          title={fmt(t.compose.scaleTitle, { name: scaleTarget })}
          maxWidth="max-w-md"
          onClose={() => setScaleTarget(null)}
          footer={
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setScaleTarget(null)} />
              <ActionPillButton
                label={t.compose.scaleService}
                variant="podman"
                disabled={
                  busy || desiredScaleReplicas === undefined ||
                  !Object.prototype.hasOwnProperty.call(document?.services || {}, scaleTarget)
                }
                onClick={() => {
                  if (desiredScaleReplicas === undefined) {
                    return;
                  }
                  postMessage('stack:scale', {
                    ...actionContext,
                    service: scaleTarget,
                    replicas: desiredScaleReplicas,
                  });
                  setScaleTarget(null);
                }}
              />
            </>
          }
        >
          <label htmlFor="compose-scale-replicas" className="block text-xs text-text-secondary">
            {t.compose.scaleReplicas}
          </label>
          <input
            id="compose-scale-replicas"
            type="number"
            min="0"
            step="1"
            value={scaleReplicas}
            onChange={(event) => setScaleReplicas(event.target.value)}
            autoFocus
            className="input-field font-mono"
          />
          <p className="text-xs text-text-secondary">
            {fmt(t.compose.scaleCurrent, { count: summaryByService.get(scaleTarget)?.count || 0 })}
          </p>
          <p className="text-xs text-text-secondary">{t.compose.scaleWarning}</p>
        </Modal>
      )}

      {/* Remove Service Confirmation Modal */}
      {removeServiceTarget && (
        <Modal
          title={t.compose.removeServiceModalTitle}
          subtitle={t.compose.removeServiceModalSubtitle}
          maxWidth="max-w-md"
          onClose={() => setRemoveServiceTarget(null)}
          footer={
            <>
              <ActionPillButton
                label={t.common.cancel}
                onClick={() => setRemoveServiceTarget(null)}
              />
              <ActionPillButton
                label={t.common.remove}
                variant="danger"
                onClick={() => {
                  postMessage('service:remove', {
                    ...editContext, baseYaml: rawYaml, name: removeServiceTarget,
                  });
                  setRemoveServiceTarget(null);
                }}
              />
            </>
          }
        >
          <p className="text-xs text-text-secondary">
            {fmt(t.compose.removeServiceConfirm, { name: removeServiceTarget })}
          </p>
        </Modal>
      )}
    </div>
  );
};
