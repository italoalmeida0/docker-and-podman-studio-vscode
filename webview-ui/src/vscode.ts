import { useCallback, useEffect } from 'react';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cachedApi: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (!cachedApi) {
    try {
      cachedApi = acquireVsCodeApi();
    } catch {
      cachedApi = {
        postMessage: (msg) => console.log('[Podman Studio Dev postMessage]', msg),
        getState: () => ({}),
        setState: () => {},
      };
    }
  }
  return cachedApi;
}

export interface StudioMessage<T = any> {
  command: string;
  payload?: T;
  requestId?: string;
  engine?: 'docker' | 'podman';
}

export function createEngineMessageGate() {
  const pending = new Map<string, StudioMessage>();
  return {
    shouldHandle(message: StudioMessage, engine: 'docker' | 'podman', settingsLoaded: boolean): boolean {
      if (!message.engine) return true;
      if (!settingsLoaded) {
        pending.set(`${message.engine}\0${message.command}`, message);
        return false;
      }
      return message.engine === engine;
    },
    drain(engine: 'docker' | 'podman'): StudioMessage[] {
      const messages = [...pending.values()].filter((message) => message.engine === engine);
      pending.clear();
      return messages;
    },
  };
}

export function postStudioMessage(command: string, payload?: any, requestId?: string): void {
  getVsCodeApi().postMessage({ command, payload, requestId });
}

export function useVsCodeMessaging() {
  const postMessage = useCallback((command: string, payload?: any, requestId?: string) => {
    postStudioMessage(command, payload, requestId);
  }, []);

  const onMessage = useCallback((handler: (msg: StudioMessage) => void) => {
    const listener = (event: MessageEvent<StudioMessage>) => {
      if (event.data && typeof event.data === 'object' && 'command' in event.data) {
        handler(event.data);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  return { postMessage, onMessage };
}

export function useAutoMountRequest(command: string, payload?: any) {
  useEffect(() => {
    postStudioMessage(command, payload);
  }, [command]);
}
