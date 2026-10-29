import { useCallback, useMemo } from 'react';
import {
  ContainerEngine,
  LanguageSetting,
  SupportedLocale,
  useStudioStore,
} from '../store';
import { postStudioMessage } from '../vscode';
import { de } from './de';
import { en, TranslationDict } from './en';
import { es } from './es';
import { fr } from './fr';
import { hi } from './hi';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { nl } from './nl';
import { pl } from './pl';
import { ptBR } from './ptBR';
import { ru } from './ru';
import { tr } from './tr';
import { uk } from './uk';
import { zhCN } from './zhCN';
import { zhTW } from './zhTW';

export const DICTIONARIES: Record<SupportedLocale, TranslationDict> = {
  en,
  'pt-BR': ptBR,
  es,
  fr,
  de,
  it,
  ru,
  uk,
  pl,
  tr,
  nl,
  ja,
  ko,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  hi,
};

export interface LanguageOption {
  value: LanguageSetting;
  label: string;
  shortLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: 'Auto (VS Code)', shortLabel: 'AUTO' },
  { value: 'en', label: 'English', shortLabel: 'EN' },
  { value: 'pt-BR', label: 'Português (Brasil)', shortLabel: 'PT-BR' },
  { value: 'es', label: 'Español', shortLabel: 'ES' },
  { value: 'fr', label: 'Français', shortLabel: 'FR' },
  { value: 'de', label: 'Deutsch', shortLabel: 'DE' },
  { value: 'it', label: 'Italiano', shortLabel: 'IT' },
  { value: 'ru', label: 'Русский (Russian)', shortLabel: 'RU' },
  { value: 'uk', label: 'Українська (Ukrainian)', shortLabel: 'UK' },
  { value: 'pl', label: 'Polski (Polish)', shortLabel: 'PL' },
  { value: 'tr', label: 'Türkçe (Turkish)', shortLabel: 'TR' },
  { value: 'nl', label: 'Nederlands (Dutch)', shortLabel: 'NL' },
  { value: 'ja', label: '日本語 (Japanese)', shortLabel: 'JA' },
  { value: 'ko', label: '한국어 (Korean)', shortLabel: 'KO' },
  { value: 'zh-CN', label: '简体中文 (Simplified Chinese)', shortLabel: 'ZH-CN' },
  { value: 'zh-TW', label: '繁體中文 (Traditional Chinese)', shortLabel: 'ZH-TW' },
  { value: 'hi', label: 'हिन्दी (Hindi)', shortLabel: 'HI' },
];

export function fmt(
  template: string,
  vars?: Record<string, string | number | undefined>
): string {
  if (!vars) {
    return template;
  }
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return out;
}

export function useI18n() {
  const {
    engine,
    setEnginePreference,
    resolvedLocale,
    languageSetting,
    setLanguagePreference,
  } = useStudioStore();

  const t = useMemo<TranslationDict>(
    () => DICTIONARIES[resolvedLocale] || en,
    [resolvedLocale]
  );

  const changeLanguage = useCallback(
    (next: LanguageSetting) => {
      setLanguagePreference(next);
      postStudioMessage('settings:setLanguage', { language: next });
    },
    [setLanguagePreference]
  );

  const changeEngine = useCallback(
    (next: ContainerEngine) => {
      setEnginePreference(next);
      postStudioMessage('settings:setEngine', { engine: next });
    },
    [setEnginePreference]
  );

  const engineLabel = engine === 'podman' ? 'Podman' : 'Docker';
  const engineCmd = engine === 'podman' ? 'podman' : 'docker';

  return {
    t,
    fmt,
    locale: resolvedLocale,
    languageSetting,
    changeLanguage,
    engine,
    engineLabel,
    engineCmd,
    changeEngine,
  };
}
