import { ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { bt } from '../i18n';
import { LogEntry } from '../types';
import { PodmanService } from './podmanService';

interface LogStream {
  processes: Set<ChildProcess>;
}

function logIdentity(entry: LogEntry): string {
  return JSON.stringify([entry.service, entry.timestamp, entry.message]);
}

export class LogProvider implements vscode.Disposable {
  private readonly streams = new Map<string, LogStream>();
  private readonly history = new Map<string, LogEntry[]>();
  private readonly _onLogLine = new vscode.EventEmitter<LogEntry>();
  private readonly _onError = new vscode.EventEmitter<string>();
  public readonly onLogLine = this._onLogLine.event;
  public readonly onError = this._onError.event;

  constructor(private readonly podman: PodmanService) {}

  public async startComposeStreaming(
    composeFile: string,
    service: string,
    options?: { key?: string; containerId?: string; tail?: number }
  ): Promise<void> {
    const key = options?.key || service;
    this.stopStreaming(key);
    const stream: LogStream = { processes: new Set() };
    this.streams.set(key, stream);
    try {
      const replayable = options?.tail === undefined
        ? this.getHistory(key).filter((entry) =>
          entry.sourceTimestamp && Number.isFinite(Date.parse(entry.timestamp)))
        : [];
      const earliest = replayable.reduce<number | undefined>((minimum, entry) => {
        const time = Date.parse(entry.timestamp);
        return minimum === undefined || time < minimum ? time : minimum;
      }, undefined);
      const since = earliest === undefined ? undefined : new Date(earliest).toISOString();
      const replayCounts = new Map<string, number>();
      for (const entry of replayable) {
        const identity = logIdentity(entry);
        replayCounts.set(identity, (replayCounts.get(identity) || 0) + 1);
      }
      const sources = await this.podman.streamComposeLogs(
        composeFile, service, options?.tail ?? (this.getHistory(key).length ? 0 : 150),
        undefined, options?.containerId, since
      );
      if (this.streams.get(key) !== stream) {
        sources.forEach((source) => source.process.kill('SIGTERM'));
        return;
      }
      sources.forEach((source) => stream.processes.add(source.process));
      sources.forEach((source) =>
        this.attachStream(key, stream, source.process, source.containerName, service, options?.key, replayCounts)
      );
    } catch (error) {
      if (this.streams.get(key) === stream) {
        this.streams.delete(key);
        throw error;
      }
    }
  }

  public startContainerStreaming(containerId: string): void {
    this.stopStreaming(containerId);
    const stream: LogStream = { processes: new Set() };
    this.streams.set(containerId, stream);
    try {
      const proc = this.podman.streamContainerLogs(containerId, 200);
      this.attachStream(containerId, stream, proc);
    } catch (error) {
      this.streams.delete(containerId);
      throw error;
    }
  }

  private attachStream(
    key: string,
    stream: LogStream,
    proc: ChildProcess,
    containerName?: string,
    displayService = key,
    target?: string,
    replayCounts?: Map<string, number>
  ): void {
    stream.processes.add(proc);
    const isCurrent = () => this.streams.get(key) === stream && stream.processes.has(proc);
    const stdout = { decoder: new StringDecoder('utf8'), pending: '' };
    const stderr = { decoder: new StringDecoder('utf8'), pending: '' };
    let stderrTail = '';
    const emitLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('>>>> Executing external compose provider')) {
        return;
      }
      const entry = this.parseLine(displayService, line);
      if (target) entry.target = target;
      if (containerName) entry.message = `[${containerName}] ${entry.message}`;
      if (entry.sourceTimestamp && replayCounts) {
        const identity = logIdentity(entry);
        const remaining = replayCounts.get(identity) || 0;
        if (remaining > 0) {
          if (remaining === 1) replayCounts.delete(identity);
          else replayCounts.set(identity, remaining - 1);
          return;
        }
      }
      this.appendToHistory(key, entry);
      this._onLogLine.fire(entry);
    };
    const handleChunk = (
      state: typeof stdout,
      chunk: Buffer | string,
      isStderr: boolean
    ) => {
      if (!isCurrent()) {
        return;
      }
      const text = typeof chunk === 'string' ? chunk : state.decoder.write(chunk);
      if (isStderr) {
        stderrTail = (stderrTail + text).slice(-2000);
      }
      const lines = (state.pending + text).split(/\r?\n/);
      state.pending = lines.pop() || '';
      lines.forEach(emitLine);
    };
    const flush = (state: typeof stdout) => {
      const remaining = state.pending + state.decoder.end();
      if (remaining) {
        emitLine(remaining.replace(/\r$/, ''));
      }
    };

    proc.stdout?.on('data', (data: Buffer | string) => handleChunk(stdout, data, false));
    proc.stderr?.on('data', (data: Buffer | string) => handleChunk(stderr, data, true));
    proc.on('close', (code, signal) => {
      if (!isCurrent()) {
        return;
      }
      flush(stdout);
      flush(stderr);
      stream.processes.delete(proc);
      if (stream.processes.size === 0) this.streams.delete(key);
      if (code !== 0) {
        const detail = stderrTail.trim() || (signal ? `signal ${signal}` : `exit code ${code}`);
        this._onError.fire(bt('logStreamError', { name: displayService, error: detail }));
      }
    });
    proc.on('error', (error) => {
      if (isCurrent()) {
        stream.processes.delete(proc);
        if (stream.processes.size === 0) this.streams.delete(key);
        this._onError.fire(bt('logStreamError', { name: displayService, error: error.message }));
      }
    });
  }

  public stopStreaming(key: string): void {
    const existing = this.streams.get(key);
    if (existing) {
      this.streams.delete(key);
      existing.processes.forEach((proc) => proc.kill('SIGTERM'));
      existing.processes.clear();
    }
  }

  public getHistory(key: string): LogEntry[] {
    return this.history.get(key) ?? [];
  }

  public clearHistory(key: string): void {
    this.history.delete(key);
  }

  public parseLine(service: string, rawLine: string): LogEntry {
    const line = rawLine.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const prefixMatch = line.match(/^\S+\s*\|\s*(.*)/);
    let msg = prefixMatch ? prefixMatch[1] : line;
    let timestamp = new Date().toISOString();

    const tsMatch = msg.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)/);
    if (tsMatch) {
      timestamp = tsMatch[1];
      msg = tsMatch[2];
    }
    const remainingPrefix = msg.match(/^\S+\s*\|\s*(.*)/);
    if (remainingPrefix) msg = remainingPrefix[1];

    return {
      service,
      timestamp,
      message: msg,
      level: this.detectLevel(msg),
      ...(tsMatch ? { sourceTimestamp: true } : {}),
    };
  }

  public detectLevel(text: string): LogEntry['level'] {
    const upper = text.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FATAL') || upper.includes('PANIC') || upper.includes('EXCEPTION')) {
      return 'error';
    }
    if (upper.includes('WARN')) {
      return 'warn';
    }
    if (upper.includes('DEBUG') || upper.includes('TRACE')) {
      return 'debug';
    }
    return 'info';
  }

  private appendToHistory(key: string, entry: LogEntry): void {
    const maxLen = getConfig().logBufferSize || 5000;
    let arr = this.history.get(key);
    if (!arr) {
      arr = [];
      this.history.set(key, arr);
    }
    arr.push(entry);
    if (arr.length > maxLen) {
      arr.splice(0, arr.length - maxLen);
    }
  }

  public dispose(): void {
    for (const [k] of this.streams) {
      this.stopStreaming(k);
    }
    this._onLogLine.dispose();
    this._onError.dispose();
  }
}
