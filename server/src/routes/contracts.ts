import { Router, type ErrorRequestHandler } from 'express';
import { requireAuth } from '../middleware/auth';
import type { SessionClaims } from '../auth/session';
import { AppError } from '../utils/AppError';
import { ContractTaskManager, type ContractTask } from '../contracts/tasks';
import { receivePdf } from '../contracts/receivePdf';

let defaultManager: ContractTaskManager | undefined;
export function getContractTaskManager() { return defaultManager ??= new ContractTaskManager(); }
export function createContractsRouter(options: { manager?: ContractTaskManager } = {}) {
  const router = Router();
  const manager = () => options.manager ?? getContractTaskManager();
  router.use(requireAuth);
  router.get('/limits', (_req, res) => {
    const { maxBytes, maxPages, maxCharacters, maxChunks, uploadTimeoutMs, taskTimeoutMs, ttlMs } = manager().limits;
    res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { maxBytes, maxPages, maxCharacters, maxChunks, uploadTimeoutMs, taskTimeoutMs, ttlMs, maxFindings: 20 } });
  });
  router.post('/tasks', async (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    const claims = (req as unknown as { session: SessionClaims }).session;
    const owner = manager(); let task: ContractTask | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let disconnected = false;
    const close = () => { if (!res.writableEnded) { disconnected = true; task?.controller.abort(new AppError(499, 'REQUEST_CANCELLED', '连接已关闭。')); } };
    res.once('close', close);
    try {
      const id = req.headers['x-contract-task-id'], size = Number(req.headers['x-contract-file-size']);
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new AppError(400, 'TASK_ID_REQUIRED', '缺少有效任务标识。');
      if (!Number.isSafeInteger(size) || size < 1 || size > owner.limits.maxBytes) throw new AppError(413, 'FILE_SIZE', '文件大小超出当前上限。');
      if (!req.is('multipart/form-data')) throw new AppError(400, 'FILE_REQUIRED', '请使用multipart上传一份PDF。');
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > size + 65536) throw new AppError(413, 'FILE_SIZE', '请求大小超出预留空间。');
      task = await owner.create(userId, req.ip ?? req.socket.remoteAddress ?? 'unknown', id, size, claims.exp * 1000);
      if (disconnected || req.aborted) throw new AppError(400, 'UPLOAD_INCOMPLETE', '上传连接已关闭。');
      const current = task;
      timer = setTimeout(() => current.controller.abort(new AppError(408, 'UPLOAD_TIMEOUT', '上传超时，已停止接收。')), owner.limits.uploadTimeoutMs); timer.unref();
      const filename = await receivePdf(req, task.files.incoming, task.files.pdf, size, task.controller.signal, bytes => { current.receivedBytes = bytes; });
      task.controller.signal.throwIfAborted(); clearTimeout(timer);
      owner.accept(task, filename);
      res.status(202).setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: owner.snapshot(task) });
    } catch (error) {
      const cause = task?.controller.signal.aborted && task.controller.signal.reason instanceof AppError ? task.controller.signal.reason : error;
      if (task) await owner.rejectUpload(task, cause);
      if (!res.destroyed) { res.setHeader('Connection', 'close'); res.once('finish', () => { if (!req.complete) req.destroy(); }); next(cause); }
    } finally { clearTimeout(timer); res.off('close', close); }
  });
  router.get('/tasks/:id', (req, res, next) => {
    try { const owner = manager(); const task = owner.get(String(req.params.id), (req as unknown as { userId: number }).userId); res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: owner.snapshot(task) }); } catch (error) { next(error); }
  });
  router.post('/tasks/:id/retry', async (req, res, next) => {
    try { const owner = manager(); const task = await owner.retry(String(req.params.id), (req as unknown as { userId: number }).userId, req.ip ?? 'unknown'); res.status(202).json({ success: true, data: owner.snapshot(task) }); } catch (error) { next(error); }
  });
  router.delete('/tasks/:id', async (req, res, next) => {
    try { await manager().remove(String(req.params.id), (req as unknown as { userId: number }).userId); res.json({ success: true }); } catch (error) { next(error); }
  });
  router.post(['/parse', '/analyze'], (_req, res) => res.status(410).json({ success: false, code: 'CONTRACT_API_CHANGED', message: '合同接口已升级，请刷新页面后使用任务上传。' }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const known = error instanceof AppError;
    if (known && error.status === 429) res.setHeader('Retry-After', error.code === 'UPLOAD_RATE_LIMIT' ? '60' : '2');
    res.status(known ? error.status : 500).json({ success: false, code: known ? error.code : 'CONTRACT_ERROR', message: known ? error.message : '合同处理失败，请重试。' });
  };
  router.use(errorHandler); return router;
}
export default createContractsRouter();
