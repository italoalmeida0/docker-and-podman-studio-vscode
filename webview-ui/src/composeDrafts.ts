export interface ComposeDraft {
  base: string;
  text: string;
}

export interface ComposeServiceDraft {
  name: string;
  base: string;
  text: string;
  visual?: VisualServiceDraft;
}

export function syncComposeDraft(
  existing: ComposeDraft | undefined,
  current: string
): ComposeDraft {
  if (!existing || existing.text === existing.base || existing.text === current) {
    return { base: current, text: current };
  }
  return existing;
}
import type { VisualServiceDraft } from '../../src/shared/composeVisualEdit';
