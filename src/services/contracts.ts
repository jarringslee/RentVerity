import userStore from '../stores/userStore'
import { sessionFetch, assertCurrentSession } from './sessionRequest'
import type { ContractLimits, ContractTask } from '../types/contracts'

export class ContractApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

async function contractRequest<T>(path: string, options: RequestInit, timeoutMs = 15000): Promise<T> {
  if (!userStore.isLoggedIn()) throw new ContractApiError(401, 'AUTH_REQUIRED', '请先登录后分析合同。')
  const headers = new Headers(options.headers)
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  let response: Response
  let payload: any
  try {
    const request = await sessionFetch(`/contracts${path}`, { ...options, headers, signal })
    response = request.response
    payload = await response.json().catch(error => { if (signal.aborted) throw error; return null })
    if (response.status !== 401) assertCurrentSession(request.version, request.authRevision)
  }
  catch (error) {
    if (options.signal?.aborted) throw error
    if (deadline.aborted) throw new ContractApiError(408, 'REQUEST_TIMEOUT', '请求等待超时，请检查网络后手动重试。')
    throw new ContractApiError(0, 'NETWORK_ERROR', '无法连接服务端，请检查服务是否启动。')
  }
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!response.ok || !payload?.success) {
    throw new ContractApiError(response.status, payload?.code || 'REQUEST_FAILED', payload?.message || (response.status === 401 ? '登录已过期，请重新登录。' : '服务端返回异常，请稍后重试。'))
  }
  return payload.data as T
}

export function uploadContractTask(file: File, taskId: string, signal: AbortSignal, timeoutMs: number): Promise<ContractTask> {
  const form = new FormData()
  form.append('file', file)
  // FormData 的 Content-Type 边界由浏览器生成，不能手写 application/json。
  return contractRequest('/tasks', { method: 'POST', headers: { 'X-Contract-Task-Id': taskId, 'X-Contract-File-Size': String(file.size) }, body: form, signal }, timeoutMs)
}
export const getContractLimits = (signal?: AbortSignal) => contractRequest<ContractLimits>('/limits', { method: 'GET', signal })
export const getContractTask = (id: string, signal: AbortSignal) => contractRequest<ContractTask>(`/tasks/${encodeURIComponent(id)}`, { method: 'GET', signal })
export const retryContractTask = (id: string, signal: AbortSignal) => contractRequest<ContractTask>(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', signal })
export const discardContract = (id: string) => contractRequest<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }, 20000)
