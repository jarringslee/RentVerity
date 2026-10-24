import { ref } from 'vue'
import { API_BASE_URL, SESSION_HEADER } from '../services/config'
import { withAuthMutation, getAuthRevision, isAuthMutating } from '../services/authMutation'

type CurrentUser = {
  id: number; username: string; phone: string; gender: 'male' | 'female';
  city: string | null; avatarUrl: string | null; preferences: string[];
  sessionId: string; expiresAt: string; createdAt?: string
}

const LEGACY_KEY = 'rentverity_current_user'
const EVENT_KEY = 'rentverity_auth_event'
const currentUser = ref<CurrentUser | null>(null)
const initialized = ref(false)
const sessionExpired = ref(false)
const sessionError = ref('')
// 仅是本标签的请求版本，不是 token，也不能用于服务端认证。
const sessionVersion = ref(0)
let pending: { version: number; authRevision: number; promise: Promise<boolean> } | null = null
let loggingOut: Promise<void> | null = null

function cleanUser(data: any): CurrentUser {
  if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.sessionId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(data.sessionId) || typeof data.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) throw new Error('登录状态无效，请重新登录。')
  // 白名单复制，响应或旧缓存中的 token 不进入状态。
  return {
    id: data.id, username: String(data.username ?? ''), phone: String(data.phone ?? ''),
    gender: data.gender === 'female' ? 'female' : 'male', city: data.city ?? null,
    avatarUrl: data.avatarUrl ?? null, preferences: Array.isArray(data.preferences) ? data.preferences.filter((v: unknown) => typeof v === 'string') : [],
    sessionId: data.sessionId, expiresAt: data.expiresAt, ...(data.createdAt ? { createdAt: data.createdAt } : {})
  }
}

function announceChange() {
  try { localStorage.setItem(EVENT_KEY, JSON.stringify({ nonce: crypto.randomUUID() })) } catch { /* 聚焦时仍可向后端重新核对。 */ }
}

function setCurrentUser(data: unknown, notify = true) {
  const user = cleanUser(data)
  if (currentUser.value?.sessionId !== user.sessionId || currentUser.value?.id !== user.id) sessionVersion.value++
  currentUser.value = user
  initialized.value = true
  sessionExpired.value = false
  sessionError.value = ''
  if (notify) announceChange()
}

function mergeCurrentUser(partial: Record<string, unknown>) {
  if (currentUser.value) setCurrentUser({ ...currentUser.value, ...partial }, false)
}

function clearLocal(expired = false, notify = false) {
  sessionVersion.value++
  currentUser.value = null
  initialized.value = true
  sessionExpired.value = expired
  sessionError.value = ''
  if (notify) announceChange()
}

function isCurrentSession(version: number) { return sessionVersion.value === version }

function expireSession(requestVersion: number) {
  if (!isCurrentSession(requestVersion)) return
  const hadUser = !!currentUser.value
  // 游客反复聚焦/核对仍是游客，不重建登录表单、丢失正在输入的内容。
  if (!hadUser) { initialized.value = true; sessionError.value = ''; return }
  clearLocal(hadUser, hadUser)
}

function checkExpiry() {
  if (currentUser.value && Date.parse(currentUser.value.expiresAt) <= Date.now()) expireSession(sessionVersion.value)
}

function isLoggedIn() { checkExpiry(); return !!currentUser.value }
function getSessionId() { checkExpiry(); return currentUser.value?.sessionId ?? null }
function getSessionVersion() { checkExpiry(); return sessionVersion.value }

function refreshSession(): Promise<boolean> {
  // 这是重新核对身份，不续签 JWT。认证写入期间不让聚焦/定时检查抢先更新状态。
  if (isAuthMutating()) return Promise.resolve(false)
  const version = sessionVersion.value
  const authRevision = getAuthRevision()
  const isCurrent = () => isCurrentSession(version) && authRevision === getAuthRevision()
  if (pending?.version === version && pending.authRevision === authRevision) return pending.promise
  const promise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/me`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (!isCurrent()) return false
      if (response.status === 401) { expireSession(version); return false }
      const result = await response.json()
      if (!isCurrent()) return false
      if (!response.ok || !result.success) throw new Error('恢复登录状态失败，请检查服务端后重试。')
      setCurrentUser(result.data, false)
      return true
    } catch (error) {
      // 网络故障不能当成退出成功，也不能覆盖新一轮登录。
      if (isCurrent()) sessionError.value = '无法恢复登录状态，请检查网络或服务端后重试。'
      return false
    } finally {
      if (isCurrent()) initialized.value = true
      if (pending?.version === version && pending.authRevision === authRevision) pending = null
    }
  })()
  pending = { version, authRevision, promise }
  return promise
}

async function initializeSession() {
  if (!initialized.value) await refreshSession()
}

function logout(): Promise<void> {
  if (loggingOut) return loggingOut
  const version = getSessionVersion(), sessionId = getSessionId()
  loggingOut = withAuthMutation(async () => {
    if (!isCurrentSession(version)) return
    const response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST', credentials: 'include', headers: sessionId ? { [SESSION_HEADER]: sessionId } : {}, signal: AbortSignal.timeout(10000)
    })
    if (!isCurrentSession(version)) return
    if (response.status === 409) { initialized.value = false; throw new Error('登录账号已变化，请重新操作。') }
    if (!response.ok) throw new Error('退出失败，请稍后重试。')
    clearLocal(false, true)
  }).finally(async () => { loggingOut = null; await initializeSession() })
  return loggingOut
}

if (typeof window !== 'undefined') {
  // 清掉旧版本整份用户缓存；不读取、迁移或广播其中的凭证。
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* storage may be disabled */ }
  const syncSession = (event: StorageEvent) => {
    if (event.key !== EVENT_KEY && event.key !== null) return
    clearLocal()
    initialized.value = false
    void refreshSession()
  }
  window.addEventListener('storage', syncSession)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', syncSession))
}

export default {
  currentUser, initialized, sessionExpired, sessionError, sessionVersion,
  setCurrentUser, mergeCurrentUser, expireSession, refreshSession, initializeSession,
  isLoggedIn, getSessionId, getSessionVersion, isCurrentSession, logout
}
