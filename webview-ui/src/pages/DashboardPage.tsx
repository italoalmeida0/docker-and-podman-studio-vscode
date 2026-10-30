import React from 'react';
import {
  Box,
  Boxes,
  Database,
  Layers,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import {
  ActionPillButton,
  DetailRow,
  SmallActionButton,
  StatCard,
  StatusBadge,
} from '../components/Shared';
import { useI18n } from '../i18n';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

function parseBytesApprox(raw: string): number {
  const m = String(raw || '').match(/([\d.]+)\s*(KB|MB|GB|TB|B)/i);
  if (!m) {
    return 0;
  }
  const n = parseFloat(m[1]) || 0;
  const u = m[2].toUpperCase();
  if (u === 'TB') return n * 1024 * 1024;
  if (u === 'GB') return n * 1024;
  if (u === 'MB') return n;
  if (u === 'KB') return n / 1024;
  return n / (1024 * 1024);
}

export const DashboardPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, engineCmd } = useI18n();
  const {
    systemInfo,
    diskUsage,
    dockerContexts,
    machines,
    pods,
    allContainers,
    images,
    volumes,
    networks,
    composeFiles,
    operationInProgress,
    operationsInProgress,
    setActivePage,
  } = useStudioStore();

  const busy = Boolean(operationInProgress);
  const isPodman = engine === 'podman';

  const userContainers = allContainers.filter((c) => !c.isInfra);
  const runningContainers = userContainers.filter((c) => c.state === 'running').length;
  const runningPods = pods.filter((p) => p.state === 'running').length;
  const danglingImages = images.filter((i) => i.dangling).length;
  const composeVolumesCount = volumes.filter((v) => Boolean(v.composeProject)).length;
  const versionStr = systemInfo?.engineVersion || systemInfo?.podmanVersion || '';

  const maxDiskMb = Math.max(
    1,
    ...diskUsage.map((row) => parseBytesApprox(row.size))
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[17px] font-semibold tracking-tight text-text-primary">
              {fmt(t.dashboard.title, { engine: engineLabel })}
            </h1>
            {versionStr && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono tabular-nums">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                v{versionStr}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {isPodman ? t.dashboard.subtitlePodman : t.dashboard.subtitleDocker}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.dashboard.openComposeBtn}
            variant="brand"
            onClick={() => setActivePage('compose')}
          />
          <ActionPillButton
            label={t.common.refreshAll}
            loading={Boolean(operationsInProgress['refresh-all'])}
            disabled={busy}
            loadingLabel={t.common.syncing}
            icon={<RefreshCw className="w-3.5 h-3.5 stroke-[1.7]" />}
            onClick={() => postMessage('dashboard:get')}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Summary KPI Cards */}
        <div className="grid grid-cols-4 gap-3.5">
          <div onClick={() => setActivePage('containers')} className="cursor-pointer">
            <StatCard
              label={t.dashboard.containersCard}
              value={`${runningContainers}/${userContainers.length}`}
              detail={fmt(t.dashboard.containersStoppedDetail, {
                count: userContainers.length - runningContainers,
              })}
              icon={<Box className="w-3.5 h-3.5 stroke-[1.6]" />}
            />
          </div>
          <div onClick={() => setActivePage('images')} className="cursor-pointer">
            <StatCard
              label={t.dashboard.imagesCard}
              value={images.length}
              detail={
                danglingImages > 0
                  ? fmt(t.dashboard.imagesDanglingDetail, { count: danglingImages })
                  : t.dashboard.imagesCleanDetail
              }
              icon={<Layers className="w-3.5 h-3.5 stroke-[1.6]" />}
            />
          </div>
          {isPodman ? (
            <div onClick={() => setActivePage('containers')} className="cursor-pointer">
              <StatCard
                label={t.dashboard.podsCard}
                value={pods.length}
                detail={fmt(t.dashboard.podsRunningDetail, { count: runningPods })}
                icon={<Boxes className="w-3.5 h-3.5 stroke-[1.6]" />}
              />
            </div>
          ) : (
            <div onClick={() => setActivePage('volumes')} className="cursor-pointer">
              <StatCard
                label={t.dashboard.volumesCard}
                value={volumes.length}
                detail={fmt(t.dashboard.volumesComposeDetail, { count: composeVolumesCount })}
                icon={<Database className="w-3.5 h-3.5 stroke-[1.6]" />}
              />
            </div>
          )}
          <div onClick={() => setActivePage('compose')} className="cursor-pointer">
            <StatCard
              label={t.dashboard.composeCard}
              value={fmt(t.dashboard.composeStacksValue, { count: composeFiles.length })}
              detail={fmt(t.dashboard.composeDetail, {
                volumes: volumes.length,
                networks: networks.length,
              })}
              icon={<Network className="w-3.5 h-3.5 stroke-[1.6]" />}
            />
          </div>
        </div>

        {/* Engine-Specific Control Card: Docker Contexts OR Podman Machine */}
        {isPodman ? (
          <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                  {t.dashboard.machineTitle}
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">{t.dashboard.machineSubtitle}</p>
              </div>
              <SmallActionButton
                label={t.dashboard.refreshMachines}
                icon={<RefreshCw className="w-3 h-3 stroke-[1.7]" />}
                onClick={() => postMessage('machines:list')}
              />
            </div>

            {machines.length === 0 ? (
              <div className="bg-panel-bg border border-panel-border rounded-xl p-4 text-xs text-text-secondary">
                {versionStr
                  ? fmt(t.dashboard.nativeEngineNotice, {
                      engine: engineLabel,
                      os: systemInfo?.os || '',
                      arch: systemInfo?.architecture || '',
                    })
                  : t.dashboard.noMachinesFound}
              </div>
            ) : (
              <div className="space-y-2.5">
                {machines.map((m) => (
                  <div
                    key={m.name}
                    className="bg-panel-bg border border-panel-border rounded-xl px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-text-primary font-mono">
                          {m.name}
                        </span>
                        {m.default && (
                          <span className="px-2 py-0.5 text-[10px] rounded-full bg-white/[0.06] text-text-secondary border border-panel-border font-medium">
                            {t.common.default}
                          </span>
                        )}
                        <StatusBadge
                          status={m.starting ? 'starting' : m.running ? 'running' : 'stopped'}
                          customLabel={
                            m.starting
                              ? t.status.starting
                              : m.running
                              ? t.status.active
                              : t.status.stopped
                          }
                        />
                      </div>
                      <div className="text-xs text-text-secondary flex items-center gap-3 flex-wrap">
                        <span>
                          {t.dashboard.provider}:{' '}
                          <strong className="font-medium text-text-primary">{m.vmType}</strong>
                        </span>
                        <span>
                          {t.dashboard.cpus}:{' '}
                          <strong className="font-medium text-text-primary">{m.cpus}</strong>
                        </span>
                        <span>
                          {t.dashboard.ram}:{' '}
                          <strong className="font-medium text-text-primary">{m.memory}</strong>
                        </span>
                        <span>
                          {t.dashboard.disk}:{' '}
                          <strong className="font-medium text-text-primary">{m.diskSize}</strong>
                        </span>
                        {m.lastUp && (
                          <span>
                            {t.dashboard.lastBoot}: {m.lastUp}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <SmallActionButton
                        label={t.common.start}
                        accent
                        disabled={busy || m.running}
                        icon={<Play className="w-3 h-3" />}
                        onClick={() => postMessage('machine:start', { name: m.name })}
                      />
                      <SmallActionButton
                        label={t.common.stop}
                        disabled={busy || !m.running}
                        icon={<Square className="w-3 h-3" />}
                        onClick={() => postMessage('machine:stop', { name: m.name })}
                      />
                      <SmallActionButton
                        label={t.common.restart}
                        disabled={busy}
                        icon={<RotateCcw className="w-3 h-3" />}
                        onClick={() => postMessage('machine:restart', { name: m.name })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                  {t.dashboard.dockerContextTitle}
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  {t.dashboard.dockerContextSubtitle}
                </p>
              </div>
              <SmallActionButton
                label={t.dashboard.refreshContexts}
                icon={<RefreshCw className="w-3 h-3 stroke-[1.7]" />}
                onClick={() => postMessage('contexts:list')}
              />
            </div>

            {dockerContexts.length === 0 ? (
              <div className="bg-panel-bg border border-panel-border rounded-xl p-4 text-xs text-text-secondary">
                {versionStr
                  ? fmt(t.dashboard.nativeEngineNotice, {
                      engine: engineLabel,
                      os: systemInfo?.os || '',
                      arch: systemInfo?.architecture || '',
                    })
                  : t.dashboard.noDockerContexts}
              </div>
            ) : (
              <div className="divide-y divide-panel-border border border-panel-border rounded-xl bg-panel-bg overflow-hidden">
                {dockerContexts.map((ctx) => (
                  <div
                    key={ctx.name}
                    className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-medium text-xs text-text-primary font-mono">
                          {ctx.name}
                        </span>
                        {ctx.current && (
                          <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1.5 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {t.dashboard.activeContextBadge}
                          </span>
                        )}
                        {ctx.description && (
                          <span className="text-xs text-text-secondary">{ctx.description}</span>
                        )}
                      </div>
                      {ctx.dockerEndpoint && (
                        <div className="text-[11px] text-text-muted font-mono truncate">
                          {ctx.dockerEndpoint}
                        </div>
                      )}
                    </div>

                    {!ctx.current && (
                      <SmallActionButton
                        label={t.dashboard.useContextBtn}
                        accent
                        disabled={busy}
                        onClick={() => postMessage('context:use', { name: ctx.name })}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Two Columns: Engine Info & Storage Allocation */}
        <div className="grid grid-cols-2 gap-4">
          {/* Engine & Host Info */}
          <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                {fmt(t.dashboard.engineInfoTitle, { engine: engineLabel })}
              </h2>
              <span className="text-xs font-mono text-text-secondary tabular-nums">
                {versionStr ? `v${versionStr}` : '—'}
              </span>
            </div>

            {systemInfo ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 bg-panel-bg border border-panel-border rounded-xl p-4">
                <DetailRow
                  label={fmt(t.dashboard.engineCliApi, { engine: engineLabel })}
                  value={
                    versionStr
                      ? `${versionStr}${systemInfo.apiVersion ? ` (API ${systemInfo.apiVersion})` : ''}`
                      : '-'
                  }
                />
                <DetailRow
                  label={fmt(t.dashboard.composeEngineLabel, { engine: engineLabel })}
                  value={systemInfo.composeVersion || t.dashboard.integrated}
                />
                <DetailRow label={t.dashboard.hostname} value={systemInfo.hostname} />
                <DetailRow
                  label={t.dashboard.osArch}
                  value={
                    systemInfo.os
                      ? `${systemInfo.os}${systemInfo.architecture ? ` (${systemInfo.architecture})` : ''}`
                      : '-'
                  }
                />
                <DetailRow label={t.dashboard.kernel} value={systemInfo.kernel} />
                <DetailRow label={t.dashboard.storageDriver} value={systemInfo.storageDriver} />
                <DetailRow
                  label={t.dashboard.cpusMemory}
                  value={`${systemInfo.cpus} ${t.dashboard.cores} · ${systemInfo.memoryTotal}`}
                />
                <DetailRow
                  label={t.dashboard.remoteSocket}
                  value={systemInfo.remoteSocket || t.dashboard.localSocket}
                />
              </div>
            ) : (
              <div className="text-xs text-text-secondary py-6 text-center">
                {fmt(t.dashboard.loadingEngine, { engine: engineLabel })}
              </div>
            )}
          </div>

          {/* Storage Allocation (Apple macOS Storage-style bars + metrics) */}
          <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4 flex flex-col justify-between">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                  {fmt(t.dashboard.diskUsageTitle, { cmd: engineCmd })}
                </h2>
                <SmallActionButton
                  label={t.dashboard.recalculate}
                  onClick={() => postMessage('system:df')}
                />
              </div>

              {diskUsage.length === 0 ? (
                <div className="text-xs text-text-secondary py-6 text-center bg-panel-bg border border-panel-border rounded-xl">
                  {t.dashboard.noDiskMetrics}
                </div>
              ) : (
                <div className="bg-panel-bg border border-panel-border rounded-xl divide-y divide-panel-border overflow-hidden">
                  {diskUsage.map((row, idx) => {
                    const mb = parseBytesApprox(row.size);
                    const pct = Math.min(100, Math.max(8, Math.round((mb / maxDiskMb) * 100)));
                    const barColor =
                      idx === 0
                        ? 'bg-sky-500/80'
                        : idx === 1
                        ? 'bg-emerald-500/80'
                        : idx === 2
                        ? 'bg-indigo-500/80'
                        : 'bg-violet-500/80';
                    return (
                      <div key={row.type} className="px-4 py-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-text-primary">{row.type}</span>
                            <span className="text-[11px] text-text-muted font-mono tabular-nums">
                              {row.active}/{row.total}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 font-mono tabular-nums">
                            <span className="text-text-primary font-medium">{row.size}</span>
                            {row.reclaimable && (
                              <span className="text-[11px] text-text-secondary">
                                {row.reclaimable}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-panel-border flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-text-secondary">
                {t.dashboard.quickCleanup}
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <SmallActionButton
                  label={t.dashboard.danglingImagesBtn}
                  disabled={busy}
                  onClick={() => postMessage('prune:images')}
                />
                <SmallActionButton
                  label={t.dashboard.builderCacheBtn}
                  disabled={busy}
                  onClick={() => postMessage('prune:builder')}
                />
                <SmallActionButton
                  label={t.dashboard.orphanVolumesBtn}
                  disabled={busy}
                  onClick={() => postMessage('prune:volumes')}
                />
                <SmallActionButton
                  label={`${t.sidebar.networks}: ${t.images.filterUnused}`}
                  disabled={busy}
                  onClick={() => postMessage('prune:networks')}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
