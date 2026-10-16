import { Router, type ErrorRequestHandler, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { configuredAssistantModel, type AssistantModel } from '../services/chatModel';
import { houseRepository, type HouseRepository } from '../houses/repository';
import { parseAssistantRequest, runAssistant } from '../assistant/service';

async function writeEvent(res: Response, event: string, data: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (res.destroyed) throw new AppError(499, 'REQUEST_CANCELLED', '请求已取消。');
  if (res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return;
  // 等待背压释放，避免慢客户端无限缓冲；取消会同时解除等待。
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', drained); res.off('close', closed); signal.removeEventListener('abort', closed); };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new AppError(499, 'REQUEST_CANCELLED', '请求已取消。')); };
    res.once('drain', drained); res.once('close', closed); signal.addEventListener('abort', closed, { once: true });
    if (signal.aborted || res.destroyed) closed();
  });
}
export function createAssistantRouter(options: { model?: AssistantModel; repository?: HouseRepository; rateLimit?: number } = {}) {
  const router = Router(), activeUsers = new Set<number>(), windows = new Map<number, { since: number; count: number }>();
  router.use(requireAuth);
  router.post('/message', async (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    const controller = new AbortController(), deadline = AbortSignal.timeout(130000), signal = AbortSignal.any([controller.signal, deadline]);
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    let started = false, heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const request = parseAssistantRequest(req.body);
      if (activeUsers.has(userId)) throw new AppError(409, 'ASSISTANT_BUSY', '当前回答尚未结束，请先停止或稍后重试。');
      if (activeUsers.size >= 8) throw new AppError(429, 'ASSISTANT_CAPACITY', '助手服务繁忙，请稍后重试。');
      const now = Date.now();
      if (windows.size > 1000) for (const [id, window] of windows) if (now - window.since >= 60000) windows.delete(id);
      const window = windows.get(userId);
      if (window && now - window.since < 60000) {
        if (window.count >= (options.rateLimit ?? 12)) { res.setHeader('Retry-After', String(Math.ceil((60000 - now + window.since) / 1000))); throw new AppError(429, 'ASSISTANT_RATE_LIMIT', '请求过于频繁，请稍后再试。'); }
        window.count++;
      } else windows.set(userId, { since: now, count: 1 });
      activeUsers.add(userId); started = true; res.on('close', cancel);
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' }); res.flushHeaders();
      heartbeat = setInterval(() => {
        if (res.destroyed || signal.aborted || res.writableLength > 65536) { controller.abort(); return; }
        res.write(': heartbeat\n\n');
      }, 12000);
      await runAssistant(request, options.model ?? configuredAssistantModel, options.repository ?? houseRepository, ({ event, data }) => writeEvent(res, event, data, signal), signal);
      res.end();
    } catch (error) {
      if (!res.destroyed) {
        if (!res.headersSent) next(error);
        else {
          const known = error instanceof AppError;
          const data = deadline.aborted ? { code: 'ASSISTANT_TIMEOUT', message: '本轮处理超时，请手动重试。' } : { code: known ? error.code : 'ASSISTANT_ERROR', message: known ? error.message : '助手连接中断，请手动重试。' };
          res.end(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
        }
      }
    } finally { if (started) activeUsers.delete(userId); if (heartbeat) clearInterval(heartbeat); res.off('close', cancel); }
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const known = error instanceof AppError;
    res.status(known ? error.status : 500).json({ success: false, code: known ? error.code : 'ASSISTANT_ERROR', message: known ? error.message : '助手服务暂时不可用，请稍后重试。' });
  };
  router.use(handleError); return router;
}
export default createAssistantRouter();
