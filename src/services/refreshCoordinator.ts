import { OperationProgress } from './operationProgress';
import type { SupportedLocale } from '../config';

export class RefreshCoordinator {
  private active?: { key: string; id: string; promise: Promise<void> };

  constructor(private readonly progress: Pick<OperationProgress, 'start' | 'end'>) {}

  public run(
    key: string, label: string, task: () => Promise<void>, reuse: boolean, labelLocale?: SupportedLocale
  ): Promise<void> {
    if (reuse && this.active?.key === key) {
      return this.active.promise;
    }
    if (this.active) {
      this.progress.end(this.active.id);
    }
    const id = this.progress.start('refresh-all', label, labelLocale);
    const promise = Promise.resolve().then(task).finally(() => {
      this.progress.end(id);
      if (this.active?.id === id) this.active = undefined;
    });
    this.active = { key, id, promise };
    return promise;
  }
}
