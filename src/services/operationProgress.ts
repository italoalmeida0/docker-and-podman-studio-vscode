import {
  appendOutputTail,
  OperationEvent,
  OperationSnapshot,
} from '../shared/operationFeedback';
import type { SupportedLocale } from '../config';

interface ActiveOperation {
  id: string;
  key: string;
  label: string;
  labelLocale?: SupportedLocale;
  startedAt: number;
  output: string;
  outputTruncated: boolean;
  pendingOutput: string;
  lastOutputAt?: number;
  completed?: number;
  total?: number;
  current?: string;
  timer?: NodeJS.Timeout;
}

export class OperationProgress {
  private nextId = 0;
  private lastOutputId: string | undefined;
  private readonly active = new Map<string, ActiveOperation>();

  constructor(
    private readonly send: (command: string, payload: unknown) => void,
    private readonly writeOutput: (text: string) => void
  ) {}

  public start(key: string, label: string, labelLocale?: SupportedLocale): string {
    const id = String(++this.nextId);
    const operation: ActiveOperation = {
      id, key, label, labelLocale, startedAt: Date.now(), output: '', outputTruncated: false,
      pendingOutput: '',
    };
    this.active.set(id, operation);
    this.send('operation:start', this.snapshotOf(operation));
    return id;
  }

  public report(id: string, event: OperationEvent): void {
    const operation = this.active.get(id);
    if (!operation) return;
    if (event.type === 'step') {
      operation.completed = event.completed;
      operation.total = event.total;
      operation.current = event.current;
      this.send('operation:step', {
        id, completed: event.completed, total: event.total, current: event.current,
      });
      return;
    }

    const text = event.text
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    if (!text) return;
    if (this.lastOutputId !== id) {
      this.lastOutputId = id;
      this.writeOutput(`\n[${new Date().toISOString()}] #${id} ${operation.label}\n`);
    }
    this.writeOutput(text);
    const tail = appendOutputTail(operation.output, text);
    operation.output = tail.text;
    operation.outputTruncated ||= tail.truncated;
    operation.lastOutputAt = Date.now();
    operation.pendingOutput = appendOutputTail(operation.pendingOutput, text).text;
    if (!operation.timer) {
      operation.timer = setTimeout(() => this.flush(operation), 150);
    }
  }

  private flush(operation: ActiveOperation): void {
    if (operation.timer) clearTimeout(operation.timer);
    operation.timer = undefined;
    if (operation.pendingOutput) {
      this.send('operation:output', {
        id: operation.id,
        text: operation.pendingOutput,
        outputTruncated: operation.outputTruncated,
      });
      operation.pendingOutput = '';
    }
  }

  public end(id: string): void {
    const operation = this.active.get(id);
    if (!operation) return;
    this.flush(operation);
    this.active.delete(id);
    if (this.lastOutputId === id) this.lastOutputId = undefined;
    this.send('operation:end', { id, key: operation.key });
  }

  public snapshot(): OperationSnapshot[] {
    for (const operation of this.active.values()) this.flush(operation);
    return [...this.active.values()].map((operation) => this.snapshotOf(operation));
  }

  private snapshotOf(operation: ActiveOperation): OperationSnapshot {
    const now = Date.now();
    return {
      id: operation.id,
      key: operation.key,
      label: operation.label,
      labelLocale: operation.labelLocale,
      elapsedMs: now - operation.startedAt,
      output: operation.output,
      outputTruncated: operation.outputTruncated,
      ...(operation.lastOutputAt === undefined
        ? {}
        : { lastOutputElapsedMs: now - operation.lastOutputAt }),
      ...(operation.total === undefined
        ? {}
        : { completed: operation.completed, total: operation.total, current: operation.current }),
    };
  }
}
