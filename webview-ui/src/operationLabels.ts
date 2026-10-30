import type { SupportedLocale } from './store';
import type { TranslationDict } from './i18n/en';

export interface OperationLabel {
  key: string;
  label: string;
  labelLocale?: SupportedLocale;
}

export function localizedOperationLabel(
  operation: OperationLabel, locale: SupportedLocale, t: TranslationDict
): string {
  if (operation.label && operation.labelLocale === locale) return operation.label;
  const { key } = operation;
  const action = key.includes('restart') ? t.common.restart :
    key.includes('unpause') ? t.common.resume :
    key.includes('pause') ? t.common.pause :
    key.includes('stop') ? t.common.stop :
    key.includes('build') ? t.common.buildingOp.replace(/(?:\.{3}|…)$/, '') :
    key.includes('start') || key.includes('up') ? t.common.start :
    key.includes('down') || key.includes('remove') ? t.common.remove :
    key.includes('create') ? t.common.create :
    key.includes('push') ? t.common.push :
    key.includes('search') ? t.common.search :
    key.includes('save') ? t.common.save :
    key.includes('logs') ? t.common.logs :
    key.includes('list') || key.includes('refresh') ? t.common.refresh :
    t.common.working;
  const resource = key.includes('compose') || ['start', 'stop', 'restart', 'down', 'build', 'rebuild', 'build-up', 'scale', 'scale-check'].includes(key)
    ? t.sidebar.compose :
    key.includes('container') ? t.sidebar.containers :
    key.includes('pod') ? t.sidebar.pods :
    key.includes('image') || key === 'pulling' ? t.sidebar.images :
    key.includes('volume') ? t.sidebar.volumes :
    key.includes('network') ? t.sidebar.networks :
    key.includes('registry') || key.includes('settings') ? t.sidebar.settings :
    key === 'refresh-all' ? 'Studio' : '';
  if (key === 'pulling') return t.images.pullBtn;
  if (key === 'registry-test') return t.settings.testConnectionBtn;
  if (key === 'registry-disconnect') return t.settings.disconnectRegistryBtn;
  if (key === 'settings-reset') return t.settings.resetPathsBtn;
  if (key === 'settings-save') return t.settings.saveSettingsBtn;
  return resource ? `${action} · ${resource}` : action;
}
