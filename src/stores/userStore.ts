import { ref } from 'vue'

const STORAGE_KEY = 'rentverity_current_user'

const readPersistedUser = () => {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// 用户状态（启动时从 localStorage 恢复）
const currentUser = ref<any>(readPersistedUser())
const sessionExpired = ref(false)

const persistUser = (user: any) => {
  try {
    if (typeof window === 'undefined') return
    if (!user) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  } catch {
    // ignore persist errors (storage disabled / quota)
  }
}

// 设置当前用户
const setCurrentUser = (user: any) => {
  currentUser.value = user
  persistUser(user)
  sessionExpired.value = false
  refreshSession()
}

// 合并更新当前用户信息（保留 token 等未返回字段）
const mergeCurrentUser = (partial: Record<string, any>) => {
  if (!currentUser.value) return
  const next = {
    ...currentUser.value,
    ...partial
  }
  // 已改用多选 preferences，去掉旧字段 preference 避免与展示不一致
  if ('preferences' in partial) {
    delete next.preference
  }
  setCurrentUser(next)
}

// 清除当前用户
const clearCurrentUser = () => {
  currentUser.value = null
  persistUser(null)
  sessionExpired.value = false
}

// 仅用于前端体验，不验签、不取代后端 JWT 校验。旧请求的 401 不得退出新账号。
const expireSession = (requestToken: string | null) => {
  if (!requestToken || currentUser.value?.token !== requestToken) return
  clearCurrentUser()
  sessionExpired.value = true
}

function refreshSession() {
  const user = currentUser.value
  if (!user) return
  const token = user.token
  try {
    if (typeof token !== 'string' || !token) throw new Error('missing token')
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid token')
    const body = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (body.exp != null && (typeof body.exp !== 'number' || !Number.isFinite(body.exp) || body.exp * 1000 <= Date.now())) throw new Error('expired token')
  } catch {
    clearCurrentUser()
    sessionExpired.value = true
  }
}

// 检查用户是否已登录
const isLoggedIn = () => {
  return !!currentUser.value?.token
}

// 获取 token（后续请求收藏/聊天/上传会用到）
const getToken = () => {
  refreshSession()
  return currentUser.value?.token || null
}

refreshSession()
// 同一浏览器的另一标签退出/切换账号时，当前页也要清除私有业务状态。
if (typeof window !== 'undefined') {
  const syncSession = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    currentUser.value = readPersistedUser()
    sessionExpired.value = false
    refreshSession()
  }
  window.addEventListener('storage', syncSession)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', syncSession))
}

export default {
  currentUser,
  setCurrentUser,
  mergeCurrentUser,
  clearCurrentUser,
  expireSession,
  refreshSession,
  sessionExpired,
  isLoggedIn,
  getToken
}
