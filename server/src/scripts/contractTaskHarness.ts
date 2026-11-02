// 仅供显式验收启动的本机进程，不被生产app导入；故障控制走父进程IPC，不提供HTTP调试开关。
import '../config/env';
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../app';
import { ContractTaskManager } from '../contracts/tasks';
import { readContractLimits } from '../contracts/limits';
import { ContractUploadGate, UPLOAD_LIMITS } from '../contracts/uploadGate';
import { completeConfiguredJson, readModelConfig } from '../services/modelClient';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import { configuredAssistantModel } from '../services/chatModel';
import { houseRepository } from '../houses/repository';
import { attachChatWss } from '../ws/chatGateway';

const mode = process.argv.find(v => v.startsWith('--mode='))?.slice(7) ?? 'real';
const root = process.argv.find(v => v.startsWith('--root='))?.slice(7);
const port = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 0);
let faultMode = 'normal', apiCalls = 0, inputMaxCharacters = 0, peak = process.memoryUsage().rss, baseline = peak, since = Date.now();
let assistantCalls = 0, assistantQueries = 0;
const emit = (data: unknown) => { if (process.connected) process.send?.(data); };
const limits = { ...readContractLimits(), ...(root ? { tempRoot: path.resolve(root) } : {}) };
let manager: ContractTaskManager | undefined, legacyPool: typeof pool | undefined;
function createServer() {
  if (mode === 'baseline') {
    const legacy = path.resolve(__dirname, '../../.private/baseline-81d8f44');
    const model = require(path.join(legacy, 'services/modelClient.js'));
    const complete = model.completeConfiguredJson;
    model.completeConfiguredJson = (...args: any[]) => { apiCalls++; inputMaxCharacters = Math.max(inputMaxCharacters, args[0].reduce((n: number, m: any) => n + m.content.length, 0)); return complete(...args); };
    legacyPool = require(path.join(legacy, 'config/db.js')).pool;
    return http.createServer(require(path.join(legacy, 'app.js')).createApp());
  }
  if (mode === 'real' && new URL(readModelConfig().baseUrl).hostname !== 'api.deepseek.com') throw new Error('Real test must use configured DeepSeek');
  manager = new ContractTaskManager({ limits, gate: new ContractUploadGate(Date.now, { ...UPLOAD_LIMITS, perUser: 1000, perIp: 1000 }), audit: data => emit({ type: 'audit', data }), model: async (messages, signal, options) => {
    if (mode === 'real') { apiCalls++; inputMaxCharacters = Math.max(inputMaxCharacters, messages.reduce((n, m) => n + m.content.length, 0)); return completeConfiguredJson(messages, signal, options); }
    const input = JSON.parse(messages[1].content);
    if (faultMode === 'slow') return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new AppError(499, 'REQUEST_CANCELLED', 'fixture cancelled')), { once: true }));
    if (faultMode === 'partial' && input.block === 2) throw new AppError(504, 'AI_TIMEOUT', 'fixture timeout');
    const segment = faultMode === 'page2' ? input.segments.find((part: any) => part.page === 2) : input.segments.find((part: any) => part.text.trim().length >= 8);
    const findings = segment ? [{ severity: 'high', category: '合成条款核对', quote: faultMode === 'fake' ? 'THIS QUOTE IS NOT IN THE FILE' : segment.text.trim().slice(0, 80), page: segment.page, reason: '合成回归提示，不是真实模型判断。', suggestion: '核对原文。' }] : [];
    return { summary: faultMode === 'danger' ? '<script>window.__contractXss=1</script> [link](javascript:alert(1))' : '显式故障桩结果；以原文核验为准。', findings };
  } });
  return http.createServer(createApp({ contracts: { manager }, assistant: { model: { choose: (...args) => { assistantCalls++; return configuredAssistantModel.choose(...args); }, stream: (...args) => { assistantCalls++; return configuredAssistantModel.stream(...args); } }, repository: { search: query => { assistantQueries++; return houseRepository.search(query); } } } }));
}
const server = createServer();
if (mode !== 'baseline') attachChatWss(server);
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25); sampler.unref();
process.on('message', async (message: any) => {
  if (message?.type === 'fault' && mode === 'fault') { faultMode = message.mode; emit({ type: 'ack', id: message.id }); }
  if (message?.type === 'reset') { baseline = process.memoryUsage().rss; peak = baseline; since = Date.now(); apiCalls = 0; inputMaxCharacters = 0; emit({ type: 'ack', id: message.id }); }
  if (message?.type === 'metrics') emit({ type: 'metrics', id: message.id, data: { apiCalls, baselineRssBytes: baseline, peakRssBytes: peak, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, inputMaxCharacters, elapsedMs: Date.now() - since, reservedBytes: manager?.storage.reservedBytes ?? 0, assistantCalls, assistantQueries } });
  if (message?.type === 'close') {
    clearInterval(sampler); server.closeAllConnections();
    server.close(() => { void (async () => { await manager?.close(); await pool.end(); await legacyPool?.end(); emit({ type: 'closed' }); process.disconnect?.(); })().catch(() => { process.exitCode = 1; process.disconnect?.(); }); });
  }
});
void (async () => { if (manager) await manager.initialize(); server.listen(port, '127.0.0.1', () => emit({ type: 'ready', base: `http://127.0.0.1:${(server.address() as any).port}`, mode })); })().catch(() => { emit({ type: 'fatal', code: 'HARNESS_START' }); process.exitCode = 1; process.disconnect?.(); });
