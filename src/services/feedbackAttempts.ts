import type { ContainerEngine } from '../config';

export interface FeedbackAttempt {
  scope: string;
  engine: ContainerEngine;
  context: string;
  engineIndependent: boolean;
}

export class FeedbackAttemptTracker {
  private readonly latest = new Map<string, FeedbackAttempt>();

  public start(
    scope: string,
    engine: ContainerEngine,
    context: string,
    engineIndependent = false
  ): FeedbackAttempt {
    const attempt = { scope, engine, context, engineIndependent };
    this.latest.set(scope, attempt);
    return attempt;
  }

  public isCurrent(attempt: FeedbackAttempt, context: string): boolean {
    return this.latest.get(attempt.scope) === attempt &&
      (attempt.engineIndependent || attempt.context === context);
  }

  public finish(attempt: FeedbackAttempt): void {
    if (this.latest.get(attempt.scope) === attempt) {
      this.latest.delete(attempt.scope);
    }
  }

  public invalidate(scope: string): void {
    this.latest.delete(scope);
  }
}
