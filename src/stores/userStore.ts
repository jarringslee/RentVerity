import { ref } from 'vue'

const STORAGE_KEY = 'xian_rent_current_user'

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
}

// 清除当前用户
const clearCurrentUser = () => {
  currentUser.value = null
  persistUser(null)
}

// 检查用户是否已登录
const isLoggedIn = () => {
  return !!currentUser.value
}

// 获取 token（后续请求收藏/聊天/上传会用到）
const getToken = () => {
  return currentUser.value?.token || null
}

export default {
  currentUser,
  setCurrentUser,
  clearCurrentUser,
  isLoggedIn,
  getToken
}