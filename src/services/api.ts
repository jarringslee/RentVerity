// 真实后端 API；不回退到本地房源夹具。
import userStore from '../stores/userStore'
import type { HouseQuery } from '../types/houses'
import { houseFiltersToQuery } from '../utils/houseFilters'
import { API_BASE_URL } from './config'
import { sessionFetch, assertCurrentSession } from './sessionRequest'
import { withAuthMutation } from './authMutation'

export { API_BASE_URL }

// 公共请求封装
const requestOnce = async (path: string, options: RequestInit = {}) => {
  const isAuthRequest = path === '/auth/login' || path === '/auth/register'
  const { response: res, version, authRevision } = await sessionFetch(path, {
    ...options,
    signal: isAuthRequest ? (options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)) : options.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }, isAuthRequest)
  const payload = await res.json().catch(() => null)
  if (isAuthRequest && !payload) throw new Error('无法确认登录结果，请重新检查登录状态。')
  if (!isAuthRequest && res.status !== 401) assertCurrentSession(version, authRevision)
  return payload ?? { success: false, message: res.status === 401 ? '登录已过期，请重新登录。' : '服务端返回异常，请稍后重试。' }
}

const request = async (path: string, options: RequestInit = {}) => {
  if (path !== '/auth/login' && path !== '/auth/register') return requestOnce(path, options)
  try {
    return await withAuthMutation(async () => {
      const result = await requestOnce(path, options)
      // Cookie 已由浏览器处理；身份更新和通知也必须在认证锁释放之前完成。
      if (result.success) userStore.setCurrentUser(result.data)
      return result
    })
  } catch (error) {
    // Set-Cookie 可能已到达而正文读取失败，解除锁后重新核对浏览器实际持有的身份。
    await userStore.refreshSession()
    throw error
  } finally { await userStore.initializeSession() }
}


// 用户登录 —— 调用后端 /auth/login
export const login = async (username: string, password: string) => {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
}

// 注册 —— 调用后端 /auth/register
export const register = async (payload: {
  username: string
  phone: string
  password: string
  preferences?: string[]
  gender?: 'male' | 'female'
  city?: string | null
}) => {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: payload.username,
      phone: payload.phone,
      password: payload.password,
      preferences: payload.preferences ?? [],
      gender: payload.gender ?? 'male',
      city: payload.city ?? null
    })
  })
}

// 获取当前用户资料（需登录）
export const fetchUserProfile = async () => {
  return request('/users/me')
}

// 更新基本资料（需登录）：用户名、手机号、性别、城市、个人偏好（多选）；avatarUrl 传 null 表示恢复默认头像
export const updateUserProfile = async (payload: {
  username?: string
  phone?: string
  gender?: 'male' | 'female'
  city?: string | null
  preferences?: string[]
  avatarUrl?: string | null
}) => {
  return request('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  })
}

/** 上传头像（multipart 字段 avatar），由浏览器携带 HttpOnly Cookie。 */
export const uploadUserAvatar = async (file: File) => {
  const form = new FormData()
  form.append('avatar', file)
  const { response: res, version, authRevision } = await sessionFetch('/users/me/avatar', {
    method: 'POST',
    body: form
  })
  const result = await res.json()
  if (res.status !== 401) assertCurrentSession(version, authRevision)
  return result
}

// 修改密码：需原密码；后端校验新密码不可与旧密码相同（需登录）
export const changeUserPassword = async (payload: { oldPassword: string; newPassword: string }) => {
  return request('/users/me/password', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  })
}

// 将后端房源结构转换为前端使用的结构
const transformHouseFromApi = (house: any) => {
  return {
    id: house.id,
    title: house.title,
    city: house.city ?? null,
    houseType: house.house_type ?? null,
    price: house.price,
    location: house.location,
    lng: house.lng != null ? Number(house.lng) : null,
    lat: house.lat != null ? Number(house.lat) : null,
    description: house.description,
    image: house.image,
    tags: typeof house.tags === 'string' && house.tags.length > 0
      ? house.tags.split(',').map((t: string) => t.trim())
      : [],
    area: house.area,
    floor: house.floor,
    orientation: house.orientation,
    ownerUserId:
      house.owner_user_id != null && house.owner_user_id !== ''
        ? Number(house.owner_user_id)
        : null,
    landlord: {
      id:
        house.owner_user_id != null && house.owner_user_id !== ''
          ? Number(house.owner_user_id)
          : house.landlord_id || null,
      name: house.landlord_name,
      avatar: house.landlord_avatar || 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: house.landlord_phone
    }
  }
}

// 获取房源列表 —— 调用后端 /houses
export const getHouseList = async (params: Partial<HouseQuery> = {}, signal?: AbortSignal) => {
  const query = new URLSearchParams(houseFiltersToQuery(params))
  const res = await request(`/houses?${query.toString()}`, { signal })
  if (res.success && res.data?.list) {
    const transformedList = res.data.list.map((h: any) => transformHouseFromApi(h))
    return {
      ...res,
      data: {
        ...res.data,
        list: transformedList
      }
    }
  }
  return res
}

// 根据ID获取房源详情 —— 调用后端 /houses/:id
export const getHouseDetail = async (id: number, signal?: AbortSignal) => {
  const res = await request(`/houses/${id}`, { signal })
  if (res.success && res.data) {
    return {
      ...res,
      data: transformHouseFromApi(res.data)
    }
  }
  return res
}

// 所有入口复用服务端组合条件与分页，不再一次拉取 1000 条后本地过滤。
export const searchHouses = (conditions: Partial<HouseQuery>, signal?: AbortSignal) => getHouseList(conditions, signal)

// 发布房源
export const publishHouse = async (payload: {
  city: string
  houseType: string
  title: string
  price: number
  location: string
  lng?: number | null
  lat?: number | null
  description?: string
  image?: string
  tags?: string[]
  area?: number
  floor?: string
  orientation?: string
  landlordName?: string
  landlordPhone?: string
}) => {
  return request('/houses', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export const getHouseCities = () => request('/houses/cities')

/** WebSocket 聊天地址（需在登录后调用） */
export const getChatWsUrl = (): string => {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  if (!userStore.isLoggedIn()) return ''
  return `${base}/ws/chat`
}

export const ensureChatConversation = async (payload: {
  peerUserId: number
  houseId?: number | null
}) => {
  return request('/chat/conversations', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export const fetchChatConversations = async () => {
  return request('/chat/conversations')
}

export const fetchChatMessages = async (
  conversationId: number,
  params?: { limit?: number; beforeId?: number },
  signal?: AbortSignal
) => {
  const q = new URLSearchParams()
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.beforeId) q.set('beforeId', String(params.beforeId))
  const qs = q.toString()
  return request(`/chat/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`, { signal })
}

/** 全部未读消息条数（首页「在线沟通」角标） */
export const fetchChatUnreadTotal = async () => {
  return request('/chat/unread-total')
}

/** 确认本页已展示到的消息，不把并发入库但尚未收到的内容提前标成已读。 */
export const markChatConversationRead = async (conversationId: number, lastReadMessageId: number) => {
  return request(`/chat/conversations/${conversationId}/read`, { method: 'POST', body: JSON.stringify({ lastReadMessageId }) })
}

// 获取当前用户收藏列表（后端 /favorites）
export const getUserFavorites = async () => {
  const res = await request('/favorites')
  if (res.success && Array.isArray(res.data)) {
    return {
      ...res,
      data: res.data.map((h: any) => transformHouseFromApi(h))
    }
  }
  return res
}

// 添加收藏（后端 /favorites/:houseId）
export const addFavorite = async (houseId: number) => {
  return request(`/favorites/${houseId}`, { method: 'POST' })
}

// 取消收藏（后端 /favorites/:houseId）
export const removeFavorite = async (houseId: number) => {
  return request(`/favorites/${houseId}`, { method: 'DELETE' })
}

// 检查是否已收藏（后端 /favorites/check/:houseId）
export const isFavorite = async (houseId: number) => {
  return request(`/favorites/check/${houseId}`)
}
