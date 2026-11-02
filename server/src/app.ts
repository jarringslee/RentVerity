import './config/env';
import http from 'http';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { pool } from './config/db';
import { UPLOADS_ROOT } from './config/paths';
import authRouter from './routes/auth';
import housesRouter from './routes/houses';
import favoritesRouter from './routes/favorites';
import usersRouter from './routes/users';
import chatRouter from './routes/chat';
import contractsRouter, { createContractsRouter, getContractTaskManager } from './routes/contracts';
import assistantRouter, { createAssistantRouter } from './routes/assistant';
import { attachChatWss } from './ws/chatGateway';
import { getJwtSecret } from './config/jwt';
import { logSafeError } from './utils/logSafeError';
import { isAllowedOrigin, requireTrustedSource } from './middleware/csrf';

export function createApp(options: { assistant?: Parameters<typeof createAssistantRouter>[0]; contracts?: Parameters<typeof createContractsRouter>[0] } = {}) {
const app = express();

fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
fs.mkdirSync(`${UPLOADS_ROOT}/avatars`, { recursive: true });

app.use(cors({ origin: (origin, callback) => callback(null, !!origin && isAllowedOrigin(origin)), credentials: true }));
// 在 JSON 解析和 multipart 上传之前拒绝不可信来源，包括登录、注册和退出。
app.use(requireTrustedSource);
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_ROOT));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 测试数据库连接
app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS result');
    res.json({ success: true, rows });
  } catch (err) {
    logSafeError(err);
    res.status(500).json({ success: false, message: 'DB connection failed' });
  }
});

// 业务路由
app.use('/auth', authRouter);
app.use('/houses', housesRouter);
app.use('/favorites', favoritesRouter);
app.use('/users', usersRouter);
app.use('/chat', chatRouter);
app.use('/contracts', options.contracts ? createContractsRouter(options.contracts) : contractsRouter);
app.use('/assistant', options.assistant ? createAssistantRouter(options.assistant) : assistantRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const type = (error as { type?: string })?.type;
  if (type === 'entity.parse.failed' || type === 'entity.too.large') return res.status(type === 'entity.too.large' ? 413 : 400).json({ success: false, message: 'JSON 请求格式无效或内容过大。' });
  console.error('Unhandled server error');
  return res.status(500).json({ success: false, message: '服务暂时不可用' });
});
return app;
}

if (require.main === module) {
getJwtSecret();
const PORT = Number(process.env.PORT) || 3001;

const server = http.createServer(createApp());
const chatWss = attachChatWss(server);
let stopping = false;

void getContractTaskManager().initialize().then(() => { if (!stopping) server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket chat at ws://localhost:${PORT}/ws/chat`);
}); }).catch(() => { console.error('Contract temporary storage initialization failed'); process.exitCode = 1; });
const shutdown = () => {
  if (stopping) return; stopping = true;
  for (const socket of chatWss.clients) socket.terminate();
  server.closeAllConnections(); server.close(() => {});
  // 回收立即开始，不等待浏览器或升级后的WebSocket主动关闭。
  void getContractTaskManager().close().catch(() => { console.error('Contract shutdown cleanup pending'); process.exitCode = 1; }).finally(() => pool.end()).catch(() => { process.exitCode = 1; });
};
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
