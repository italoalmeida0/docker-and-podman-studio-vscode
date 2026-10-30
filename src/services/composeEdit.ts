import * as fs from 'fs';
import * as path from 'path';
import type { ComposeContainerStatus, PodmanContainer } from '../types';

export function assertComposeEditBase(options: {
  activeFile: string | undefined;
  requestedFile: unknown;
  expectedContent: unknown;
  currentContent: string;
  dirtyEditor: boolean;
}): void {
  if (!options.activeFile || options.requestedFile !== options.activeFile ||
      typeof options.expectedContent !== 'string') {
    throw new Error('The active Compose file changed. Refresh and retry the edit.');
  }
  if (options.dirtyEditor) {
    throw new Error('The Compose file has unsaved changes in a VS Code editor. Save or discard them before editing in Studio.');
  }
  if (options.expectedContent !== options.currentContent) {
    throw new Error('The Compose file changed since editing began. Review the current file before saving.');
  }
}

function comparablePath(file: string): string {
  let resolved = path.resolve(file);
  try {
    resolved = fs.realpathSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function composeEditStatuses(
  files: string[],
  providerStatuses: ComposeContainerStatus[],
  containers: PodmanContainer[]
): Array<Pick<ComposeContainerStatus, 'service' | 'status'>> {
  const projectFiles = new Set(files.map(comparablePath));
  const additional = containers.filter((container) => {
    if (container.isInfra) return false;
    const knownFiles = container.composeFiles?.length
      ? container.composeFiles : container.composeFile ? [container.composeFile] : [];
    if (knownFiles.some((file) => path.isAbsolute(file) && projectFiles.has(comparablePath(file)))) {
      return true;
    }
    return Boolean(container.composeProject || container.composeService) &&
      (knownFiles.length === 0 || knownFiles.some((file) => !path.isAbsolute(file)));
  });
  return [
    ...providerStatuses,
    ...additional.map((container) => ({
      service: container.composeService,
      status: container.state,
    })),
  ];
}
