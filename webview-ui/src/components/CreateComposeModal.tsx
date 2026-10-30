import React, { useEffect, useMemo, useState } from 'react';
import { FolderOpen, HeartPulse, Plus, Search, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';
import { ActionPillButton, Modal, SmallActionButton } from './Shared';

export const CreateComposeModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const { t, fmt, engine, engineLabel } = useI18n();
  const { postMessage } = useVsCodeMessaging();
  const {
    selectedDirectory, imageResults, setImageResults, imageSearchError,
    setImageSearchError, operationsInProgress,
  } = useStudioStore();
  const searching = Boolean(operationsInProgress['image-search']);

  const defaultComposeFile = engine === 'podman' ? 'podman-compose.yml' : 'docker-compose.yml';
  const defaultDockerfile = engine === 'podman' ? 'Containerfile' : 'Dockerfile';

  const [directory, setDirectory] = useState('.');
  const [fileName, setFileName] = useState(defaultComposeFile);
  const [includeSampleService, setIncludeSampleService] = useState(true);
  const [serviceName, setServiceName] = useState('app');
  const [containerName, setContainerName] = useState('');
  const [serviceSource, setServiceSource] = useState<'image' | 'build'>('image');
  const [registryType, setRegistryType] = useState<'configured' | 'quay' | 'dockerhub' | 'custom'>(
    engine === 'podman' ? 'quay' : 'dockerhub'
  );
  const [registryUrl, setRegistryUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [image, setImage] = useState('docker.io/library/nginx:alpine');
  const [buildContext, setBuildContext] = useState('.');
  const [buildDockerfile, setBuildDockerfile] = useState(defaultDockerfile);
  const [ports, setPorts] = useState<string[]>(['8080:80']);
  const [restartPolicy, setRestartPolicy] = useState('unless-stopped');
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [networkName, setNetworkName] = useState('app-net');
  const [includeVolume, setIncludeVolume] = useState(false);
  const [volumeName, setVolumeName] = useState('app-data');
  const [volumesText, setVolumesText] = useState('');
  const [environmentText, setEnvironmentText] = useState('');
  const [dependsText, setDependsText] = useState('');
  const [commandText, setCommandText] = useState('');

  // Healthcheck sub-modal
  const [showHcModal, setShowHcModal] = useState(false);
  const [hcEnabled, setHcEnabled] = useState(false);
  const [hcTest, setHcTest] = useState('curl -f http://localhost/ || exit 1');
  const [hcInterval, setHcInterval] = useState('30s');
  const [hcTimeout, setHcTimeout] = useState('5s');
  const [hcRetries, setHcRetries] = useState('3');
  const [hcStartPeriod, setHcStartPeriod] = useState('10s');

  const searchRegistry = () => {
    if (searching) return;
    setImageResults([]);
    setImageSearchError(null);
    postMessage('compose:image:search', { registryType, registryUrl, query: searchQuery });
  };

  useEffect(() => {
    setImageResults([]);
    setImageSearchError(null);
    return () => postMessage('compose:image:search', { query: '' });
  }, [postMessage, setImageResults, setImageSearchError]);

  useEffect(() => {
    if (selectedDirectory) {
      setDirectory(selectedDirectory);
    }
  }, [selectedDirectory]);

  const previewYaml = useMemo(() => {
    const lines: string[] = ['services:'];
    if (!includeSampleService) {
      lines.push('  {}');
      return lines.join('\n');
    }
    const svc = serviceName.trim() || 'app';
    lines.push(`  ${svc}:`);
    if (serviceSource === 'build') {
      lines.push('    build:');
      lines.push(`      context: ${buildContext.trim() || '.'}`);
      lines.push(`      dockerfile: ${buildDockerfile.trim() || 'Containerfile'}`);
      if (image.trim()) {
        lines.push(`    image: ${image.trim()}`);
      }
    } else {
      lines.push(`    image: ${image.trim() || 'docker.io/library/nginx:alpine'}`);
    }
    if (containerName.trim()) {
      lines.push(`    container_name: ${containerName.trim()}`);
    }
    const validPorts = ports.map((p) => p.trim()).filter(Boolean);
    if (validPorts.length > 0) {
      lines.push('    ports:');
      validPorts.forEach((p) => lines.push(`      - "${p}"`));
    }
    if (restartPolicy) {
      lines.push(`    restart: ${restartPolicy}`);
    }
    if (includeNetwork && networkName.trim()) {
      lines.push('    networks:');
      lines.push(`      - ${networkName.trim()}`);
    }
    if (includeVolume && volumeName.trim()) {
      lines.push('    volumes:');
      lines.push(`      - ${volumeName.trim()}:/data`);
    }
    if (hcEnabled && hcTest.trim()) {
      lines.push('    healthcheck:');
      lines.push(`      test: ["CMD-SHELL", "${hcTest.trim()}"]`);
      lines.push(`      interval: ${hcInterval || '30s'}`);
    }
    if (includeNetwork && networkName.trim()) {
      lines.push('', 'networks:', `  ${networkName.trim()}:`, '    driver: bridge');
    }
    if (includeVolume && volumeName.trim()) {
      lines.push('', 'volumes:', `  ${volumeName.trim()}: {}`);
    }
    return lines.join('\n');
  }, [
    includeSampleService,
    serviceName,
    serviceSource,
    buildContext,
    buildDockerfile,
    image,
    containerName,
    ports,
    restartPolicy,
    includeNetwork,
    networkName,
    includeVolume,
    volumeName,
    hcEnabled,
    hcTest,
    hcInterval,
  ]);

  const handleCreate = () => {
    postMessage('compose:file:create', {
      directory,
      fileName,
      includeSampleService,
      serviceName,
      containerName,
      serviceSource,
      image,
      buildContext,
      buildDockerfile,
      ports,
      restartPolicy,
      includeNetwork,
      networkName,
      includeVolume,
      volumeName,
      volumesText,
      environmentText,
      dependsText,
      commandText,
      healthcheck:
        hcEnabled && hcTest.trim()
          ? {
              test: hcTest,
              interval: hcInterval,
              timeout: hcTimeout,
              retries: hcRetries,
              startPeriod: hcStartPeriod,
            }
          : undefined,
    });
    setImageResults([]);
    onClose();
  };

  return (
    <>
      <Modal
        title={fmt(t.wizard.title, { engine: engineLabel })}
        subtitle={t.wizard.subtitle}
        maxWidth="max-w-5xl"
        onClose={onClose}
        footer={
          <>
            <ActionPillButton label={t.common.cancel} onClick={onClose} />
            <ActionPillButton
              label={t.wizard.createBtn}
              variant="podman"
              onClick={handleCreate}
            />
          </>
        }
      >
        <div className="grid grid-cols-[1fr_340px] gap-5">
          {/* Left Form */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t.wizard.directoryLabel}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    className="input-field font-mono"
                  />
                  <SmallActionButton
                    label={t.common.folder}
                    icon={<FolderOpen className="w-3.5 h-3.5" />}
                    onClick={() => postMessage('compose:directory:pick')}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t.wizard.fileNameLabel}
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="podman-compose.yml"
                  className="input-field font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-5 py-1 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSampleService}
                  onChange={(e) => setIncludeSampleService(e.target.checked)}
                />
                {t.wizard.includeInitialService}
              </label>
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeNetwork}
                  onChange={(e) => setIncludeNetwork(e.target.checked)}
                />
                {t.wizard.createDedicatedNetwork}
              </label>
              <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeVolume}
                  onChange={(e) => setIncludeVolume(e.target.checked)}
                />
                {t.wizard.createPersistentVolume}
              </label>
            </div>

            {includeSampleService && (
              <div className="space-y-3 border-t border-panel-border pt-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.serviceName}
                    </label>
                    <input
                      type="text"
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                      className="input-field font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.containerName}
                    </label>
                    <input
                      type="text"
                      value={containerName}
                      onChange={(e) => setContainerName(e.target.value)}
                      placeholder={t.common.optional}
                      className="input-field font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.restartPolicy}
                    </label>
                    <select
                      value={restartPolicy}
                      onChange={(e) => setRestartPolicy(e.target.value)}
                      className="input-field"
                    >
                      <option value="unless-stopped">unless-stopped</option>
                      <option value="always">always</option>
                      <option value="on-failure">on-failure</option>
                      <option value="no">no</option>
                    </select>
                  </div>
                </div>

                {/* Source Toggle */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setServiceSource('image')}
                      className={`px-3 py-1 text-xs rounded ${
                        serviceSource === 'image'
                          ? 'bg-accent-purple text-white'
                          : 'bg-panel-bg border border-panel-border text-text-secondary'
                      }`}
                    >
                      {t.wizard.readyImageBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setServiceSource('build')}
                      className={`px-3 py-1 text-xs rounded ${
                        serviceSource === 'build'
                          ? 'bg-accent-purple text-white'
                          : 'bg-panel-bg border border-panel-border text-text-secondary'
                      }`}
                    >
                      {t.wizard.localBuildBtn}
                    </button>
                  </div>

                  <SmallActionButton
                    label={hcEnabled ? t.wizard.hcConfigured : t.wizard.hcConfigure}
                    accent={hcEnabled}
                    icon={<HeartPulse className="w-3.5 h-3.5" />}
                    onClick={() => setShowHcModal(true)}
                  />
                </div>

                {serviceSource === 'image' ? (
                  <div className="space-y-2 bg-panel-bg border border-panel-border rounded-md p-3">
                    <div className="grid grid-cols-[150px_1fr_auto] gap-2">
                      <select
                        value={registryType}
                        onChange={(e) => setRegistryType(e.target.value as any)}
                        className="input-field text-xs"
                      >
                        <option value="quay">Quay.io</option>
                        <option value="dockerhub">Docker Hub</option>
                        <option value="configured">{t.wizard.regConfigured}</option>
                        <option value="custom">{t.wizard.regCustomUrl}</option>
                      </select>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            searchRegistry();
                          }
                        }}
                        placeholder={t.wizard.searchRegistryPlaceholder}
                        className="input-field text-xs"
                      />
                      <ActionPillButton
                        label={t.common.search}
                        loading={searching}
                        icon={<Search className="w-3.5 h-3.5" />}
                        onClick={searchRegistry}
                      />
                    </div>
                    {registryType === 'custom' && (
                      <input
                        type="text"
                        value={registryUrl}
                        onChange={(e) => setRegistryUrl(e.target.value)}
                        placeholder="registry.company.local:5000"
                        className="input-field font-mono text-xs"
                      />
                    )}
                    {imageSearchError && (
                      <p role="alert" className="text-xs text-accent-red">
                        {imageSearchError}{' '}
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={() => postMessage('output:show')}
                        >
                          {t.common.showOutput}
                        </button>
                      </p>
                    )}
                    {imageResults.length > 0 && (
                      <div className="max-h-36 overflow-auto space-y-1 pt-1">
                        {imageResults.map((res) => (
                          <button
                            key={res.name}
                            type="button"
                            onClick={() => setImage(res.name)}
                            className="w-full text-left px-2.5 py-1.5 rounded bg-panel-card hover:bg-panel-card-hover border border-panel-border flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="font-mono text-text-primary truncate">{res.name}</span>
                            <span className="text-[10px] text-accent-purple shrink-0">
                              {res.source}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] text-text-secondary mb-1">
                        {t.wizard.selectedImage}
                      </label>
                      <input
                        type="text"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        className="input-field font-mono"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 bg-panel-bg border border-panel-border rounded-md p-3">
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">
                        {t.wizard.buildContext}
                      </label>
                      <input
                        type="text"
                        value={buildContext}
                        onChange={(e) => setBuildContext(e.target.value)}
                        className="input-field font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">
                        {t.wizard.containerfile}
                      </label>
                      <input
                        type="text"
                        value={buildDockerfile}
                        onChange={(e) => setBuildDockerfile(e.target.value)}
                        className="input-field font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">
                        {t.wizard.optionalTag}
                      </label>
                      <input
                        type="text"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder="localhost/app:dev"
                        className="input-field font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Dynamic Ports */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-text-secondary">{t.wizard.portMappings}</label>
                    <SmallActionButton
                      label={t.wizard.addPort}
                      icon={<Plus className="w-3 h-3" />}
                      onClick={() => setPorts((prev) => [...prev, ''])}
                    />
                  </div>
                  <div className="space-y-1.5">
                    {ports.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={p}
                          onChange={(e) =>
                            setPorts((prev) =>
                              prev.map((item, i) => (i === idx ? e.target.value : item))
                            )
                          }
                          placeholder="8080:80"
                          className="input-field font-mono text-xs"
                        />
                        <SmallActionButton
                          label={t.common.remove}
                          danger
                          icon={<Trash2 className="w-3 h-3" />}
                          onClick={() => setPorts((prev) => prev.filter((_, i) => i !== idx))}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Network & Volume Names */}
                {(includeNetwork || includeVolume) && (
                  <div className="grid grid-cols-2 gap-3">
                    {includeNetwork && (
                      <div>
                        <label className="block text-xs text-text-secondary mb-1">
                          {t.wizard.networkName}
                        </label>
                        <input
                          type="text"
                          value={networkName}
                          onChange={(e) => setNetworkName(e.target.value)}
                          className="input-field font-mono"
                        />
                      </div>
                    )}
                    {includeVolume && (
                      <div>
                        <label className="block text-xs text-text-secondary mb-1">
                          {t.wizard.volumeName}
                        </label>
                        <input
                          type="text"
                          value={volumeName}
                          onChange={(e) => setVolumeName(e.target.value)}
                          className="input-field font-mono"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.envLabel}
                    </label>
                    <textarea
                      value={environmentText}
                      onChange={(e) => setEnvironmentText(e.target.value)}
                      placeholder={'TZ=UTC\nNODE_ENV=development'}
                      className="input-field min-h-20 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.extraMountsLabel}
                    </label>
                    <textarea
                      value={volumesText}
                      onChange={(e) => setVolumesText(e.target.value)}
                      placeholder="./config:/etc/app:Z"
                      className="input-field min-h-20 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.dependsOnLabel}
                    </label>
                    <input
                      type="text"
                      value={dependsText}
                      onChange={(e) => setDependsText(e.target.value)}
                      placeholder="db"
                      className="input-field font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t.wizard.commandLabel}
                    </label>
                    <input
                      type="text"
                      value={commandText}
                      onChange={(e) => setCommandText(e.target.value)}
                      placeholder={t.common.optional}
                      className="input-field font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Live YAML Preview */}
          <div className="bg-panel-bg border border-panel-border rounded-md p-3 flex flex-col">
            <div className="text-[11px] uppercase tracking-wider text-text-secondary mb-2 flex items-center justify-between">
              <span>{t.wizard.yamlPreview}</span>
              <span className="font-mono text-accent-purple">
                {fileName || 'podman-compose.yml'}
              </span>
            </div>
            <pre className="flex-1 overflow-auto font-mono text-xs text-text-primary whitespace-pre-wrap leading-5">
              {previewYaml}
            </pre>
          </div>
        </div>
      </Modal>

      {/* Healthcheck Modal */}
      {showHcModal && (
        <Modal
          title={t.wizard.hcModalTitle}
          subtitle={t.wizard.hcModalSubtitle}
          maxWidth="max-w-lg"
          onClose={() => setShowHcModal(false)}
          footer={
            <>
              <ActionPillButton
                label={t.wizard.disableBtn}
                variant="danger"
                onClick={() => {
                  setHcEnabled(false);
                  setShowHcModal(false);
                }}
              />
              <ActionPillButton
                label={t.wizard.saveHcBtn}
                variant="podman"
                onClick={() => {
                  setHcEnabled(true);
                  setShowHcModal(false);
                }}
              />
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.wizard.cmdShellLabel}
              </label>
              <input
                type="text"
                value={hcTest}
                onChange={(e) => setHcTest(e.target.value)}
                className="input-field font-mono"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Interval</label>
                <input
                  type="text"
                  value={hcInterval}
                  onChange={(e) => setHcInterval(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Timeout</label>
                <input
                  type="text"
                  value={hcTimeout}
                  onChange={(e) => setHcTimeout(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Retries</label>
                <input
                  type="number"
                  value={hcRetries}
                  onChange={(e) => setHcRetries(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Start Period</label>
                <input
                  type="text"
                  value={hcStartPeriod}
                  onChange={(e) => setHcStartPeriod(e.target.value)}
                  className="input-field font-mono text-xs"
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
