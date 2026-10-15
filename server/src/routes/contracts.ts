import { Router, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { completeConfiguredJson, type CompleteJson } from '../services/modelClient';
import { analyzeContract } from '../contracts/analysis';
import { ContractSessionStore } from '../contracts/sessionStore';
import { PDF_LIMITS, parseContractPdf, validatePdfFile } from '../contracts/pdf';

// 只保存短期页文本和结果，不把原合同写进 uploads 或磁盘。
export function createContractsRouter(options: { completeJson?: CompleteJson; store?: ContractSessionStore } = {}) {
  const router = Router();
  const store = options.store ?? new ContractSessionStore();
  const completeJson = options.completeJson ?? completeConfiguredJson;
  const parsingUsers = new Set<number>();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PDF_LIMITS.maxBytes, files: 1, fields: 0, parts: 2 } });
  router.use(requireAuth);

  router.post('/parse', upload.single('file'), async (req, res, next) => {
    const userId = (req as unknown as { userId: number }).userId;
    let started = false;
    try {
      if (!req.file) throw new AppError(400, 'FILE_REQUIRED', '请选择一份文字型 PDF。');
      if (parsingUsers.has(userId) || parsingUsers.size >= 4) throw new AppError(429, 'PDF_BUSY', '正在解析其他合同，请稍后重试。');
      validatePdfFile(req.file);
      parsingUsers.add(userId);
      started = true;
      const parsed = await parseContractPdf(req.file.buffer);
      if (res.destroyed) return;
      const filename = req.file.originalname.replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
      const session = store.create(userId, filename, parsed);
      res.json({ success: true, data: { documentId: session.id, filename, pageCount: parsed.pageCount, characterCount: parsed.characterCount, expiresAt: new Date(session.expiresAt).toISOString() } });
    } catch (error) { next(error); }
    finally { if (started) parsingUsers.delete(userId); }
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
