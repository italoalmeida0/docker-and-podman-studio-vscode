import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, HeartPulse, Plus, Search, Trash2 } from 'lucide-react';
import {
  ComposeBuilderSpec,
  serializeComposeBuilder,
  validateComposeBuilder,
} from '../../../src/shared/composeBuilder';
import { useI18n } from '../i18n';
import { useComposeExtras } from '../i18n/composeExtras';
import { useStudioStore } from '../store';
import { useVsCodeMessaging } from '../vscode';
import { ActionPillButton, Modal, SmallActionButton } from './Shared';

interface WizardService {
  id: number;
  serviceName: string;
  containerName: string;
  serviceSource: 'image' | 'build';
  image: string;
  buildImage: string;
  buildContext: string;
  buildDockerfile: string;
  ports: string[];
  restartPolicy: string;
  includeNetwork: boolean;
  networkName: string;
  includeVolume: boolean;
  volumeName: string;
  volumesText: string;
  environmentText: string;
  dependsText: string;
  commandText: string;
  hcEnabled: boolean;
  hcTest: string;
  hcInterval: string;
  hcTimeout: string;
  hcRetries: string;
  hcStartPeriod: string;
}

function initialService(id: number, dockerfile: string, network = 'app-net'): WizardService {
  return {
    id,
    serviceName: id === 1 ? 'app' : `service${id}`,
    containerName: '',
    serviceSource: 'image',
    image: id === 1 ? 'docker.io/library/nginx:alpine' : 'docker.io/library/alpine:latest',
    buildImage: '',
    buildContext: '.',
    buildDockerfile: dockerfile,
    ports: id === 1 ? ['8080:80'] : [],
    restartPolicy: 'unless-stopped',
    includeNetwork: Boolean(network),
    networkName: network || 'app-net',
    includeVolume: false,
    volumeName: 'app-data',
    volumesText: '',
    environmentText: '',
    dependsText: '',
    commandText: '',
    hcEnabled: false,
    hcTest: 'curl -f http://localhost/ || exit 1',
    hcInterval: '30s',
    hcTimeout: '5s',
    hcRetries: '3',
    hcStartPeriod: '10s',
  };
}

export const CreateComposeModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const { t, fmt, engine, engineLabel, locale } = useI18n();
  const extra = useComposeExtras();
  const { postMessage, onMessage } = useVsCodeMessaging();
  const {
    selectedDirectory, imageResults, setImageResults,
    setImageSearchError, operationsInProgress,
  } = useStudioStore();
  const searching = Boolean(operationsInProgress['image-search']);

  const defaultComposeFile = engine === 'podman' ? 'podman-compose.yml' : 'docker-compose.yml';
  const defaultDockerfile = engine === 'podman' ? 'Containerfile' : 'Dockerfile';

  const [directory, setDirectory] = useState('.');
  const [fileName, setFileName] = useState(defaultComposeFile);
  const [includeSampleService, setIncludeSampleService] = useState(true);
  const [services, setServices] = useState<WizardService[]>(() => [initialService(1, defaultDockerfile)]);
  const [activeServiceId, setActiveServiceId] = useState(1);
  const [creating, setCreating] = useState(false);
  const [confirmRemoveService, setConfirmRemoveService] = useState(false);
  const pendingCreation = useRef<string | null>(null);
  const [registryType, setRegistryType] = useState<'configured' | 'quay' | 'dockerhub' | 'custom'>(
    engine === 'podman' ? 'quay' : 'dockerhub'
  );
  const [registryUrl, setRegistryUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHcModal, setShowHcModal] = useState(false);
  const activeService = services.find((service) => service.id === activeServiceId) || services[0];
  const updateService = (changes: Partial<WizardService>) =>
    setServices((previous) => previous.map((service) =>
      service.id === activeServiceId ? { ...service, ...changes } : service
    ));
  const {
    serviceName, containerName, serviceSource, buildContext, buildDockerfile, ports,
    restartPolicy, includeNetwork, networkName, includeVolume, volumeName,
    volumesText, environmentText, dependsText, commandText, hcEnabled, hcTest,
    hcInterval, hcTimeout, hcRetries, hcStartPeriod,
  } = activeService;
  const image = serviceSource === 'build' ? activeService.buildImage : activeService.image;
  const setServiceName = (value: string) => updateService({ serviceName: value });
  const setContainerName = (value: string) => updateService({ containerName: value });
  const setServiceSource = (value: 'image' | 'build') => updateService({ serviceSource: value });
  const setImage = (value: string) => updateService(serviceSource === 'build' ? { buildImage: value } : { image: value });
  const setBuildContext = (value: string) => updateService({ buildContext: value });
  const setBuildDockerfile = (value: string) => updateService({ buildDockerfile: value });
  const setPorts = (value: React.SetStateAction<string[]>) =>
    setServices((previous) => previous.map((service) => service.id === activeServiceId
      ? { ...service, ports: typeof value === 'function' ? value(service.ports) : value }
      : service));
  const setRestartPolicy = (value: string) => updateService({ restartPolicy: value });
  const setIncludeNetwork = (value: boolean) => updateService({ includeNetwork: value });
  const setNetworkName = (value: string) => updateService({ networkName: value });
  const setIncludeVolume = (value: boolean) => updateService({ includeVolume: value });
  const setVolumeName = (value: string) => updateService({ volumeName: value });
  const setVolumesText = (value: string) => updateService({ volumesText: value });
  const setEnvironmentText = (value: string) => updateService({ environmentText: value });
  const setDependsText = (value: string) => updateService({ dependsText: value });
  const setCommandText = (value: string) => updateService({ commandText: value });
  const setHcEnabled = (value: boolean) => updateService({ hcEnabled: value });
  const setHcTest = (value: string) => updateService({ hcTest: value });
  const setHcInterval = (value: string) => updateService({ hcInterval: value });
  const setHcTimeout = (value: string) => updateService({ hcTimeout: value });
  const setHcRetries = (value: string) => updateService({ hcRetries: value });
  const setHcStartPeriod = (value: string) => updateService({ hcStartPeriod: value });

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

  useEffect(() => onMessage((message) => {
    if (!message.requestId || message.requestId !== pendingCreation.current) return;
    if (message.command === 'compose:create:saved' || message.command === 'compose:create:failed') {
      pendingCreation.current = null;
      setCreating(false);
      if (message.command === 'compose:create:saved') {
        setImageResults([]);
        onClose();
      }
    }
  }), [onMessage, onClose, setImageResults]);

  const spec = useMemo<ComposeBuilderSpec>(() => ({
    services: includeSampleService ? services.map((service) => ({
      name: service.serviceName,
      containerName: service.containerName,
      source: service.serviceSource,
      image: service.serviceSource === 'build' ? service.buildImage : service.image,
      buildContext: service.buildContext,
      buildDockerfile: service.buildDockerfile,
      ports: service.ports,
      restartPolicy: service.restartPolicy,
      networkName: service.includeNetwork ? service.networkName : '',
      volumeName: service.includeVolume ? service.volumeName : '',
      volumesText: service.volumesText,
      environmentText: service.environmentText,
      dependsText: service.dependsText,
      commandText: service.commandText,
      healthcheck: service.hcEnabled ? {
        test: service.hcTest,
        interval: service.hcInterval,
        timeout: service.hcTimeout,
        retries: service.hcRetries,
        startPeriod: service.hcStartPeriod,
      } : undefined,
    })) : [],
  }), [includeSampleService, services]);
  const validation = useMemo(() => [
    ...validateComposeBuilder(spec, {}, locale),
    ...(includeSampleService && services.some((service) =>
      (service.includeNetwork && !service.networkName.trim()) ||
      (service.includeVolume && !service.volumeName.trim())
    ) ? [extra.wizardResourceName] : []),
  ], [extra.wizardResourceName, includeSampleService, services, spec, locale]);
  const previewYaml = useMemo(
    () => validation.length === 0 ? serializeComposeBuilder(spec) : '',
    [spec, validation]
  );

  const handleCreate = () => {
    if (creating || validation.length > 0) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingCreation.current = requestId;
    setCreating(true);
    postMessage('compose:file:create', {
      directory,
      fileName,
      spec,
    }, requestId);
  };

  return (
    <>
      <Modal
        title={fmt(t.wizard.title, { engine: engineLabel })}
        subtitle={t.wizard.subtitle}
        maxWidth="max-w-5xl"
        feedback
        lockFields={creating}
        onClose={() => { if (!creating) onClose(); }}
        footer={
          <>
            <ActionPillButton label={t.common.cancel} disabled={creating} onClick={onClose} />
            <ActionPillButton
              label={t.wizard.createBtn}
              loading={creating}
              loadingLabel={extra.creatingFile}
              disabled={validation.length > 0 || !directory.trim() || !fileName.trim()}
              variant="podman"
              onClick={handleCreate}
            />
          </>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
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
              {includeSampleService && (
                <>
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
                </>
              )}
            </div>

            {includeSampleService && (
              <div className="space-y-3 border-t border-panel-border pt-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-text-primary">{extra.servicesInWizard}</span>
                    <div className="flex gap-2">
                      <SmallActionButton
                        label={extra.addAnotherService}
                        icon={<Plus className="w-3 h-3" />}
                        onClick={() => {
                          let id = Math.max(...services.map((service) => service.id)) + 1;
                          while (services.some((service) => service.serviceName.trim() === `service${id}`)) id++;
                          const next = initialService(
                            id, defaultDockerfile, includeNetwork ? networkName.trim() : ''
                          );
                          setServices((previous) => [...previous, next]);
                          setActiveServiceId(id);
                        }}
                      />
                      <SmallActionButton
                        label={extra.removeCurrentService}
                        danger
                        disabled={services.length <= 1}
                        icon={<Trash2 className="w-3 h-3" />}
                        onClick={() => setConfirmRemoveService(true)}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {services.map((service) => (
                      <button
                        key={service.id}
                        type="button"
                        aria-pressed={service.id === activeServiceId}
                        onClick={() => setActiveServiceId(service.id)}
                        className={`px-3 py-1 text-xs rounded-lg border font-mono ${
                          service.id === activeServiceId
                            ? 'bg-accent-purple text-white border-accent-purple'
                            : 'bg-panel-bg border-panel-border text-text-secondary'
                        }`}
                      >
                        {service.serviceName || `service${service.id}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-text-secondary">{extra.wizardNetworkHint}</p>
                </div>
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
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] gap-2">
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
            {validation.length > 0 ? (
              <div role="alert" className="text-xs text-accent-orange space-y-2">
                <p>{extra.wizardValidation}</p>
                <ul className="list-disc pl-4 space-y-1">
                  {validation.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
                </ul>
                <p>{extra.wizardPreviewUnavailable}</p>
              </div>
            ) : (
              <pre className="flex-1 overflow-auto font-mono text-xs text-text-primary whitespace-pre-wrap leading-5">
                {previewYaml}
              </pre>
            )}
          </div>
        </div>
      </Modal>

      {confirmRemoveService && (
        <Modal
          title={extra.removeWizardTitle}
          onClose={() => setConfirmRemoveService(false)}
          footer={(
            <>
              <ActionPillButton label={t.common.cancel} onClick={() => setConfirmRemoveService(false)} />
              <ActionPillButton
                label={t.common.remove}
                variant="danger"
                onClick={() => {
                  const remaining = services.filter((service) => service.id !== activeServiceId);
                  setServices(remaining);
                  setActiveServiceId(remaining[0].id);
                  setConfirmRemoveService(false);
                }}
              />
            </>
          )}
        >
          <p className="text-sm text-text-secondary">
            {fmt(extra.removeWizardDetail, { name: serviceName })}
          </p>
        </Modal>
      )}

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
