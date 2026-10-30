import React, { useEffect, useMemo, useRef, useState } from 'react';
import { groupComposeContainers, summarizeComposeService } from '../composeStatus';
import { composeEnvFiles, composeMounts, serviceNetworks } from '../composeTopology';
import { useI18n } from '../i18n';
import { useComposeExtras } from '../i18n/composeExtras';
import { ComposeContainerStatus, ComposeDocument } from '../store';
import { getStatusTheme } from './Shared';

interface NodeItem {
  id: string;
  kind: 'network' | 'service' | 'volume' | 'bind' | 'env';
  title: string;
  subtitle: string;
  meta: string[];
  status?: string;
}

interface EdgeItem {
  id: string;
  from: string;
  to: string;
  kind: 'network' | 'volume' | 'bind' | 'env' | 'depends';
  label?: string;
}

const NODE_WIDTH: Record<NodeItem['kind'], number> = {
  network: 210,
  service: 250,
  volume: 220,
  bind: 220,
  env: 220,
};

const NODE_HEIGHT: Record<NodeItem['kind'], number> = {
  network: 92,
  service: 132,
  volume: 86,
  bind: 86,
  env: 86,
};

function extractList(val: any): string[] {
  if (!val) {
    return [];
  }
  if (Array.isArray(val)) {
    return val.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  }
  if (typeof val === 'object') {
    return Object.keys(val);
  }
  return [String(val)];
}

export const TopologyView: React.FC<{
  document: ComposeDocument;
  containers: ComposeContainerStatus[];
  busy: boolean;
  startDisabled: boolean;
  onServiceAction: (action: 'start' | 'stop' | 'down' | 'restart', serviceName: string) => void;
  onOpenLogs: (serviceName: string) => void;
  onSelectService: (serviceName: string) => void;
  onOpenResources: () => void;
}> = ({
  document,
  containers,
  busy,
  startDisabled,
  onServiceAction,
  onOpenLogs,
  onSelectService,
  onOpenResources,
}) => {
  const { t, fmt, engine } = useI18n();
  const extra = useComposeExtras();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    serviceName: string;
    x: number;
    y: number;
  } | null>(null);

  const statusMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeComposeService>>();
    for (const [service, items] of groupComposeContainers(containers)) {
      map.set(service, summarizeComposeService(items, engine === 'podman'));
    }
    return map;
  }, [containers, engine]);

  const activePodName = useMemo(
    () => containers.find((c) => c.podName)?.podName || '',
    [containers]
  );

  const { nodes, edges, defaultPositions, canvasHeight } = useMemo(() => {
    const nodeList: NodeItem[] = [];
    const edgeList: EdgeItem[] = [];
    const services = Object.entries(document.services || {});
    const declaredNets = new Set<string>(Object.keys(document.networks || {}));
    const declaredVols = new Set<string>(Object.keys(document.volumes || {}));
    const bindMap = new Map<string, NodeItem>();
    const envMap = new Map<string, NodeItem>();
    const anonymousMap = new Map<string, NodeItem>();

    // Collect networks & volumes referenced by services
    for (const [serviceName, svc] of services) {
      for (const n of serviceNetworks(svc)) {
        declaredNets.add(n);
      }
      composeMounts(svc?.volumes).forEach((mount, index) => {
        if (mount.kind === 'bind' && mount.source) {
          const bindId = `bind:${mount.source}`;
          if (!bindMap.has(bindId)) {
            bindMap.set(bindId, {
              id: bindId,
              kind: 'bind',
              title: mount.source,
              subtitle: t.topology.bindMountHost,
              meta: [fmt(t.topology.targetPrefix, { target: mount.target })],
            });
          }
        } else if (mount.kind === 'volume' && mount.source) {
          declaredVols.add(mount.source);
        } else {
          const id = `mount:${serviceName}:${index}`;
          anonymousMap.set(id, {
            id, kind: 'volume', title: mount.target,
            subtitle: mount.kind === 'tmpfs' ? extra.tmpfsMount : extra.anonymousVolume,
            meta: [serviceName],
          });
        }
      });
      for (const ef of composeEnvFiles(svc?.env_file)) {
        const envId = `env:${ef}`;
        if (!envMap.has(envId)) {
          envMap.set(envId, {
            id: envId,
            kind: 'env',
            title: ef,
            subtitle: t.topology.envFile,
            meta: [t.topology.externalVars],
          });
        }
      }
    }

    for (const netName of declaredNets) {
      const cfg = document.networks?.[netName];
      nodeList.push({
        id: `net:${netName}`,
        kind: 'network',
        title: netName,
        subtitle: cfg?.driver ? `Driver: ${cfg.driver}` : t.topology.podmanBridge,
        meta: [cfg?.external ? t.topology.externalNetwork : t.topology.internalDnsActive],
      });
    }

    for (const [svcName, svc] of services) {
      const summary = statusMap.get(svcName);
      const st = summary?.container;
      const ports = extractList(svc?.ports).slice(0, 2);
      const targetNets = serviceNetworks(svc);

      nodeList.push({
        id: `svc:${svcName}`,
        kind: 'service',
        title: svcName,
        subtitle: svc?.image || (svc?.build ? t.compose.localBuild : t.topology.service),
        meta: [
          ports.length > 0
            ? `${t.compose.cardPorts}: ${ports.join(', ')}`
            : t.topology.noExposedPorts,
          st?.podName
            ? fmt(t.compose.podBadge, { name: st.podName })
            : st?.id
            ? `ID: ${st.id}`
            : t.topology.containerStopped,
        ],
        status: summary?.status || 'stopped',
      });

      for (const n of targetNets) {
        if (declaredNets.has(n)) {
          edgeList.push({
            id: `e-net-${n}-${svcName}`,
            from: `net:${n}`,
            to: `svc:${svcName}`,
            kind: 'network',
          });
        }
      }

      composeMounts(svc?.volumes).forEach((mount, index) => {
        const target = mount.kind === 'bind' ? `bind:${mount.source}` :
          mount.kind === 'volume' ? `vol:${mount.source}` : `mount:${svcName}:${index}`;
        edgeList.push({
          id: `e-mount-${svcName}-${index}`,
          from: `svc:${svcName}`,
          to: target,
          kind: mount.kind === 'bind' ? 'bind' : 'volume',
          label: mount.target,
        });
      });

      for (const ef of composeEnvFiles(svc?.env_file)) {
        edgeList.push({
          id: `e-env-${svcName}-${ef}`,
          from: `svc:${svcName}`,
          to: `env:${ef}`,
          kind: 'env',
        });
      }

      for (const dep of extractList(svc?.depends_on)) {
        if (document.services?.[dep]) {
          edgeList.push({
            id: `e-dep-${svcName}-${dep}`,
            from: `svc:${svcName}`,
            to: `svc:${dep}`,
            kind: 'depends',
            label: 'depends_on',
          });
        }
      }
    }

    for (const volName of declaredVols) {
      const cfg = document.volumes?.[volName];
      nodeList.push({
        id: `vol:${volName}`,
        kind: 'volume',
        title: volName,
        subtitle: cfg?.driver
          ? `${t.topology.volume} (${cfg.driver})`
          : t.topology.persistentVolume,
        meta: [cfg?.external ? t.topology.external : t.topology.managedByPodman],
      });
    }

    for (const b of bindMap.values()) {
      nodeList.push(b);
    }
    for (const mount of anonymousMap.values()) {
      nodeList.push(mount);
    }
    for (const e of envMap.values()) {
      nodeList.push(e);
    }

    const pos: Record<string, { x: number; y: number }> = {};
    const nets = nodeList.filter((n) => n.kind === 'network');
    const svcs = nodeList.filter((n) => n.kind === 'service');
    const rightCol = nodeList.filter(
      (n) => n.kind === 'volume' || n.kind === 'bind' || n.kind === 'env'
    );

    nets.forEach((n, idx) => {
      pos[n.id] = { x: 40, y: 48 + idx * 130 };
    });
    svcs.forEach((n, idx) => {
      pos[n.id] = { x: 350, y: 40 + idx * 164 };
    });
    rightCol.forEach((n, idx) => {
      pos[n.id] = { x: 710, y: 48 + idx * 116 };
    });

    const maxRowsHeight = Math.max(
      nets.length * 130 + 90,
      svcs.length * 164 + 90,
      rightCol.length * 116 + 90,
      520
    );

    return {
      nodes: nodeList,
      edges: edgeList,
      defaultPositions: pos,
      canvasHeight: maxRowsHeight,
    };
  }, [document, statusMap, t, fmt, extra]);

  useEffect(() => {
    setPositions((prev) => {
      const next = { ...defaultPositions };
      for (const k of Object.keys(next)) {
        if (prev[k]) {
          next[k] = prev[k];
        }
      }
      return next;
    });
  }, [defaultPositions]);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (ev: MouseEvent) => {
      if (!canvasRef.current) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const x = Math.max(12, ev.clientX - rect.left - dragging.offsetX);
      const y = Math.max(12, ev.clientY - rect.top - dragging.offsetY);
      setPositions((prev) => ({
        ...prev,
        [dragging.id]: { x, y },
      }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const kindBadge = (kind: NodeItem['kind']) => {
    switch (kind) {
      case 'network':
        return { label: t.topology.network, dot: 'bg-violet-400' };
      case 'service':
        return { label: t.topology.service, dot: 'bg-sky-400' };
      case 'volume':
        return { label: t.topology.volume, dot: 'bg-emerald-400' };
      case 'bind':
        return { label: t.topology.bindMount, dot: 'bg-amber-400' };
      case 'env':
        return { label: t.topology.envFile, dot: 'bg-slate-400' };
    }
  };

  return (
    <div
      className="space-y-3"
      onClick={() => {
        if (contextMenu) {
          setContextMenu(null);
        }
      }}
    >
      {/* Legend Bar */}
      <div className="bg-panel-card border border-panel-border rounded-xl px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-violet-400" /> {t.topology.network}
          </span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-sky-400" /> {t.topology.service}
          </span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> {t.topology.volume}
          </span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> {t.topology.bindMount}
          </span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-slate-400" /> {t.topology.envFile}
          </span>
          {activePodName && (
            <span className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono">
              {fmt(t.topology.activePod, { name: activePodName })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-muted">{t.topology.hint}</span>
          <button
            type="button"
            onClick={() => setPositions(defaultPositions)}
            className="px-2.5 py-1 rounded-lg border border-panel-border bg-white/[0.02] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
          >
            {t.topology.rearrange}
          </button>
        </div>
      </div>

      {/* Dotted Topology Canvas */}
      <div className="bg-panel-card border border-panel-border rounded-xl overflow-auto shadow-card">
        <div
          ref={canvasRef}
          className="relative min-w-[1000px]"
          style={{
            height: `${canvasHeight}px`,
            backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          {/* SVG Connectors */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              const p1 = positions[edge.from];
              const p2 = positions[edge.to];
              if (!fromNode || !toNode || !p1 || !p2) {
                return null;
              }

              if (edge.kind === 'depends') {
                const x1 = p1.x + NODE_WIDTH[fromNode.kind] / 2;
                const y1 = p1.y;
                const x2 = p2.x + NODE_WIDTH[toNode.kind] / 2;
                const y2 = p2.y + NODE_HEIGHT[toNode.kind];
                const ctrlX = Math.max(x1, x2) + 65;
                const d = `M ${x1} ${y1 + 20} C ${ctrlX} ${y1 + 20}, ${ctrlX} ${y2 - 20}, ${x2} ${y2}`;
                return (
                  <path
                    key={edge.id}
                    d={d}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    markerEnd="url(#dep-arrow)"
                    opacity={0.65}
                  />
                );
              }

              const startX = p1.x + NODE_WIDTH[fromNode.kind];
              const startY = p1.y + NODE_HEIGHT[fromNode.kind] / 2;
              const endX = p2.x;
              const endY = p2.y + NODE_HEIGHT[toNode.kind] / 2;
              const midX = (startX + endX) / 2;
              const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
              const color =
                edge.kind === 'network'
                  ? 'rgba(167, 139, 250, 0.55)'
                  : edge.kind === 'volume'
                  ? 'rgba(52, 211, 153, 0.55)'
                  : edge.kind === 'bind'
                  ? 'rgba(251, 191, 36, 0.55)'
                  : 'rgba(148, 163, 184, 0.45)';

              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                />
              );
            })}
          </svg>

          {/* Draggable Nodes */}
          {nodes.map((node) => {
            const pos = positions[node.id] || { x: 24, y: 24 };
            const badge = kindBadge(node.kind);
            const svcTheme =
              node.kind === 'service' ? getStatusTheme(node.status || 'stopped', t) : null;

            return (
              <div
                key={node.id}
                onMouseDown={(ev) => {
                  if (ev.button !== 0) {
                    return;
                  }
                  const rect = (ev.currentTarget as HTMLDivElement).getBoundingClientRect();
                  setDragging({
                    id: node.id,
                    offsetX: ev.clientX - rect.left,
                    offsetY: ev.clientY - rect.top,
                  });
                }}
                onContextMenu={(ev) => {
                  if (node.kind !== 'service') {
                    return;
                  }
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (!canvasRef.current) {
                    return;
                  }
                  const rect = canvasRef.current.getBoundingClientRect();
                  setContextMenu({
                    serviceName: node.title,
                    x: ev.clientX - rect.left,
                    y: ev.clientY - rect.top,
                  });
                }}
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  width: `${NODE_WIDTH[node.kind]}px`,
                }}
                className="absolute bg-panel-bg border border-white/[0.11] hover:border-white/[0.22] rounded-xl p-3.5 shadow-elevated cursor-move select-none z-10 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-medium text-text-secondary flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                  {svcTheme && (
                    <span className={`text-[10px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${svcTheme.border} ${svcTheme.badgeBg} ${svcTheme.text}`}>
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${svcTheme.dot} ${
                          svcTheme.pulse ? 'animate-pulse' : ''
                        }`}
                      />
                      {svcTheme.label}
                    </span>
                  )}
                </div>

                <div className="font-semibold text-[13px] tracking-tight text-text-primary truncate">{node.title}</div>
                <div className="text-[11px] font-mono text-text-secondary truncate mt-0.5">
                  {node.subtitle}
                </div>

                {node.meta.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-panel-border space-y-0.5">
                    {node.meta.map((m, idx) => (
                      <div key={idx} className="text-[11px] text-text-muted truncate font-mono">
                        {m}
                      </div>
                    ))}
                  </div>
                )}
                {(node.kind === 'service' || node.kind === 'network' ||
                  (node.kind === 'volume' && node.id.startsWith('vol:'))) && (
                  <button type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (node.kind === 'service') onSelectService(node.title);
                      else onOpenResources();
                    }}
                    className="mt-2 text-[10px] text-sky-400 hover:underline">
                    {node.kind === 'service' ? t.compose.tabs.services : t.compose.tabs.resources}
                  </button>
                )}
              </div>
            );
          })}

          {/* Service Right-Click Context Menu */}
          {contextMenu && (
            <div
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              onClick={(e) => e.stopPropagation()}
              className="absolute z-30 w-48 bg-panel-card border border-panel-border rounded-md shadow-elevated py-1 text-xs"
            >
              <div className="px-3 py-1.5 border-b border-panel-border font-semibold text-text-primary truncate">
                {t.topology.service}: {contextMenu.serviceName}
              </div>
              <button
                type="button"
                disabled={busy || startDisabled}
                onClick={() => {
                  onServiceAction('start', contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-panel-card-hover text-text-primary disabled:opacity-40"
              >
                ▶ {t.common.upStart}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onServiceAction('stop', contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-panel-card-hover text-text-primary disabled:opacity-40"
              >
                ■ {t.common.stop}
              </button>
              <button
                type="button"
                disabled={busy || startDisabled}
                onClick={() => {
                  onServiceAction('restart', contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-panel-card-hover text-text-primary disabled:opacity-40"
              >
                ↻ {t.common.restart}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onServiceAction('down', contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 text-accent-red disabled:opacity-40"
              >
                {t.topology.ctxDownRemove}
              </button>
              <div className="border-t border-panel-border my-1" />
              <button
                type="button"
                onClick={() => {
                  onOpenLogs(contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-panel-card-hover text-text-secondary"
              >
                {t.topology.ctxLiveLogs}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectService(contextMenu.serviceName);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-panel-card-hover text-text-secondary"
              >
                {t.topology.ctxInspectService}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
