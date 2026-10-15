import userStore from '../stores/userStore'
import { API_BASE_URL } from './api'
import type { ContractAnalysis, ParsedContract } from '../types/contracts'

export class ContractApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

async function contractRequest<T>(path: string, options: RequestInit): Promise<T> {
  const token = userStore.getToken()
  if (!token) throw new ContractApiError(401, 'AUTH_REQUIRED', '请先登录后分析合同。')
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try { response = await fetch(`${API_BASE_URL}/contracts${path}`, { ...options, headers }) }
  catch (error) {
    if (options.signal?.aborted) throw error
    throw new ContractApiError(0, 'NETWORK_ERROR', '无法连接服务端，请检查服务是否启动。')
  }
  const payload = await response.json().catch(() => null)
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!response.ok || !payload?.success) {
    throw new ContractApiError(response.status, payload?.code || 'REQUEST_FAILED', payload?.message || (response.status === 401 ? '登录已过期，请重新登录。' : '服务端返回异常，请稍后重试。'))
  }
  return payload.data as T
}

export function parseContract(file: File, signal: AbortSignal): Promise<ParsedContract> {
  const form = new FormData()
  form.append('file', file)
  // FormData 的 Content-Type 边界由浏览器生成，不能手写 application/json。
  return contractRequest('/parse', { method: 'POST', body: form, signal })
}

export function analyzeContract(documentId: string, signal: AbortSignal): Promise<ContractAnalysis> {
  return contractRequest('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId }), signal })
}

export async function discardContract(documentId: string): Promise<void> {
  await contractRequest(`/${encodeURIComponent(documentId)}`, { method: 'DELETE', keepalive: true })
}
