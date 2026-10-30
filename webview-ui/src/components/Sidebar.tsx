import React from 'react';
import {
  Box,
  Database,
  FileCode2,
  Globe,
  LayoutGrid,
  Layers,
  Network,
  Settings,
  Wrench,
} from 'lucide-react';
import { DockerMark, PodmanMark, StudioAppTile } from './BrandIcons';
import { LANGUAGE_OPTIONS, useI18n } from '../i18n';
import { LanguageSetting, PageId, useStudioStore } from '../store';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
}

export const Sidebar: React.FC = () => {
  const {
    t,
    fmt,
    languageSetting,
    changeLanguage,
    engine,
    engineLabel,
    changeEngine,
  } = useI18n();
  const {
    activePage,
    setActivePage,
    allContainers,
    images,
    volumes,
    networks,
    machines,
    systemInfo,
    settings,
  } = useStudioStore();

  const defaultMachine = machines[0];
  const versionStr = systemInfo?.engineVersion || systemInfo?.podmanVersion || '';
  const engineOnline =
    engine === 'podman'
      ? defaultMachine
        ? defaultMachine.running
        : Boolean(versionStr)
      : Boolean(versionStr);

  const runningContainersCount = allContainers.filter(
    (c) => !c.isInfra && c.state === 'running'
  ).length;
  const nonInfraContainersCount = allContainers.filter((c) => !c.isInfra).length;

  const sections: Array<{ title: string; items: NavItem[] }> = [
    {
      title: t.sidebar.overviewSection,
      items: [
        {
          id: 'dashboard',
          label: t.sidebar.dashboard,
          icon: <LayoutGrid className="w-4 h-4 stroke-[1.6]" />,
        },
        {
          id: 'compose',
          label: t.sidebar.compose,
          icon: <FileCode2 className="w-4 h-4 stroke-[1.6]" />,
        },
      ],
    },
    {
      title: t.sidebar.resourcesSection,
      items: [
        {
          id: 'containers',
          label: t.sidebar.containers,
          icon: <Box className="w-4 h-4 stroke-[1.6]" />,
          badge:
            nonInfraContainersCount > 0
              ? `${runningContainersCount}/${nonInfraContainersCount}`
              : undefined,
        },
        {
          id: 'images',
          label: t.sidebar.images,
          icon: <Layers className="w-4 h-4 stroke-[1.6]" />,
          badge: images.length || undefined,
        },
        {
          id: 'volumes',
          label: t.sidebar.volumes,
          icon: <Database className="w-4 h-4 stroke-[1.6]" />,
          badge: volumes.length || undefined,
        },
        {
          id: 'networks',
          label: t.sidebar.networks,
          icon: <Network className="w-4 h-4 stroke-[1.6]" />,
          badge: networks.length || undefined,
        },
      ],
    },
    {
      title: t.sidebar.systemSection,
      items: [
        {
          id: 'tools',
          label: t.sidebar.tools,
          icon: <Wrench className="w-4 h-4 stroke-[1.6]" />,
        },
        {
          id: 'settings',
          label: t.sidebar.settings,
          icon: <Settings className="w-4 h-4 stroke-[1.6]" />,
        },
      ],
    },
  ];

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar-bg border-r border-panel-border flex flex-col select-none">
      {/* Studio Brand Header + Apple-Style Segmented Engine Switcher */}
      <div className="px-4 py-4 border-b border-panel-border space-y-3.5">
        <div className="flex items-center gap-3">
          <StudioAppTile className="w-8 h-8 flex-shrink-0 drop-shadow-sm" />
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-text-primary tracking-tight truncate leading-tight">
              {t.sidebar.brandTitle}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-secondary mt-0.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engineOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="truncate tabular-nums">
                {versionStr
                  ? `${engineLabel} · ${versionStr}`
                  : engineOnline
                  ? fmt(t.sidebar.engineActive, { engine: engineLabel })
                  : fmt(t.sidebar.engineOffline, { engine: engineLabel })}
              </span>
            </div>
          </div>
        </div>

        {/* Apple macOS-style Recessed Segmented Control */}
        <div
          className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-black/25 border border-panel-border"
          title={t.sidebar.engineSwitchTooltip}
        >
          <button
            type="button"
            onClick={() => changeEngine('docker')}
            className={`py-1.5 px-2 text-[11px] font-medium rounded-md transition-all inline-flex items-center justify-center gap-1.5 ${
              engine === 'docker'
                ? 'bg-white/[0.11] text-text-primary shadow-sm border border-white/[0.10]'
                : 'text-text-secondary hover:text-text-primary border border-transparent'
            }`}
          >
            <DockerMark className={`w-3.5 h-3.5 ${engine === 'docker' ? 'text-sky-400' : 'opacity-65'}`} />
            <span>Docker</span>
          </button>
          <button
            type="button"
            onClick={() => changeEngine('podman')}
            className={`py-1.5 px-2 text-[11px] font-medium rounded-md transition-all inline-flex items-center justify-center gap-1.5 ${
              engine === 'podman'
                ? 'bg-white/[0.11] text-text-primary shadow-sm border border-white/[0.10]'
                : 'text-text-secondary hover:text-text-primary border border-transparent'
            }`}
          >
            <PodmanMark className={`w-3.5 h-3.5 ${engine === 'podman' ? 'text-violet-400' : 'opacity-65'}`} />
            <span>Podman</span>
          </button>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 py-3.5 px-2.5 space-y-4 overflow-y-auto">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {sec.title}
            </div>
            <div className="space-y-0.5">
              {sec.items.map((item) => {
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePage(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      active
                        ? 'bg-white/[0.08] text-text-primary'
                        : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0 truncate">
                      <span className={active ? 'text-text-primary' : 'text-text-secondary opacity-80'}>
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-white/[0.04] border border-panel-border text-text-secondary font-mono tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer with Quick 16-Language Switcher */}
      <div className="px-3.5 py-2.5 border-t border-panel-border text-[11px] text-text-muted flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px]">
          {settings?.extensionVersion ? `v${settings.extensionVersion} · ` : ''}{engineLabel}
        </span>
        <div
          className="flex items-center gap-1.5 bg-white/[0.03] border border-panel-border rounded-md px-2 py-0.5"
          title={t.sidebar.languageTooltip}
        >
          <Globe className="w-3 h-3 shrink-0 text-text-secondary" />
          <select
            value={languageSetting}
            onChange={(e) => changeLanguage(e.target.value as LanguageSetting)}
            className="bg-transparent text-[10px] font-mono text-text-primary focus:outline-none cursor-pointer"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-panel-card text-text-primary">
                {opt.shortLabel}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
};
