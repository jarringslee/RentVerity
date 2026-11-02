// 只运行开工前保存的81d8f44编译快照；不包含新任务管理器或新PDF解析模块。
import '../config/env';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(__dirname, '../../.private/baseline-81d8f44');
const limits = require(path.join(root, 'contracts/pdf.js')).PDF_LIMITS;
if (limits.maxBytes !== 10 * 1024 * 1024 || limits.maxPages !== 40 || limits.maxCharacters !== 60000) throw new Error('Unverified legacy snapshot');
const client = require(path.join(root, 'services/modelClient.js')), complete = client.completeConfiguredJson;
let apiCalls = 0, inputMaxCharacters = 0, baseline = process.memoryUsage().rss, peak = baseline, since = Date.now();
client.completeConfiguredJson = (...args: any[]) => { apiCalls++; inputMaxCharacters = Math.max(inputMaxCharacters, args[0].reduce((n: number, message: any) => n + message.content.length, 0)); return complete(...args); };
const server = http.createServer(require(path.join(root, 'app.js')).createApp());
require(path.join(root, 'ws/chatGateway.js')).attachChatWss(server);
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25); sampler.unref();
process.on('message', (message: any) => {
  if (message?.type === 'reset') { baseline = process.memoryUsage().rss; peak = baseline; since = Date.now(); apiCalls = 0; inputMaxCharacters = 0; process.send?.({ type: 'ack', id: message.id }); }
  if (message?.type === 'metrics') process.send?.({ type: 'metrics', id: message.id, data: { apiCalls, baselineRssBytes: baseline, peakRssBytes: peak, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, inputMaxCharacters, elapsedMs: Date.now() - since } });
  if (message?.type === 'close') { clearInterval(sampler); server.closeAllConnections(); server.close(() => { void require(path.join(root, 'config/db.js')).pool.end().finally(() => process.disconnect?.()); }); }
});
server.listen(0, '127.0.0.1', () => process.send?.({ type: 'ready', base: `http://127.0.0.1:${(server.address() as any).port}` }));
