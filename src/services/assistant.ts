import userStore from '../stores/userStore'
import { sessionFetch, assertCurrentSession } from './sessionRequest'
import { SseFrames } from '../utils/sse'
import { AssistantStreamGuard, AssistantProtocolError, parseAssistantEvent } from '../utils/assistantProtocol'
import type { HouseFilters } from '../types/houses'
import type { AssistantEvent } from '../types/assistant'

export class AssistantApiError extends Error { constructor(public code: string, message: string) { super(message) } }
const invalid = () => new AssistantApiError('STREAM_INVALID', '助手返回的事件格式不正确，请重试。')
export { parseAssistantEvent } from '../utils/assistantProtocol'

export async function streamAssistantMessage(body: { message: string; history: { role: 'user' | 'assistant'; content: string }[]; context: HouseFilters }, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<void> {
  if (!userStore.isLoggedIn()) throw new AssistantApiError('AUTH_REQUIRED', '请先登录后使用 AI 助手。')
  const local = new AbortController(), combined = AbortSignal.any([signal, local.signal])
  let idle = false, total = false
  let idleTimer: ReturnType<typeof setTimeout>
  const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { idle = true; local.abort() }, 35000) }
  const totalTimer = setTimeout(() => { total = true; local.abort() }, 145000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    resetIdle()
    const { response, version, authRevision } = await sessionFetch('/assistant/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: combined
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new AssistantApiError(payload?.code ?? 'REQUEST_FAILED', payload?.message ?? (response.status === 401 ? '登录已过期，请重新登录。' : '助手请求失败，请重试。'))
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw invalid()
    reader = response.body.getReader()
    const decoder = new TextDecoder(), frames = new SseFrames()
    let complete = false, bytes = 0
    const guard = new AssistantStreamGuard()
    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle(); bytes += value.byteLength
      if (bytes > 1024 * 1024) throw invalid()
      for (const frame of frames.feed(decoder.decode(value, { stream: true }))) {
        const event = parseAssistantEvent(frame.event, JSON.parse(frame.data))
        guard.accept(event)
        combined.throwIfAborted(); assertCurrentSession(version, authRevision); onEvent(event)
        if (event.event === 'error') {
          if (event.data.code === 'AUTH_EXPIRED') userStore.expireSession(version)
          throw new AssistantApiError(event.data.code, event.data.message)
        }
        if (event.event === 'done') { complete = true; break outer }
      }
    }
    if (!complete) throw new AssistantApiError('STREAM_INTERRUPTED', '连接中断，已生成内容不是完整回答；可手动重试。')
  } catch (error) {
    if (signal.aborted) throw error
    if (idle || total) throw new AssistantApiError('STREAM_TIMEOUT', idle ? '连接长时间无响应，请手动重试。' : '本轮回答超时，请手动重试。')
    if (error instanceof AssistantApiError) throw error
    if (error instanceof AssistantProtocolError || error instanceof SyntaxError) throw new AssistantApiError('STREAM_INVALID', error.message)
    throw new AssistantApiError('NETWORK_ERROR', '网络或回复协议异常；已生成内容将保留，可手动重试。')
  } finally {
    clearTimeout(idleTimer!); clearTimeout(totalTimer)
    await reader?.cancel().catch(() => {}); reader?.releaseLock()
  }
}
