import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ComposePage } from './pages/ComposePage';
import { ContainersPage } from './pages/ContainersPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImagesPage } from './pages/ImagesPage';
import { NetworksPage } from './pages/NetworksPage';
import { SettingsPage } from './pages/SettingsPage';
import { ToolsPage } from './pages/ToolsPage';
import { VolumesPage } from './pages/VolumesPage';
import { useI18n } from './i18n';
import { useStudioMessageBridge, useStudioStore } from './store';
import { postStudioMessage } from './vscode';

export const App: React.FC = () => {
  useStudioMessageBridge();
  const { t } = useI18n();
  const { activePage, banner, dismissBanner, operationInProgress, operationLabels } = useStudioStore();

  useEffect(() => {
    if (!banner || banner.type === 'error') {
      return;
    }
    const timer = setTimeout(
      () => dismissBanner(),
      banner.message.includes('\n') ? 12000 : 4200
    );
    return () => clearTimeout(timer);
  }, [banner, dismissBanner]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-panel-bg text-text-primary">
      <Sidebar />

      <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
        {operationInProgress && (
          <div
            role="status"
            aria-live="polite"
            className="mx-6 mt-3 px-4 py-2 rounded-md border border-accent-purple bg-purple-500/10 flex items-center gap-2 text-xs text-text-primary"
          >
            <LoaderCircle className="w-4 h-4 shrink-0 animate-spin text-accent-purple" />
            <span>{t.common.working} {operationLabels[operationInProgress]}</span>
          </div>
        )}
        {banner && (
          <div
            className={`mx-6 mt-3 px-4 py-2.5 rounded-md border shadow-elevated flex items-center justify-between gap-3 text-xs z-40 ${
              banner.type === 'error'
                ? 'bg-red-500/15 border-accent-red text-red-300'
                : banner.type === 'success'
                ? 'bg-green-500/15 border-accent-green text-accent-green'
                : 'bg-purple-500/15 border-accent-purple text-text-primary'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {banner.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-accent-red" />
              ) : banner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-accent-green" />
              ) : (
                <Info className="w-4 h-4 shrink-0 text-accent-purple" />
              )}
              <span className="break-words whitespace-pre-wrap">{banner.message}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(banner.type === 'error' || banner.message.includes('\n')) && (
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => postStudioMessage('output:show')}
                >
                  {t.common.showOutput}
                </button>
              )}
              <button
                type="button"
                aria-label={t.common.close}
                onClick={dismissBanner}
                className="p-1 rounded hover:bg-black/20 text-current"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {activePage === 'dashboard' && <DashboardPage />}
          {activePage === 'compose' && <ComposePage />}
          {activePage === 'containers' && <ContainersPage />}
          {activePage === 'images' && <ImagesPage />}
          {activePage === 'volumes' && <VolumesPage />}
          {activePage === 'networks' && <NetworksPage />}
          {activePage === 'tools' && <ToolsPage />}
          {activePage === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
};
