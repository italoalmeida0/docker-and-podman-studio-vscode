export class ScopedErrorTracker {
  private context = '';
  private readonly scopes = new Map<string, string>();

  public setContext(context: string): string[] {
    if (this.context === context) return [];
    this.context = context;
    const previous = [...new Set(this.scopes.values())];
    this.scopes.clear();
    return previous;
  }

  public record(kind: string, scope: string): string | undefined {
    const previous = this.scopes.get(kind);
    this.scopes.set(kind, scope);
    return previous === scope ? undefined : previous;
  }

  public resolve(kind: string): string | undefined {
    const scope = this.scopes.get(kind);
    this.scopes.delete(kind);
    return scope;
  }
}
