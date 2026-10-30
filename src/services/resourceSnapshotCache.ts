export class ResourceSnapshotCache {
  private context = '';
  private readonly snapshots = new Map<string, unknown>();

  public setContext(context: string): void {
    if (this.context === context) return;
    this.context = context;
    this.snapshots.clear();
  }

  public set(context: string, command: string, value: unknown): void {
    this.setContext(context);
    this.snapshots.set(command, value);
  }

  public entries(context: string): Array<[string, unknown]> {
    this.setContext(context);
    return [...this.snapshots];
  }
}
