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

export class LogProvider implements vscode.Disposable {
  private readonly streams = new Map<string, LogStream>();
  private readonly history = new Map<string, LogEntry[]>();
  private readonly _onLogLine = new vscode.EventEmitter<LogEntry>();
  private readonly _onError = new vscode.EventEmitter<string>();
  public readonly onLogLine = this._onLogLine.event;
  public readonly onError = this._onError.event;

  constructor(private readonly podman: PodmanService) {}

  public async startComposeStreaming(composeFile: string, service: string): Promise<void> {
    this.stopStreaming(service);
    const stream: LogStream = { processes: new Set() };
    this.streams.set(service, stream);
    try {
      const sources = await this.podman.streamComposeLogs(composeFile, service, 150);
      if (this.streams.get(service) !== stream) {
        sources.forEach((source) => source.process.kill('SIGTERM'));
        return;
      }
      sources.forEach((source) => stream.processes.add(source.process));
      sources.forEach((source) =>
        this.attachStream(service, stream, source.process, source.containerName)
      );
    } catch (error) {
      if (this.streams.get(service) === stream) {
        this.streams.delete(service);
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

  private attachStream(key: string, stream: LogStream, proc: ChildProcess, containerName?: string): void {
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
      const entry = this.parseLine(key, line);
      if (containerName) entry.message = `[${containerName}] ${entry.message}`;
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
        this._onError.fire(bt('logStreamError', { name: key, error: detail }));
      }
    });
    proc.on('error', (error) => {
      if (isCurrent()) {
        stream.processes.delete(proc);
        if (stream.processes.size === 0) this.streams.delete(key);
        this._onError.fire(bt('logStreamError', { name: key, error: error.message }));
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
    let msg = line;
    let timestamp = new Date().toISOString();

    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.:+-]*Z?)\s+(.*)/);
    if (tsMatch) {
      timestamp = tsMatch[1];
      msg = tsMatch[2];
    }
    const prefixMatch = msg.match(/^\S+\s*\|\s*(.*)/);
    if (prefixMatch) {
      msg = prefixMatch[1];
    }

    return {
      service,
      timestamp,
      message: msg,
      level: this.detectLevel(msg),
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
