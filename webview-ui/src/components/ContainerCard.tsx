import React, { useState } from 'react';
import {
  FileText, Pause, Play, RotateCcw, Square, Terminal, Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { PodmanContainer } from '../store';
import { useVsCodeMessaging } from '../vscode';
import { isRunningState } from './PodmanBatchActions';
import { DetailRow, ResourceCardHeader, SmallActionButton, StatusBadge } from './Shared';

export const ContainerCard: React.FC<{
  container: PodmanContainer;
  busy: boolean;
  selected: boolean;
  onToggleSelection: () => void;
  onLogs: () => void;
  onDelete: () => void;
  restartCount?: number;
}> = ({ container: c, busy, selected, onToggleSelection, onLogs, onDelete, restartCount }) => {
  const { t, fmt, engine } = useI18n();
  const { postMessage } = useVsCodeMessaging();
  const [isOpen, setIsOpen] = useState(false);
  const isPodman = engine === 'podman';
  const isRunning = isRunningState(c.state);
  const isPaused = c.state === 'paused';
  const isProtectedInfra = isPodman && c.isInfra;
  const targetId = isPodman ? c.fullId || c.id : c.id;

  return (
    <div className="bg-panel-card border border-panel-border rounded-md overflow-hidden shadow-card">
      <ResourceCardHeader
        name={c.name}
        expanded={isOpen}
        onToggle={() => setIsOpen((open) => !open)}
        selection={isPodman && !c.isInfra && c.fullId && (
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            aria-label={fmt(t.common.selectResource, { name: c.name })}
            checked={selected}
            disabled={busy}
            onChange={onToggleSelection}
          />
        )}
        status={<StatusBadge status={c.state} />}
        actions={
          <>
            <SmallActionButton
              label={t.common.start}
              accent
              disabled={busy || isProtectedInfra || isRunning || isPaused}
              icon={<Play className="w-3 h-3" />}
              onClick={() => postMessage('container:start', { containerId: targetId })}
            />
            <SmallActionButton
              label={t.common.stop}
              disabled={busy || isProtectedInfra || !isRunning || c.state === 'stopping'}
              icon={<Square className="w-3 h-3" />}
              onClick={() => postMessage('container:stop', { containerId: targetId })}
            />
            <SmallActionButton
              label={t.common.restart}
              disabled={busy || isProtectedInfra || isPaused || c.state === 'stopping'}
              icon={<RotateCcw className="w-3 h-3" />}
              onClick={() => postMessage('container:restart', { containerId: targetId })}
            />
            <SmallActionButton
              label={t.common.terminal}
              disabled={isProtectedInfra || !['running', 'unhealthy', 'starting'].includes(c.state)}
              icon={<Terminal className="w-3 h-3" />}
              onClick={() => postMessage('container:terminal', { containerId: targetId, name: c.name })}
            />
            {isPodman && !c.isInfra && (
              <SmallActionButton
                label={isPaused ? t.common.resume : t.common.pause}
                disabled={busy || (!isPaused && !isRunning)}
                icon={isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                onClick={() => postMessage(isPaused ? 'container:unpause' : 'container:pause', {
                  containerId: c.fullId,
                })}
              />
            )}
            <SmallActionButton
              label={t.common.logs}
              icon={<FileText className="w-3 h-3" />}
              onClick={onLogs}
            />
            <SmallActionButton
              label={t.common.delete}
              danger
              disabled={busy || isProtectedInfra}
              icon={<Trash2 className="w-3 h-3" />}
              onClick={onDelete}
            />
          </>
        }
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-text-primary break-all">{c.name}</span>
          <span className="text-xs font-mono text-text-muted break-all">{c.id}</span>
          {c.podName && (
            <span className="inline-flex max-w-full break-all px-2 py-0.5 text-[10px] rounded bg-purple-500/15 text-accent-purple border border-accent-purple font-mono">
              {fmt(t.compose.podBadge, { name: c.podName })}
            </span>
          )}
          {c.isCompose && (
            <span className="inline-flex max-w-full break-all px-2 py-0.5 text-[10px] rounded bg-panel-bg border border-panel-border text-text-secondary font-mono">
              compose:{c.composeProject}/{c.composeService}
            </span>
          )}
        </span>
        <span className="block text-xs text-text-secondary mt-0.5 truncate font-mono"
          title={`${c.image}${c.ports ? ` · ${c.ports}` : ''}`}>
          {c.image} {c.ports ? `· ${c.ports}` : ''}
        </span>
      </ResourceCardHeader>

      {isOpen && (
        <div className="border-t border-panel-border bg-panel-bg px-4 py-4 grid grid-cols-3 gap-3">
          <DetailRow label={t.containers.detailContainerId} value={c.fullId} />
          <DetailRow label={t.containers.detailStatus} value={c.status} />
          <DetailRow label={t.containers.detailCreatedAt} value={c.created} />
          <DetailRow label={t.containers.detailPorts} value={c.ports || t.containers.noPublishedPorts} />
          <DetailRow label={t.containers.detailNetworks} value={c.networks.join(', ') || t.common.default} />
          <DetailRow label={t.containers.detailCommand} value={c.command || '-'} />
          <DetailRow
            label={t.containers.detailPod}
            value={c.podName ? `${c.podName} (${c.podId.slice(0, 12)})` : t.common.standalone}
          />
          <DetailRow label={t.containers.detailMounts} value={c.mounts.join(', ') || t.common.none} />
          <DetailRow label={t.containers.detailComposeYaml} value={c.composeFile || '-'} />
          {restartCount !== undefined && <DetailRow label={t.pods.restarts} value={restartCount} />}
        </div>
      )}
    </div>
  );
};
