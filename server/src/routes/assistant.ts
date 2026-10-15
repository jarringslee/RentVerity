import { Router, type ErrorRequestHandler } from 'express';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { completeConfiguredJson, type CompleteJson } from '../services/modelClient';
import { houseRepository, type HouseRepository } from '../houses/repository';
import { replyToAssistant, searchAssistantHouses } from '../assistant/service';

export function createAssistantRouter(options: { completeJson?: CompleteJson; repository?: HouseRepository } = {}) {
  const router = Router();
  const activeUsers = new Set<number>();
  router.use(requireAuth);
  router.post('/message', async (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    let started = false;
    try {
      if (activeUsers.has(userId)) throw new AppError(409, 'ASSISTANT_BUSY', '请等待当前回答完成，或先停止请求。');
      activeUsers.add(userId);
      started = true;
      res.on('close', cancel);
      const data = await replyToAssistant(req.body, options.completeJson ?? completeConfiguredJson, controller.signal);
      if (!controller.signal.aborted) res.json({ success: true, data });
    } catch (error) { if (!res.destroyed) next(error); }
    finally { if (started) activeUsers.delete(userId); res.off('close', cancel); }
  });
  // 此接口才访问数据库；/message 没有查询工具，模型无法替用户执行找房。
  router.post('/search', async (req, res, next) => {
    try { res.json({ success: true, data: await searchAssistantHouses(req.body, options.repository ?? houseRepository) }); }
    catch (error) { next(error); }
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const known = error instanceof AppError;
    res.status(known ? error.status : 500).json({ success: false, code: known ? error.code : 'ASSISTANT_ERROR', message: known ? error.message : '助手服务暂时不可用，请稍后重试。' });
  };
  router.use(handleError);
  return router;
}
export default createAssistantRouter();
