import React from 'react';
import { FeedbackCenter } from './components/FeedbackCenter';
import { Sidebar } from './components/Sidebar';
import { ComposePage } from './pages/ComposePage';
import { ContainersPage } from './pages/ContainersPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImagesPage } from './pages/ImagesPage';
import { NetworksPage } from './pages/NetworksPage';
import { SettingsPage } from './pages/SettingsPage';
import { ToolsPage } from './pages/ToolsPage';
import { VolumesPage } from './pages/VolumesPage';
import { useStudioMessageBridge, useStudioStore } from './store';

export const App: React.FC = () => {
  useStudioMessageBridge();
  const activePage = useStudioStore((state) => state.activePage);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-panel-bg text-text-primary">
      <Sidebar />

      <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
        <FeedbackCenter />

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
