import React, { useEffect, useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  Cpu,
  Globe,
  KeyRound,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { ActionPillButton, Modal } from '../components/Shared';
import { DockerMark, PodmanMark } from '../components/BrandIcons';
import { LANGUAGE_OPTIONS, useI18n } from '../i18n';
import {
  ContainerEngine,
  LanguageSetting,
  StudioSettings,
  useStudioStore,
} from '../store';
import { useVsCodeMessaging } from '../vscode';

const DEFAULT_SETTINGS: StudioSettings = {
  engine: 'docker',
  language: 'auto',
  dockerPath: 'docker',
  podmanPath: 'podman',
  composePath: '',
  composeCommandStyle: 'auto',
  inPod: 'default',
  machineName: 'podman-machine-default',
  pollingInterval: 2500,
  logBufferSize: 5000,
  autoDetectFiles: true,
  confirmDeletions: true,
  logsOutput: 'studio',
  enablePushCommand: true,
  pushDefaultRegistry: '',
  registryProvider: 'dockerhub',
  registryUrl: '',
  registryAuthType: 'engineCli',
  registryUsername: '',
  registryAutoLogin: true,
  hasRegistrySecret: false,
};

export const SettingsPage: React.FC = () => {
  const { postMessage } = useVsCodeMessaging();
  const {
    t,
    fmt,
    languageSetting,
    changeLanguage,
    engine,
    engineLabel,
    engineCmd,
    changeEngine,
  } = useI18n();
  const { settings, settingsTestResult, setSettingsTestResult, operationsInProgress } = useStudioStore();

  const [form, setForm] = useState<StudioSettings>(settings || DEFAULT_SETTINGS);
  const [registrySecret, setRegistrySecret] = useState('');
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const updateField = <K extends keyof StudioSettings>(key: K, val: StudioSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleEngineChange = (nextEngine: ContainerEngine) => {
    updateField('engine', nextEngine);
    changeEngine(nextEngine);
  };

  const handleLanguageChange = (nextLang: LanguageSetting) => {
    updateField('language', nextLang);
    changeLanguage(nextLang);
  };

  const handleSave = () => {
    setSettingsTestResult(null);
    postMessage('settings:save', {
      ...form,
      engine,
      language: languageSetting,
      ...(registrySecret.trim() ? { registrySecret: registrySecret.trim() } : {}),
    });
    setRegistrySecret('');
  };

  const handleTestRegistry = () => {
    setSettingsTestResult(null);
    postMessage('settings:test', {
      ...form,
      engine,
      ...(registrySecret.trim() ? { registrySecret: registrySecret.trim() } : {}),
    });
  };

  const accentIconClass = engine === 'podman' ? 'text-accent-purple' : 'text-accent-blue';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-panel-border bg-panel-card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-text-primary">
            {t.settings.title}
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t.settings.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionPillButton
            label={t.settings.resetPathsBtn}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => postMessage('settings:resetPaths')}
          />
          <ActionPillButton
            label={t.settings.saveSettingsBtn}
            variant="brand"
            icon={<Save className="w-3.5 h-3.5" />}
            onClick={handleSave}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6 space-y-5 max-w-5xl">
        {/* Section 0: Container Engine Selector (Docker Default vs Podman) */}
        <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-text-primary">
              {t.settings.engineSectionTitle}
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">{t.settings.engineSectionDesc}</p>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            {/* Docker Card (Default) */}
            <button
              type="button"
              onClick={() => handleEngineChange('docker')}
              className={`text-left rounded-xl p-4 border transition-all flex flex-col justify-between gap-2.5 ${
                engine === 'docker'
                  ? 'border-sky-400/40 bg-sky-500/[0.07] shadow-card'
                  : 'border-panel-border bg-panel-bg hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-sky-500/[0.14] border border-sky-400/25 text-sky-400 flex items-center justify-center">
                    <DockerMark className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-text-primary">
                    {t.settings.engineDockerTitle}
                  </span>
                </div>
                {engine === 'docker' && (
                  <span className="px-2.5 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    {t.settings.activeBadge}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                {t.settings.engineDockerDesc}
              </p>
            </button>

            {/* Podman Card */}
            <button
              type="button"
              onClick={() => handleEngineChange('podman')}
              className={`text-left rounded-xl p-4 border transition-all flex flex-col justify-between gap-2.5 ${
                engine === 'podman'
                  ? 'border-violet-400/40 bg-violet-500/[0.07] shadow-card'
                  : 'border-panel-border bg-panel-bg hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-violet-500/[0.14] border border-violet-400/25 text-violet-400 flex items-center justify-center">
                    <PodmanMark className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-text-primary">
                    {t.settings.enginePodmanTitle}
                  </span>
                </div>
                {engine === 'podman' && (
                  <span className="px-2.5 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    {t.settings.activeBadge}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                {t.settings.enginePodmanDesc}
              </p>
            </button>
          </div>
        </div>

        {/* Section 1: Multi-Language Switcher (16 Languages + Auto) */}
        <div className="bg-panel-card border border-panel-border rounded-xl p-5 shadow-card space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                {t.settings.languageSectionTitle}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">{t.settings.languageSectionDesc}</p>
            </div>
          </div>

          <div className="max-w-md">
            <label className="block text-xs text-text-secondary mb-1">
              {t.settings.languageLabel}
            </label>
            <select
              value={languageSetting}
              onChange={(e) => handleLanguageChange(e.target.value as LanguageSetting)}
              className="input-field"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === 'auto' ? t.settings.languageAutoOption : opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Section 2: Docker, Podman & Compose CLI */}
        <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {t.settings.cliSectionTitle}
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">{t.settings.cliSectionDesc}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.dockerExecutableLabel}
              </label>
              <input
                type="text"
                value={form.dockerPath}
                onChange={(e) => updateField('dockerPath', e.target.value)}
                placeholder="docker"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.podmanExecutableLabel}
              </label>
              <input
                type="text"
                value={form.podmanPath}
                onChange={(e) => updateField('podmanPath', e.target.value)}
                placeholder="podman"
                className="input-field font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.composeModeLabel}
              </label>
              <select
                value={form.composeCommandStyle}
                onChange={(e) =>
                  updateField(
                    'composeCommandStyle',
                    e.target.value as StudioSettings['composeCommandStyle']
                  )
                }
                className="input-field"
              >
                <option value="auto">{t.settings.composeModeAuto}</option>
                <option value="plugin">{t.settings.composeModePlugin}</option>
                <option value="standalone">{t.settings.composeModeStandalone}</option>
                <option value="custom">{t.settings.composeModeCustom}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.composeExecutableLabel}
              </label>
              <input
                type="text"
                value={form.composePath}
                onChange={(e) => updateField('composePath', e.target.value)}
                placeholder={engine === 'podman' ? 'podman-compose' : 'docker-compose'}
                className="input-field font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.podGroupingLabel}
              </label>
              <select
                value={form.inPod}
                onChange={(e) => updateField('inPod', e.target.value as StudioSettings['inPod'])}
                className="input-field"
              >
                <option value="default">{t.settings.podGroupingDefault}</option>
                <option value="true">{t.settings.podGroupingTrue}</option>
                <option value="false">{t.settings.podGroupingFalse}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.defaultMachineLabel}
              </label>
              <input
                type="text"
                value={form.machineName}
                onChange={(e) => updateField('machineName', e.target.value)}
                placeholder="podman-machine-default"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.defaultLogsOutputLabel}
              </label>
              <select
                value={form.logsOutput}
                onChange={(e) =>
                  updateField('logsOutput', e.target.value as StudioSettings['logsOutput'])
                }
                className="input-field"
              >
                <option value="studio">{t.settings.logsOutputStudio}</option>
                <option value="outputChannel">{t.settings.logsOutputChannel}</option>
                <option value="terminal">{t.settings.logsOutputTerminal}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.pollingIntervalLabel}
              </label>
              <input
                type="number"
                min={1000}
                max={30000}
                value={form.pollingInterval}
                onChange={(e) => updateField('pollingInterval', Number(e.target.value) || 2500)}
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.maxLogBufferLabel}
              </label>
              <input
                type="number"
                min={200}
                max={50000}
                value={form.logBufferSize}
                onChange={(e) => updateField('logBufferSize', Number(e.target.value) || 5000)}
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.pushDefaultRegistryLabel}
              </label>
              <input
                type="text"
                value={form.pushDefaultRegistry}
                onChange={(e) => updateField('pushDefaultRegistry', e.target.value)}
                placeholder={engine === 'podman' ? 'quay.io/my-org' : 'docker.io/my-user'}
                className="input-field font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-6 pt-1 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoDetectFiles}
                onChange={(e) => updateField('autoDetectFiles', e.target.checked)}
              />
              {t.settings.autoDetectComposeCheckbox}
            </label>
            <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={form.confirmDeletions}
                onChange={(e) => updateField('confirmDeletions', e.target.checked)}
              />
              {t.settings.confirmDeletionsCheckbox}
            </label>
            <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={form.enablePushCommand}
                onChange={(e) => updateField('enablePushCommand', e.target.checked)}
              />
              {t.settings.enablePushCheckbox}
            </label>
          </div>
        </div>

        {/* Section 3: Registry Auth (SecretStorage + docker/podman login) */}
        <div className="bg-panel-card border border-panel-border rounded-md p-5 shadow-card space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <KeyRound className={`w-4 h-4 ${accentIconClass}`} />
                <span>{t.settings.registrySectionTitle}</span>
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">{t.settings.registrySectionDesc}</p>
            </div>
            {form.hasRegistrySecret && (
              <span className="px-2.5 py-1 text-xs rounded-full bg-green-500/15 text-accent-green border border-accent-green flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {t.settings.secretSavedBadge}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.registryProviderLabel}
              </label>
              <select
                value={form.registryProvider}
                onChange={(e) =>
                  updateField(
                    'registryProvider',
                    e.target.value as StudioSettings['registryProvider']
                  )
                }
                className="input-field"
              >
                <option value="dockerhub">{t.settings.providerDockerHub}</option>
                <option value="quay">{t.settings.providerQuay}</option>
                <option value="ghcr">{t.settings.providerGhcr}</option>
                <option value="acr">{t.settings.providerAcr}</option>
                <option value="ecr">{t.settings.providerEcr}</option>
                <option value="custom">{t.settings.providerCustom}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.registryUrlLabel}
              </label>
              <input
                type="text"
                value={form.registryUrl}
                onChange={(e) => updateField('registryUrl', e.target.value)}
                placeholder="registry.company.local:5000"
                className="input-field font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.authTypeLabel}
              </label>
              <select
                value={form.registryAuthType}
                onChange={(e) =>
                  updateField(
                    'registryAuthType',
                    e.target.value as StudioSettings['registryAuthType']
                  )
                }
                className="input-field"
              >
                <option value="engineCli">
                  {fmt(t.settings.authEngineCli, { engine: engineLabel, cmd: engineCmd })}
                </option>
                <option value="basic">{t.settings.authBasic}</option>
                <option value="bearer">{t.settings.authBearer}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.registryUsernameLabel}
              </label>
              <input
                type="text"
                value={form.registryUsername}
                onChange={(e) => updateField('registryUsername', e.target.value)}
                placeholder="my-username"
                className="input-field font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t.settings.registryPasswordLabel}{' '}
                {form.hasRegistrySecret ? t.settings.keepCurrentSecretHint : ''}
              </label>
              <input
                type="password"
                value={registrySecret}
                onChange={(e) => setRegistrySecret(e.target.value)}
                placeholder="••••••••••••••••"
                className="input-field font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={form.registryAutoLogin}
                onChange={(e) => updateField('registryAutoLogin', e.target.checked)}
              />
              {fmt(t.settings.autoEngineLoginCheckbox, { cmd: engineCmd })}
            </label>

            <div className="flex items-center gap-2">
              <ActionPillButton
                label={t.settings.testConnectionBtn}
                loading={Boolean(operationsInProgress['registry-test'])}
                onClick={handleTestRegistry}
              />
              {form.hasRegistrySecret && (
                <ActionPillButton
                  label={t.settings.disconnectRegistryBtn}
                  variant="danger"
                  onClick={() => setShowDisconnectModal(true)}
                />
              )}
            </div>
          </div>

          {settingsTestResult && (
            <div
              className={`rounded-md p-3 text-xs border flex items-center gap-2 ${
                settingsTestResult.ok
                  ? 'border-accent-green bg-green-500/10 text-accent-green'
                  : 'border-accent-red bg-red-500/10 text-accent-red'
              }`}
            >
              {settingsTestResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              )}
              <span>{settingsTestResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* Disconnect Modal */}
      {showDisconnectModal && (
        <Modal
          title={t.settings.disconnectModalTitle}
          subtitle={fmt(t.settings.disconnectModalSubtitle, { cmd: engineCmd })}
          maxWidth="max-w-md"
          onClose={() => setShowDisconnectModal(false)}
          footer={
            <>
              <ActionPillButton
                label={t.common.cancel}
                onClick={() => setShowDisconnectModal(false)}
              />
              <ActionPillButton
                label={t.settings.disconnectBtn}
                variant="danger"
                onClick={() => {
                  postMessage('settings:disconnect', { ...form, engine });
                  setShowDisconnectModal(false);
                }}
              />
            </>
          }
        >
          <p className="text-xs text-text-secondary">
            {fmt(t.settings.disconnectModalConfirm, { engine: engineLabel })}
          </p>
        </Modal>
      )}
    </div>
  );
};
