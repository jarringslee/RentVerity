import userStore from '../stores/userStore'
import { API_BASE_URL } from './api'
import { SseFrames } from '../utils/sse'
import { validateHouseFilters } from '../utils/houseFilters'
import type { HouseFilters } from '../types/houses'
import type { AssistantEvent } from '../types/assistant'

export class AssistantApiError extends Error { constructor(public code: string, message: string) { super(message) } }
const invalid = () => new AssistantApiError('STREAM_INVALID', '助手返回的事件格式不正确，请重试。')
const validFilters = (value: any): value is HouseFilters => value && typeof value.location === 'string' && Array.isArray(value.houseTypes) && !validateHouseFilters(value)
export function parseAssistantEvent(event: string, data: any): AssistantEvent {
  if (!data || typeof data !== 'object') throw invalid()
  if (event === 'error') throw new AssistantApiError(typeof data.code === 'string' ? data.code : 'ASSISTANT_ERROR', typeof data.message === 'string' ? data.message : '本次回答中断，请重试。')
  if (event === 'delta' && typeof data.text === 'string' && data.text.length <= 12000) return { event, data }
  if (event === 'done' && data.complete === true) return { event, data }
  if (event === 'status' && ['understanding', 'searching', 'responding'].includes(data.stage) && typeof data.message === 'string' && data.message.length <= 200) return { event, data }
  if (event === 'context' && ['house_search', 'rental_qa', 'out_of_scope', 'contract_review'].includes(data.intent) && (data.filters === null || validFilters(data.filters)) && typeof data.needsClarification === 'boolean') return { event, data }
  if (event === 'houses' && validFilters(data.filters) && data.filters.city && Number.isSafeInteger(data.total) && data.total >= 0 && Array.isArray(data.list) && data.list.length <= 6 && data.list.length <= data.total && typeof data.notice === 'string' && Array.isArray(data.unavailablePreferences) && data.unavailablePreferences.length <= 6 && data.unavailablePreferences.every((item: unknown) => typeof item === 'string' && item.length <= 80)) {
    if (!data.list.every((row: any) => row && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.title === 'string' && typeof row.price === 'number' && Number.isFinite(row.price) && row.price >= 0 && typeof row.location === 'string' && typeof row.image === 'string' && (row.area === null || typeof row.area === 'number' && Number.isFinite(row.area)) && (row.city === null || typeof row.city === 'string') && (row.houseType === null || typeof row.houseType === 'string') && Array.isArray(row.matchReasons) && row.matchReasons.every((reason: unknown) => typeof reason === 'string'))) throw invalid()
    return { event, data }
  }
  throw invalid()
}

export async function streamAssistantMessage(body: { message: string; history: { role: 'user' | 'assistant'; content: string }[]; context: HouseFilters }, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<void> {
  const token = userStore.getToken()
  if (!token) throw new AssistantApiError('AUTH_REQUIRED', '请先登录后使用 AI 助手。')
  const local = new AbortController(), combined = AbortSignal.any([signal, local.signal])
  let idle = false, total = false
  let idleTimer: ReturnType<typeof setTimeout>
  const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { idle = true; local.abort() }, 35000) }
  const totalTimer = setTimeout(() => { total = true; local.abort() }, 145000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    resetIdle()
    const response = await fetch(`${API_BASE_URL}/assistant/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: combined
    })
    if (response.status === 401) userStore.expireSession(token)
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new AssistantApiError(payload?.code ?? 'REQUEST_FAILED', payload?.message ?? (response.status === 401 ? '登录已过期，请重新登录。' : '助手请求失败，请重试。'))
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw invalid()
    reader = response.body.getReader()
    const decoder = new TextDecoder(), frames = new SseFrames()
    let complete = false, characters = 0, bytes = 0, seenContext = false, seenHouses = false
    let intent = '', contextCity: string | undefined
    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle(); bytes += value.byteLength
      if (bytes > 1024 * 1024) throw invalid()
      for (const frame of frames.feed(decoder.decode(value, { stream: true }))) {
        const event = parseAssistantEvent(frame.event, JSON.parse(frame.data))
        if (event.event === 'context') { if (seenContext) throw invalid(); seenContext = true; intent = event.data.intent; contextCity = event.data.filters?.city }
        if (event.event === 'houses') { if (!seenContext || seenHouses || intent !== 'house_search' || event.data.filters.city !== contextCity) throw invalid(); seenHouses = true }
        if (event.event === 'delta') { if (!seenContext) throw invalid(); characters += event.data.text.length; if (characters > 12000) throw invalid() }
        if (event.event === 'done' && (!seenContext || characters === 0)) throw invalid()
        combined.throwIfAborted(); onEvent(event)
        if (event.event === 'done') { complete = true; break outer }
      }
    }
    if (!complete) throw new AssistantApiError('STREAM_INTERRUPTED', '连接中断，已生成内容不是完整回答；可手动重试。')
  } catch (error) {
    if (signal.aborted) throw error
    if (idle || total) throw new AssistantApiError('STREAM_TIMEOUT', idle ? '连接长时间无响应，请手动重试。' : '本轮回答超时，请手动重试。')
    if (error instanceof AssistantApiError) throw error
    throw new AssistantApiError('NETWORK_ERROR', '网络或回复协议异常；已生成内容将保留，可手动重试。')
  } finally {
    clearTimeout(idleTimer!); clearTimeout(totalTimer)
    await reader?.cancel().catch(() => {}); reader?.releaseLock()
  }
}
