export class ResourceLoadErrors {
  private context = '';
  private readonly failures = new Map<string, string>();

  public setContext(context: string): boolean {
    if (this.context === context) return false;
    this.context = context;
    const changed = this.failures.size > 0;
    this.failures.clear();
    return changed;
  }

  public fail(resource: string, error: unknown): boolean {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    if (this.failures.get(resource) === details) return false;
    this.failures.set(resource, details);
    return true;
  }

  public resolve(resource: string): boolean {
    return this.failures.delete(resource);
  }

  public details(): string {
    return [...this.failures].map(([resource, error]) => `${resource}: ${error}`).join('\n\n');
  }
}
