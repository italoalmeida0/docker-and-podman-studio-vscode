import type { SupportedLocale } from '../config';

export type OperationEvent =
  | { type: 'output'; text: string }
  | { type: 'step'; completed: number; total: number; current?: string };

export interface OperationSnapshot {
  id: string;
  key: string;
  label: string;
  labelLocale?: SupportedLocale;
  elapsedMs: number;
  output: string;
  outputTruncated: boolean;
  completed?: number;
  total?: number;
  current?: string;
  lastOutputElapsedMs?: number;
}

export const MAX_OPERATION_OUTPUT = 64_000;

export function appendOutputTail(
  previous: string,
  chunk: string,
  limit = MAX_OPERATION_OUTPUT
): { text: string; truncated: boolean } {
  const text = previous + chunk;
  return text.length > limit
    ? { text: text.slice(-limit), truncated: true }
    : { text, truncated: false };
}

export type FailureKind =
  | 'timeout'
  | 'missingExecutable'
  | 'missingFile'
  | 'diskSpace'
  | 'portInUse'
  | 'registryAuth'
  | 'permission'
  | 'imageNotFound'
  | 'engineConnection'
  | 'network'
  | 'unsavedChanges'
  | 'staleResource'
  | 'resourceInUse'
  | 'invalidInput'
  | 'generic';

export function classifyFailure(message: string, errorCode?: string): FailureKind {
  const text = message.toLowerCase();
  if (errorCode === 'ETIMEDOUT' || /\bETIMEDOUT\b|execution timed out \(\d+s\)/i.test(message)) {
    return 'timeout';
  }
  if (/\bspawn\s+\S+.*\bENOENT\b|executable file not found|command not found|no such file or directory.*(?:executable|command)/i.test(message)) {
    return 'missingExecutable';
  }
  if (errorCode === 'ENOENT' || /\bENOENT\b.*\bno such file or directory\b/i.test(message)) {
    return 'missingFile';
  }
  if (/no space left on device|disk (?:is )?full|not enough (?:disk )?space/i.test(text)) {
    return 'diskSpace';
  }
  if (/address already in use|port (?:is )?already (?:allocated|in use)|bind:.*already in use/i.test(text)) {
    return 'portInUse';
  }
  if (/unauthorized|authentication required|authentication failed|registry http (?:401|403)|access to the requested resource is denied|denied: requested access/i.test(text)) {
    return 'registryAuth';
  }
  if (/permission denied|access is denied|operation not permitted/i.test(text)) {
    return 'permission';
  }
  if (/manifest unknown|manifest not found|image not known|image not found|repository does not exist/i.test(text)) {
    return 'imageNotFound';
  }
  if (/cannot connect to (?:the )?(?:docker|podman)|unable to connect to podman|is the (?:docker|podman) daemon running|connection refused.*(?:podman|docker)|podman machine.*(?:not running|stopped)/i.test(text)) {
    return 'engineConnection';
  }
  if (/^(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EPIPE)$/i.test(errorCode || '') ||
      /\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN)\b|network is unreachable|no such host|temporary failure in name resolution|dns lookup|connection timed out|registry request timed out|socket hang up|network socket disconnected/i.test(text)) {
    return 'network';
  }
  if (/unsaved (?:vs code |editor )?changes|save or discard unsaved/i.test(text)) {
    return 'unsavedChanges';
  }
  if (/(?:project|file|settings|resource|engine|selection|replicas?).*(?:changed|no longer exists)|(?:changed|no longer exists).*(?:project|file|settings|resource|engine|selection|replicas?)/i.test(text)) {
    return 'staleResource';
  }
  if (/\bin use\b|referenced by|has dependent containers|stop .* before (?:modifying|removing)/i.test(text)) {
    return 'resourceInUse';
  }
  if (/^(?:invalid (?:compose (?:project options|selection|service)|resource (?:type|selection)|podman batch operation)|(?:an? )?(?:image|name|service|file|path|value|username|url)\b.*\brequired\b|(?:provide|select|enter) \b|(?:compose (?:file|stop_grace_period|scaling)|the (?:long operation timeout|active compose file)|profile names)\b.*\bmust (?:be|have|contain|use)\b)/i.test(text)) {
    return 'invalidInput';
  }
  return 'generic';
}
