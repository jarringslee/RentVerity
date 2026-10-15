import '../config/env';
import { AppError } from '../utils/AppError';

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type CompleteJson = (messages: ModelMessage[], signal?: AbortSignal) => Promise<unknown>;

export function readModelConfig(): ModelConfig {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', '尚未配置本项目的 DeepSeek Key，请填写 server/.env.local 后重启服务端。');
  }
  const baseUrl = process.env.AI_BASE_URL?.trim() || 'https://api.deepseek.com';
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 60000);
  try {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error();
  } catch {
    throw new AppError(503, 'AI_CONFIG_INVALID', '模型配置有误，请检查 AI_BASE_URL 和 AI_TIMEOUT_MS（1000—120000）。');
  }
  return { apiKey, baseUrl, model: process.env.AI_MODEL?.trim() || 'deepseek-flash', timeoutMs };
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) throw new AppError(502, 'AI_EMPTY_RESPONSE', '模型未返回内容，请稍后重试。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256000) {
        await reader.cancel();
        throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '模型返回内容超出限制，请缩短合同后重试。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createModelClient(config: ModelConfig): CompleteJson {
  return async (messages, signal) => {
    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        signal: combinedSignal,
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: { type: 'json_object' },
          stream: false,
          max_tokens: 6000,
          ...(new URL(config.baseUrl).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {})
        })
      });
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 429 ? 'AI_RATE_LIMIT' : [401, 403].includes(response.status) ? 'AI_AUTH_FAILED' : 'AI_SERVICE_ERROR';
        const message = code === 'AI_AUTH_FAILED' ? '模型服务鉴权失败，请检查本项目的独立 Key。' : code === 'AI_RATE_LIMIT' ? '模型服务繁忙，请稍后重试。' : '模型服务调用失败，请检查模型配置或稍后重试。';
        throw new AppError(502, code, message);
      }
      const envelope = JSON.parse(await readLimitedBody(response));
      const choice = envelope?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new AppError(502, 'AI_TRUNCATED', '模型结果被截断，请缩短合同后重试。');
      if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
        throw new AppError(502, 'AI_EMPTY_RESPONSE', '模型没有返回完整分析，请重试。');
      }
      // JSON mode 只保证 JSON 语法，业务结构与引用仍由各业务服务校验。
      return JSON.parse(choice.message.content);
    } catch (error) {
      if (signal?.aborted) throw new AppError(499, 'REQUEST_CANCELLED', '请求已取消。');
      if (timeoutSignal.aborted) throw new AppError(504, 'AI_TIMEOUT', '模型分析超时，可以重试。');
      if (error instanceof AppError) throw error;
      if (error instanceof SyntaxError) throw new AppError(502, 'AI_INVALID_JSON', '模型返回了无效 JSON，请重试。');
      // 不向前端或日志暴露上游响应、Key、合同文本及网络请求头。
      throw new AppError(502, 'AI_NETWORK_ERROR', '无法连接模型服务，请检查网络或稍后重试。');
    }
  };
}

export const completeConfiguredJson: CompleteJson = (messages, signal) => createModelClient(readModelConfig())(messages, signal);
