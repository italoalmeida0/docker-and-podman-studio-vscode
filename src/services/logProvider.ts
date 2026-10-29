import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { LogEntry } from '../types';
import { PodmanService } from './podmanService';

export class LogProvider implements vscode.Disposable {
  private readonly streams = new Map<string, ChildProcess>();
  private readonly history = new Map<string, LogEntry[]>();
  private readonly _onLogLine = new vscode.EventEmitter<LogEntry>();
  public readonly onLogLine = this._onLogLine.event;

  constructor(private readonly podman: PodmanService) {}

  public startComposeStreaming(composeFile: string, service: string): void {
    this.stopStreaming(service);
    const proc = this.podman.streamComposeLogs(composeFile, service, 150);
    this.attachStream(service, proc);
  }

  public startContainerStreaming(containerId: string): void {
    this.stopStreaming(containerId);
    const proc = this.podman.streamContainerLogs(containerId, 200);
    this.attachStream(containerId, proc);
  }

  private attachStream(key: string, proc: ChildProcess): void {
    this.streams.set(key, proc);
    const handleChunk = (raw: string) => {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('>>>> Executing external compose provider')) {
          continue;
        }
        const entry = this.parseLine(key, line);
        this.appendToHistory(key, entry);
        this._onLogLine.fire(entry);
      }
    };

    proc.stdout?.on('data', (d) => handleChunk(d.toString()));
    proc.stderr?.on('data', (d) => handleChunk(d.toString()));
    proc.on('close', () => {
      this.streams.delete(key);
    });
    proc.on('error', () => {
      this.streams.delete(key);
    });
  }

  public stopStreaming(key: string): void {
    const existing = this.streams.get(key);
    if (existing) {
      existing.kill('SIGTERM');
      this.streams.delete(key);
    }
  }

  public getHistory(key: string): LogEntry[] {
    return this.history.get(key) ?? [];
  }

  public clearHistory(key: string): void {
    this.history.delete(key);
  }

  public parseLine(service: string, rawLine: string): LogEntry {
    let msg = rawLine;
    let timestamp = new Date().toISOString();

    const tsMatch = rawLine.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.:+-]*Z?)\s+(.*)/);
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
  }
}
