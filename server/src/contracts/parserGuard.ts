import { Worker } from 'node:worker_threads';

// 主解析线程可能被PDF计算阻塞，独立守护线程只检查父进程与硬截止。
// 防父服务崩溃后解析子进程长期遗留；不是OS资源沙箱。
export function startParserGuard(ownerPid: number, timeoutMs: number) {
  const guard = new Worker(`
    const { workerData } = require('node:worker_threads');
    const stop = () => process.kill(process.pid, 'SIGKILL');
    const check = () => {
      if (Date.now() >= workerData.deadline) { stop(); return; }
      try { process.kill(workerData.ownerPid, 0); }
      catch (error) { if (error.code === 'ESRCH') stop(); }
    };
    check(); setInterval(check, 200);
  `, { eval: true, workerData: { ownerPid, deadline: Date.now() + timeoutMs } });
  guard.unref();
  // 若守护线程本身失效，解析也不能继续无限执行。
  guard.once('error', () => process.kill(process.pid, 'SIGKILL'));
  return () => guard.terminate();
}
