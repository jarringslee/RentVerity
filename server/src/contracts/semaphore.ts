export class Semaphore {
  private active = 0;
  private waiters = new Set<() => void>();
  constructor(private maximum: number) {}
  async acquire(signal: AbortSignal): Promise<() => void> {
    while (this.active >= this.maximum) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const wake = () => { this.waiters.delete(wake); signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => { this.waiters.delete(wake); reject(signal.reason); };
        this.waiters.add(wake); signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted(); this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; for (const wake of this.waiters) wake(); } };
  }
}
