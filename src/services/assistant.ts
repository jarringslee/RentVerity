import userStore from '../stores/userStore'
import { API_BASE_URL } from './api'
import type { HouseFilters } from '../types/houses'
import type { AssistantReply, AssistantSearchResult } from '../types/assistant'

export class AssistantApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

async function request<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const token = userStore.getToken()
  if (!token) throw new AssistantApiError('AUTH_REQUIRED', '请先登录后使用 AI 助手。')
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/assistant${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AssistantApiError('NETWORK_ERROR', '无法连接助手服务，请检查网络或服务端。')
  }
  const payload = await response.json().catch(() => null)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!response.ok || !payload?.success) throw new AssistantApiError(payload?.code || 'REQUEST_FAILED', payload?.message || (response.status === 401 ? '登录已过期，请重新登录。' : '助手返回异常，请稍后重试。'))
  return payload.data as T
}

export const sendAssistantMessage = (body: { message: string; history: { role: 'user' | 'assistant'; content: string }[]; filters: HouseFilters }, signal: AbortSignal) => request<AssistantReply>('/message', body, signal)
export const confirmAssistantSearch = (filters: HouseFilters, signal: AbortSignal) => request<AssistantSearchResult>('/search', { filters }, signal)
