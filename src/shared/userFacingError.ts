import { resolveBackendLocale } from '../i18n';
import type { FailureKind } from './operationFeedback';
import { formatUserMessage, UserMessage, UserMessageKey } from './userMessages';

export class UserFacingError extends Error {
  public readonly presentation: UserMessage;

  constructor(
    key: UserMessageKey,
    variables?: Record<string, string | number>,
    public readonly kind: FailureKind = 'invalidInput',
    public readonly technicalDetails?: string
  ) {
    const presentation = { key, variables };
    super(formatUserMessage(resolveBackendLocale(), presentation));
    this.name = 'UserFacingError';
    this.presentation = presentation;
  }
}

export function getErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error.stack || error.message;
  return error instanceof UserFacingError && error.technicalDetails
    ? `${details}\n\n${error.technicalDetails}` : details;
}
