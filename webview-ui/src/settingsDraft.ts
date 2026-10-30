import type { StudioSettings } from './store';

type SettingsKey = keyof StudioSettings;

function copyField<K extends SettingsKey>(target: StudioSettings, source: StudioSettings, key: K): void {
  target[key] = source[key];
}

export function reconcileSettingsDraft(
  saved: StudioSettings,
  draft: StudioSettings,
  dirty: ReadonlySet<SettingsKey>
): { form: StudioSettings; dirty: Set<SettingsKey> } {
  const form = { ...saved };
  const remaining = new Set<SettingsKey>();
  for (const key of dirty) {
    if (!Object.is(saved[key], draft[key])) {
      copyField(form, draft, key);
      remaining.add(key);
    }
  }
  return { form, dirty: remaining };
}
