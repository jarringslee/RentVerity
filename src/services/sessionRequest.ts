import userStore from '../stores/userStore'
import { API_BASE_URL, SESSION_HEADER } from './config'
import { getAuthRevision, isAuthMutating } from './authMutation'

export function assertCurrentSession(version: number, authRevision = getAuthRevision()) {
  if (!userStore.isCurrentSession(version) || isAuthMutating() || authRevision !== getAuthRevision()) throw new DOMException('登录状态已变化', 'AbortError')
}

export async function sessionFetch(path: string, options: RequestInit = {}, authRequest = false) {
  const version = userStore.getSessionVersion()
  const authRevision = getAuthRevision()
  if (!authRequest) assertCurrentSession(version, authRevision)
  const headers = new Headers(options.headers)
  const sessionId = userStore.getSessionId()
  if (!authRequest && sessionId) headers.set(SESSION_HEADER, sessionId)
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (!authRequest) assertCurrentSession(version, authRevision)
  if (!authRequest && response.status === 401) userStore.expireSession(version)
  if (!authRequest && response.status === 409) {
    const result = await response.clone().json().catch(() => null)
    assertCurrentSession(version, authRevision)
    if (result?.code === 'SESSION_CHANGED') {
      await userStore.refreshSession()
      throw new DOMException('登录状态已变化，请重新操作', 'AbortError')
    }
  }
  return { response, version, authRevision }
}
