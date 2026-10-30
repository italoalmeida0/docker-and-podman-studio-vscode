import { useEffect, useRef, useState } from 'react';
import { useVsCodeMessaging } from './vscode';

export function useActionRequest(command: string, onSuccess: () => void) {
  const { postMessage, onMessage } = useVsCodeMessaging();
  const [pending, setPending] = useState(false);
  const pendingId = useRef<string>();
  const success = useRef(onSuccess);
  success.current = onSuccess;

  useEffect(() => onMessage((message) => {
    if (message.command !== 'action:result' || message.requestId !== pendingId.current) return;
    pendingId.current = undefined;
    setPending(false);
    if (message.payload?.success === true) success.current();
  }), [onMessage]);

  return {
    pending,
    run(payload: unknown): void {
      if (pendingId.current) return;
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingId.current = requestId;
      setPending(true);
      postMessage(command, payload, requestId);
    },
  };
}
