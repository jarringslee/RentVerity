// WebSocket 的帧有序，不代表 async message 回调中的数据库操作自动有序。
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(private limit = 32, private onError: (error: unknown) => void = () => {}) {}

  enqueue(task: () => Promise<void>): boolean {
    if (this.pending >= this.limit) return false;
    this.pending++;
    this.tail = this.tail.then(task).catch(error => {
      try { this.onError(error); } catch { /* 错误记录失败也不能阻塞后续任务。 */ }
    }).finally(() => { this.pending--; });
    return true;
  }
}
