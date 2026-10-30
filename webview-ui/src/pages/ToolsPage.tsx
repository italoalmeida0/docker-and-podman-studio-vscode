import React from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  ExternalLink,
  FilePlus2,
  RotateCcw,
  Server,
  Settings,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { ActionPillButton, SmallActionButton } from '../components/Shared';
import { useI18n } from '../i18n';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';

export const ToolsPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const { t, fmt, engine, engineLabel, changeEngine } = useI18n();
  const { operationInProgress, setActivePage } = useStudioStore();
  const busy = Boolean(operationInProgress);
  const isPodman = engine === 'podman';
  const accentText = isPodman ? 'text-accent-purple' : 'text-accent-blue';
  const targetEngineLabel = isPodman ? 'Docker' : 'Podman';

  const quickLinks = [
    {
      title: t.tools.links.dockerDocsTitle,
      desc: t.tools.links.dockerDocsDesc,
      url: 'https://docs.docker.com/',
    },
    {
      title: t.tools.links.dockerHubTitle,
      desc: t.tools.links.dockerHubDesc,
      url: 'https://hub.docker.com/',
    },
    {
      title: t.tools.links.podmanDocsTitle,
      desc: t.tools.links.podmanDocsDesc,
      url: 'https://docs.podman.io/en/latest/',
    },
    {
      title: t.tools.links.quayTitle,
      desc: t.tools.links.quayDesc,
      url: 'https://quay.io/search',
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Wrench className={`w-5 h-5 ${accentText}`} />
            <span>{fmt(t.tools.title, { engine: engineLabel })}</span>
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.tools.subtitle}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Maintenance Suite */}
          <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card space-y-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Sparkles className={`w-4 h-4 ${accentText}`} />
              <span>{fmt(t.tools.maintenanceTitle, { engine: engineLabel })}</span>
            </h2>
            <p className="text-xs text-text-secondary">{t.tools.maintenanceDesc}</p>
            <div className="flex flex-wrap gap-2">
              <ActionPillButton
                label={t.tools.pruneDanglingBtn}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('prune:images')}
              />
              <ActionPillButton
                label={t.tools.pruneUnusedBtn}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('prune:all:images')}
              />
              <ActionPillButton
                label={t.tools.pruneBuildCacheBtn}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('prune:builder')}
              />
              <ActionPillButton
                label={t.tools.pruneVolumesBtn}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('prune:volumes')}
              />
              <ActionPillButton
                label={`${t.sidebar.networks}: ${t.images.filterUnused}`}
                disabled={busy}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => postMessage('prune:networks')}
              />
            </div>
          </div>

          {/* Engine & Workspace Utilities */}
          <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card space-y-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Server className={`w-4 h-4 ${accentText}`} />
              <span>{t.tools.engineUtilsTitle}</span>
            </h2>
            <p className="text-xs text-text-secondary">{t.tools.engineUtilsDesc}</p>
            <div className="flex flex-wrap gap-2">
              <ActionPillButton
                label={fmt(t.tools.switchEngineBtn, { targetEngine: targetEngineLabel })}
                variant="brand"
                icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
                onClick={() => changeEngine(isPodman ? 'docker' : 'podman')}
              />
              <ActionPillButton
                label={t.tools.registerExternalComposeBtn}
                icon={<FilePlus2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  postMessage('compose:file:pick');
                  setActivePage('compose');
                }}
              />
              {isPodman && (
                <ActionPillButton
                  label={t.tools.restartMachineBtn}
                  disabled={busy}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={() => postMessage('machine:restart', {})}
                />
              )}
              <ActionPillButton
                label={t.tools.resetPathsBtn}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={() => postMessage('settings:resetPaths')}
              />
              <ActionPillButton
                label={t.tools.openVscodeSettingsBtn}
                icon={<Settings className="w-3.5 h-3.5" />}
                onClick={() => postMessage('vscode:settings:open')}
              />
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card space-y-4">
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <BookOpen className={`w-4 h-4 ${accentText}`} />
            <span>{t.tools.quickLinksTitle}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {quickLinks.map((item) => (
              <div
                key={item.url}
                className="bg-panel-bg border border-panel-border rounded-md p-4 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-text-primary">{item.title}</div>
                  <p className="text-xs text-text-secondary">{item.desc}</p>
                </div>
                <SmallActionButton
                  label={t.common.open}
                  accent
                  icon={<ExternalLink className="w-3 h-3" />}
                  onClick={() => postMessage('external:open', { url: item.url })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
