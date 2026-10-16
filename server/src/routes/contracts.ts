import { Router, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { completeConfiguredJson, type CompleteJson } from '../services/modelClient';
import { analyzeContract } from '../contracts/analysis';
import { ContractSessionStore } from '../contracts/sessionStore';
import { PDF_LIMITS, parseContractPdf, validatePdfFile, validatePdfMetadata } from '../contracts/pdf';
import { ContractUploadGate, UPLOAD_LIMITS } from '../contracts/uploadGate';

// 只保存短期页文本和结果，不把原合同写进 uploads 或磁盘。
export function createContractsRouter(options: { completeJson?: CompleteJson; store?: ContractSessionStore; uploadGate?: ContractUploadGate; parsePdf?: typeof parseContractPdf; uploadTimeoutMs?: number } = {}) {
  const router = Router();
  const store = options.store ?? new ContractSessionStore();
  const completeJson = options.completeJson ?? completeConfiguredJson;
  const gate = options.uploadGate ?? new ContractUploadGate();
  const parsePdf = options.parsePdf ?? parseContractPdf;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PDF_LIMITS.maxBytes, files: 1, fields: 0, parts: 2, headerPairs: 30, fieldNameSize: 100 },
    fileFilter: (_req, file, callback) => {
      try { validatePdfMetadata(file); callback(null, true); }
      catch (error) { callback(error as Error); }
    }
  }).single('file');
  router.use(requireAuth);

  router.post('/parse', (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    let release: () => void;
    try {
      release = gate.acquire(userId, req.ip ?? req.socket.remoteAddress ?? 'unknown');
    } catch (error) {
      if (error instanceof AppError && error.status === 429) res.setHeader('Retry-After', error.code === 'UPLOAD_RATE_LIMIT' ? '60' : '2');
      next(error); return;
    }
    let parsing = false;
    const close = () => { clearTimeout(timer); if (!parsing) release(); };
    const timer = setTimeout(() => {
      if (res.destroyed || res.writableEnded) return;
      // 超时后关闭该上传连接，避免只释放槽位却继续接收正文。
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
      res.status(408).json({ success: false, code: 'UPLOAD_TIMEOUT', message: '上传超过一分钟，请检查网络后重试。' });
    }, options.uploadTimeoutMs ?? UPLOAD_LIMITS.timeoutMs);
    timer.unref();
    res.once('close', close);
    try {
      if (!req.is('multipart/form-data')) throw new AppError(400, 'FILE_REQUIRED', '请使用 multipart/form-data 上传一份 PDF。');
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > PDF_LIMITS.maxBytes + 16 * 1024) throw new AppError(413, 'FILE_SIZE', 'PDF 不能超过 10 MB。');
      upload(req, res, error => {
        clearTimeout(timer);
        res.off('close', close);
        if (error || res.destroyed || res.writableEnded) { release(); if (error && !res.destroyed) next(error); return; }
        parsing = true;
        // 断开连接后也等解析实际结束再释放，不能让取消绕过 CPU 并发限制。
        void (async () => {
          try {
            if (!req.file) throw new AppError(400, 'FILE_REQUIRED', '请选择一份文字型 PDF。');
            validatePdfFile(req.file);
            const parsed = await parsePdf(req.file.buffer);
            if (res.destroyed) return;
            const filename = req.file.originalname.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
            const session = store.create(userId, filename, parsed);
            res.json({ success: true, data: { documentId: session.id, filename, pageCount: parsed.pageCount, characterCount: parsed.characterCount, expiresAt: new Date(session.expiresAt).toISOString() } });
          } catch (cause) { if (!res.destroyed) next(cause); }
          finally { release(); }
        })();
      });
    } catch (error) { clearTimeout(timer); res.off('close', close); release(); next(error); }
  });

  router.post('/analyze', async (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    let session: ReturnType<ContractSessionStore['get']> | undefined;
    let started = false;
    try {
      if (typeof req.body?.documentId !== 'string') throw new AppError(400, 'DOCUMENT_REQUIRED', '请先上传并解析合同。');
      session = store.get(req.body.documentId, userId);
      if (session.result) { res.json({ success: true, data: session.result }); return; }
      if (store.isAnalyzing(userId)) throw new AppError(409, 'ANALYSIS_BUSY', '已有合同正在分析，请等待当前分析完成。');
      session.analyzing = true;
      started = true;
      const result = await analyzeContract(session.pages, completeJson, controller.signal);
      if (controller.signal.aborted) return;
      session.result = result;
      res.json({ success: true, data: result });
    } catch (error) { if (!res.destroyed) next(error); }
    finally {
      if (session && started) session.analyzing = false;
      res.off('close', cancel);
    }
  });

  router.delete('/:id', (req, res) => {
    store.remove(String(req.params.id), (req as unknown as { userId: number }).userId);
    res.json({ success: true });
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, code: error.code, message: error.code === 'LIMIT_FILE_SIZE' ? 'PDF 不能超过 10 MB。' : '每次只能上传一份 PDF，请使用 file 字段。' });
      return;
    }
    const known = error instanceof AppError;
    res.status(known ? error.status : 500).json({ success: false, code: known ? error.code : 'CONTRACT_ERROR', message: known ? error.message : '合同处理失败，请稍后重试。' });
  };
  router.use(handleError);
  return router;
}

export default createContractsRouter();
