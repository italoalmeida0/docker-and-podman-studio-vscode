export interface BatchRecovery {
  group: string;
  succeeded: string[];
  pending: string[];
}

export class BatchErrorTracker {
  private readonly failures = new Map<string, { group: string; pending: Set<string> }>();

  public record(scope: string, recovery: BatchRecovery): void {
    if (recovery.pending.length === 0) {
      this.failures.delete(scope);
      return;
    }
    this.failures.set(scope, { group: recovery.group, pending: new Set(recovery.pending) });
  }

  public resolve(recovery: BatchRecovery): string[] {
    const resolved: string[] = [];
    for (const [scope, failure] of this.failures) {
      if (failure.group !== recovery.group) continue;
      for (const target of recovery.succeeded) failure.pending.delete(target);
      if (failure.pending.size === 0) {
        this.failures.delete(scope);
        resolved.push(scope);
      }
    }
    return resolved;
  }
}
