import { AppError } from '../utils/AppError';
import { readModelConfig, type ModelConfig, type ModelMessage } from './modelClient';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ChatMessage = ModelMessage | { role: 'assistant'; content: null; tool_calls: ToolCall[] } | { role: 'tool'; content: string; tool_call_id: string };
export interface ChatTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface AssistantModel {
  choose(messages: ChatMessage[], tools: ChatTool[], signal: AbortSignal): Promise<ToolCall>;
  stream(messages: ChatMessage[], onDelta: (text: string) => Promise<void>, signal: AbortSignal): Promise<void>;
}

// 网络 chunk 不是完整 SSE 事件，也不一定是完整 UTF-8 字符。
export class SseFrames {
  private pending = '';
  private event = 'message';
  private data: string[] = [];
  private dataSize = 0;
  feed(text: string): { event: string; data: string }[] {
    this.pending += text;
    if (this.pending.length > 256000) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '流事件超过大小限制。');
    const frames: { event: string; data: string }[] = [];
    while (true) {
      const end = this.pending.indexOf('\n'); if (end < 0) break;
      const line = this.pending.slice(0, end).replace(/\r$/, ''); this.pending = this.pending.slice(end + 1);
      if (!line) {
        if (this.data.length) frames.push({ event: this.event, data: this.data.join('\n') });
        this.event = 'message'; this.data = []; this.dataSize = 0;
      } else if (line.startsWith('data:')) { const value = line.slice(5).replace(/^ /, ''); this.data.push(value); this.dataSize += value.length; }
      else if (line.startsWith('event:')) this.event = line.slice(6).trim();
      if (this.dataSize > 256000) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '流事件超过大小限制。');
    }
    return frames;
  }
}

export function createChatModel(config: ModelConfig): AssistantModel {
  const run = async <T>(signal: AbortSignal, body: Record<string, unknown>, read: (response: Response) => Promise<T>): Promise<T> => {
    const timeout = AbortSignal.timeout(config.timeoutMs), combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: combined, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, max_tokens: 2400, ...body,
          ...(new URL(config.baseUrl).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}) })
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new AppError(429, 'AI_RATE_LIMIT', '模型限流，请稍后手动重试。');
        if ([401, 403].includes(response.status)) throw new AppError(502, 'AI_AUTH_FAILED', '模型鉴权失败，请检查本项目的独立 Key。');
        throw new AppError(502, 'AI_SERVICE_ERROR', '模型服务暂时不可用，请稍后重试。');
      }
      return await read(response);
    } catch (error) {
      if (signal.aborted) throw new AppError(499, 'REQUEST_CANCELLED', '请求已取消。');
      if (timeout.aborted) throw new AppError(504, 'AI_TIMEOUT', '模型响应超时，请手动重试。');
      if (error instanceof AppError) throw error;
      if (error instanceof SyntaxError) throw new AppError(502, 'AI_INVALID_RESPONSE', '模型协议或参数格式错误，请重试。');
      throw new AppError(502, 'AI_NETWORK_ERROR', '模型连接中断，请检查网络后重试。');
    }
  };
  return {
    choose: (messages, tools, signal) => run(signal, { messages, tools, tool_choice: 'required', stream: false }, async response => {
      if (!response.body) throw new AppError(502, 'AI_EMPTY_RESPONSE', '模型没有返回工具选择。');
      const reader = response.body.getReader(); let text = ''; const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.length > 64000) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '模型工具响应过长。');
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const choice = JSON.parse(text)?.choices?.[0], calls = choice?.message?.tool_calls;
      if (choice?.finish_reason !== 'tool_calls' || !Array.isArray(calls) || calls.length !== 1) throw new AppError(502, 'AI_TOOL_INVALID', '助手未返回单个有效工具调用，请重试。');
      const call = calls[0];
      if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 200 || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string' || call.function.arguments.length > 12000) throw new AppError(502, 'AI_TOOL_INVALID', '助手工具参数无效。');
      return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
    }),
    stream: (messages, onDelta, signal) => run(signal, { messages, stream: true }, async response => {
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new AppError(502, 'AI_STREAM_INVALID', '模型未返回流式事件。');
      const reader = response.body.getReader(), decoder = new TextDecoder(), frames = new SseFrames();
      let finished = false, doneMarker = false, length = 0, bytes = 0;
      try {
        outer: while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024 * 1024) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '模型事件流超出大小限制。');
          for (const frame of frames.feed(decoder.decode(value, { stream: true }))) {
            if (frame.data === '[DONE]') { doneMarker = true; break outer; }
            const event = JSON.parse(frame.data), choice = event?.choices?.[0];
            if (!choice && event?.usage && Array.isArray(event.choices) && event.choices.length === 0) continue;
            if (!choice || event.error) throw new AppError(502, 'AI_STREAM_INVALID', '模型事件结构错误。');
            if (choice.delta?.tool_calls) throw new AppError(502, 'AI_TOOL_INVALID', '正文阶段不允许再次调用工具。');
            const text = choice.delta?.content;
            if (text != null && typeof text !== 'string') throw new AppError(502, 'AI_STREAM_INVALID', '模型文本增量无效。');
            if (text) {
              if (finished) throw new AppError(502, 'AI_STREAM_INVALID', '模型结束后仍返回正文。');
              length += text.length;
              if (length > 12000) throw new AppError(502, 'AI_RESPONSE_TOO_LARGE', '回复过长，请缩小问题范围。');
              await onDelta(text);
            }
            if (choice.finish_reason != null) {
              if (choice.finish_reason !== 'stop') throw new AppError(502, 'AI_TRUNCATED', '模型回复未完整生成，请重试。');
              finished = true;
            }
          }
        }
        if (!doneMarker || !finished || !length) throw new AppError(502, 'AI_STREAM_INTERRUPTED', '回复中途断开，已生成部分不代表完整回答。');
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    })
  };
}
export const configuredAssistantModel: AssistantModel = {
  choose: (...args) => createChatModel(readModelConfig()).choose(...args),
  stream: (...args) => createChatModel(readModelConfig()).stream(...args)
};
