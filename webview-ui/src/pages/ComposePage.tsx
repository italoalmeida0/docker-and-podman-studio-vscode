import React, { useEffect, useMemo, useState } from 'react';
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
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { CreateComposeModal } from '../components/CreateComposeModal';
import { LogViewer } from '../components/LogViewer';
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
import { useI18n } from '../i18n';
import { ComposeContainerStatus, useStudioStore } from '../store';
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

const ACTIVE_SET = new Set(['running', 'starting', 'stopping', 'restarting', 'unhealthy']);

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

function serializeServicePreview(def: Record<string, any>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(def || {})) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach((item) =>
        lines.push(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`)
      );
    } else if (v && typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) {
        lines.push(`  ${sk}: ${typeof sv === 'string' ? sv : JSON.stringify(sv)}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join('\n');
}

export const ComposePage: React.FC = () => {
  const { t, fmt, engineLabel } = useI18n();
  const { postMessage } = useVsCodeMessaging();
  const {
    document,
    activeFile,
    rawYaml,
    composeFiles,
    composeContainers,
    operationInProgress,
    logEntries,
    logFilter,
    setLogFilter,
    clearLogs,
  } = useStudioStore();

  const [tab, setTab] = useState<ComposeTab>('overview');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({});
  const [editingService, setEditingService] = useState<string | null>(null);
  const [serviceYamlDraft, setServiceYamlDraft] = useState('');
  const [removeServiceTarget, setRemoveServiceTarget] = useState<string | null>(null);

  // Raw YAML draft
  const [yamlDraft, setYamlDraft] = useState('');
  useEffect(() => {
    setYamlDraft(rawYaml);
  }, [rawYaml]);

  // Logs tab state
  const [selectedLogService, setSelectedLogService] = useState<string>('');

  // Resources tab forms
  const [newNetName, setNewNetName] = useState('');
  const [newNetDriver, setNewNetDriver] = useState('bridge');
  const [newVolName, setNewVolName] = useState('');
  const [newVolDriver, setNewVolDriver] = useState('local');

  // Builder tab form
  const [bName, setBName] = useState('');
  const [bImage, setBImage] = useState('docker.io/library/redis:7-alpine');
  const [bPorts, setBPorts] = useState('');
  const [bEnv, setBEnv] = useState('');
  const [bVolumes, setBVolumes] = useState('');
  const [bDepends, setBDepends] = useState('');
  const [bRestart, setBRestart] = useState('unless-stopped');

  const busy = Boolean(operationInProgress);

  const servicesEntries = useMemo(
    () => Object.entries(document?.services || {}),
    [document]
  );

  const containerByService = useMemo(() => {
    const map = new Map<string, ComposeContainerStatus>();
    for (const c of composeContainers) {
      if (c.service) {
        map.set(c.service, c);
      }
    }
    return map;
  }, [composeContainers]);

  const activeServicesCount = useMemo(
    () =>
      servicesEntries.filter(([name]) => {
        const st = containerByService.get(name)?.status;
        return st && ACTIVE_SET.has(st);
      }).length,
    [servicesEntries, containerByService]
  );

  const stackHasActiveContainers = activeServicesCount > 0;
  const activePodName = useMemo(
    () => composeContainers.find((c) => c.podName)?.podName || '',
    [composeContainers]
  );

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
        r.value.toLowerCase().includes(q)
    );
  }, [allVariables, varSearch]);

  const openLogsForService = (svcName: string) => {
    if (selectedLogService && selectedLogService !== svcName) {
      postMessage('logs:stop', { service: selectedLogService });
    }
    clearLogs();
    setSelectedLogService(svcName);
    setTab('logs');
    postMessage('logs:start', { service: svcName });
  };

  useEffect(() => {
    if (tab === 'logs' && !selectedLogService && servicesEntries.length > 0) {
      const first = servicesEntries[0][0];
      setSelectedLogService(first);
      postMessage('logs:start', { service: first });
    }
  }, [tab, selectedLogService, servicesEntries, postMessage]);

  const handleServiceAction = (
    action: 'start' | 'stop' | 'down' | 'restart',
    serviceName: string
  ) => {
    if (action === 'start') {
      postMessage('stack:up', { services: [serviceName] });
    } else if (action === 'stop') {
      postMessage('stack:stop', { services: [serviceName] });
    } else if (action === 'restart') {
      postMessage('stack:restart', { services: [serviceName] });
    } else if (action === 'down') {
      postMessage('stack:down', { services: [serviceName] });
    }
  };

  const handleBuilderAdd = () => {
    if (!bName.trim()) {
      return;
    }
    const envLines = bEnv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const environment =
      envLines.length > 0
        ? Object.fromEntries(
            envLines.map((l) => {
              const idx = l.indexOf('=');
              return idx === -1 ? [l, ''] : [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
            })
          )
        : undefined;

    postMessage('service:add', {
      name: bName.trim(),
      image: bImage.trim() || 'docker.io/library/alpine:latest',
      ports: bPorts
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      environment,
      volumes: bVolumes
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      depends_on: bDepends
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      restart: bRestart,
    });
    setBName('');
    setBPorts('');
    setBEnv('');
    setBVolumes('');
    setBDepends('');
    setTab('services');
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
                disabled={busy}
                icon={<Play className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:up', {})}
              />
              <ActionPillButton
                label={t.common.stop}
                loading={operationInProgress === 'stop'}
                loadingLabel={t.common.stoppingOp}
                disabled={busy}
                icon={<Square className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:stop', {})}
              />
              <ActionPillButton
                label={t.common.restart}
                loading={operationInProgress === 'restart'}
                loadingLabel={t.common.restartingOp}
                disabled={busy}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:restart', {})}
              />
              <ActionPillButton
                label={t.common.build}
                loading={operationInProgress === 'build'}
                loadingLabel={t.common.buildingOp}
                disabled={busy}
                icon={<Hammer className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:build', {})}
              />
              <ActionPillButton
                label={t.common.down}
                variant="danger"
                loading={operationInProgress === 'down'}
                loadingLabel={t.common.removingOp}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('stack:down', {})}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 overflow-auto p-6">
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
                    const st = containerByService.get(svcName);
                    const status = st?.status || 'stopped';
                    const isRunning = ACTIVE_SET.has(status);
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
                              disabled={busy || isRunning}
                              onClick={() => handleServiceAction('start', svcName)}
                            />
                            <SmallActionButton
                              label={t.common.stop}
                              disabled={busy || !isRunning}
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
                busy={busy}
                onServiceAction={handleServiceAction}
                onOpenLogs={openLogsForService}
                onSelectService={(svcName) => {
                  setExpandedServices((prev) => ({ ...prev, [svcName]: true }));
                  setTab('services');
                }}
              />
            )}

            {/* TAB 3: SERVICES */}
            {tab === 'services' && (
              <div className="space-y-3">
                {servicesEntries.map(([svcName, svc]) => {
                  const st = containerByService.get(svcName);
                  const status = st?.status || 'stopped';
                  const isActive = ACTIVE_SET.has(status);
                  const isOpen = Boolean(expandedServices[svcName]);
                  const isEditing = editingService === svcName;

                  return (
                    <div
                      key={svcName}
                      className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card"
                    >
                      <div className="px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
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
                            disabled={busy || isActive}
                            icon={<Play className="w-3 h-3" />}
                            onClick={() => handleServiceAction('start', svcName)}
                          />
                          <SmallActionButton
                            label={t.common.stop}
                            disabled={busy || !isActive}
                            icon={<Square className="w-3 h-3" />}
                            onClick={() => handleServiceAction('stop', svcName)}
                          />
                          <SmallActionButton
                            label={t.common.restart}
                            disabled={busy}
                            icon={<RotateCcw className="w-3 h-3" />}
                            onClick={() => handleServiceAction('restart', svcName)}
                          />
                          {st?.id && (
                            <SmallActionButton
                              label={t.common.terminal}
                              disabled={!isActive}
                              icon={<Terminal className="w-3 h-3" />}
                              onClick={() =>
                                postMessage('container:terminal', {
                                  containerId: st.id,
                                  name: st.name || svcName,
                                })
                              }
                            />
                          )}
                          <SmallActionButton
                            label={t.common.logs}
                            onClick={() => openLogsForService(svcName)}
                          />
                          <SmallActionButton
                            label={t.compose.editYamlBtn}
                            disabled={isActive}
                            title={
                              isActive
                                ? t.compose.editLockedTooltip
                                : t.compose.editTooltip
                            }
                            icon={isActive ? <Lock className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                            onClick={() => {
                              setExpandedServices((prev) => ({ ...prev, [svcName]: true }));
                              setEditingService(svcName);
                              setServiceYamlDraft(serializeServicePreview(svc));
                            }}
                          />
                          <SmallActionButton
                            label={t.common.remove}
                            danger
                            disabled={busy || isActive}
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
                                    onClick={() => setEditingService(null)}
                                  />
                                  <ActionPillButton
                                    label={t.compose.saveServiceBtn}
                                    variant="podman"
                                    icon={<Save className="w-3.5 h-3.5" />}
                                    onClick={() => {
                                      postMessage('service:update', {
                                        name: svcName,
                                        definitionYaml: serviceYamlDraft,
                                      });
                                      setEditingService(null);
                                    }}
                                  />
                                </div>
                              </div>
                              <textarea
                                value={serviceYamlDraft}
                                onChange={(e) => setServiceYamlDraft(e.target.value)}
                                className="input-field font-mono text-xs min-h-[220px]"
                              />
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

                              <CodeBlockCard
                                title={t.compose.cardEnvVars}
                                lines={toStringList(svc?.environment)}
                              />
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
                              {row.value || '""'}
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
                      disabled={!newNetName.trim()}
                      icon={<Plus className="w-3.5 h-3.5" />}
                      onClick={() => {
                        postMessage('compose:network:add', {
                          name: newNetName.trim(),
                          driver: newNetDriver,
                        });
                        setNewNetName('');
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
                          onClick={() => postMessage('compose:network:remove', { name })}
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
                      disabled={!newVolName.trim()}
                      icon={<Plus className="w-3.5 h-3.5" />}
                      onClick={() => {
                        postMessage('compose:volume:add', {
                          name: newVolName.trim(),
                          driver: newVolDriver.trim() || 'local',
                        });
                        setNewVolName('');
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
                          onClick={() => postMessage('compose:volume:remove', { name })}
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
                {stackHasActiveContainers && (
                  <div className="bg-yellow-500/10 border border-accent-orange rounded-md px-4 py-2.5 text-xs text-accent-orange flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      {fmt(t.compose.yamlLockedBanner, { engine: engineLabel })}
                    </span>
                    <SmallActionButton
                      label={t.compose.stopStackNow}
                      onClick={() => postMessage('stack:stop', {})}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-secondary">{activeFile}</span>
                  <div className="flex items-center gap-2">
                    <SmallActionButton
                      label={t.compose.restoreOriginal}
                      disabled={yamlDraft === rawYaml}
                      onClick={() => setYamlDraft(rawYaml)}
                    />
                    <ActionPillButton
                      label={t.compose.saveYamlBtn}
                      variant="podman"
                      disabled={stackHasActiveContainers || yamlDraft === rawYaml}
                      icon={<Save className="w-3.5 h-3.5" />}
                      onClick={() => postMessage('compose:raw:save', { rawYaml: yamlDraft })}
                    />
                  </div>
                </div>

                <textarea
                  value={yamlDraft}
                  readOnly={stackHasActiveContainers}
                  onChange={(e) => setYamlDraft(e.target.value)}
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
                    <input
                      type="text"
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      placeholder={t.compose.filterLinesPlaceholder}
                      className="input-field w-56 py-1 text-xs"
                    />
                    <SmallActionButton label={t.common.clear} onClick={clearLogs} />
                    {selectedLogService && (
                      <SmallActionButton
                        label={t.common.pause}
                        onClick={() => postMessage('logs:stop', { service: selectedLogService })}
                      />
                    )}
                  </div>
                </div>

                <LogViewer entries={logEntries} filter={logFilter} />
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
                      {t.compose.ociImageLabel}
                    </label>
                    <input
                      type="text"
                      value={bImage}
                      onChange={(e) => setBImage(e.target.value)}
                      placeholder="docker.io/library/redis:7-alpine"
                      className="input-field font-mono"
                    />
                  </div>
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
                </div>

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
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <ActionPillButton
                    label={t.compose.addServiceBtn}
                    variant="podman"
                    disabled={!bName.trim()}
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
                  postMessage('service:remove', { name: removeServiceTarget });
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
