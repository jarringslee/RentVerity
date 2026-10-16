// 真实后端 API；不回退到本地房源夹具。
import userStore from '../stores/userStore'
import type { HouseQuery } from '../types/houses'
import { houseFiltersToQuery } from '../utils/houseFilters'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// 公共请求封装
const request = async (path: string, options: RequestInit = {}) => {
  const isAuthRequest = path === '/auth/login' || path === '/auth/register'
  const token = isAuthRequest ? null : userStore.getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })
  if (res.status === 401 && !isAuthRequest) userStore.expireSession(token)
  const payload = await res.json().catch(() => null)
  return payload ?? { success: false, message: res.status === 401 ? '登录已过期，请重新登录。' : '服务端返回异常，请稍后重试。' }
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

/** 上传头像（multipart 字段 avatar）；可用 tokenOverride 在注册成功后立即上传 */
export const uploadUserAvatar = async (file: File, tokenOverride?: string | null) => {
  const token = tokenOverride ?? userStore.getToken?.()
  const form = new FormData()
  form.append('avatar', file)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE_URL}/users/me/avatar`, {
    method: 'POST',
    headers,
    body: form
  })
  if (res.status === 401) userStore.expireSession(token)
  return res.json()
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
  const token = userStore.getToken?.()
  if (!token) return ''
  return `${base}/ws/chat?token=${encodeURIComponent(token)}`
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
  params?: { limit?: number; beforeId?: number }
) => {
  const q = new URLSearchParams()
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.beforeId) q.set('beforeId', String(params.beforeId))
  const qs = q.toString()
  return request(`/chat/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`)
}

/** 全部未读消息条数（首页「在线沟通」角标） */
export const fetchChatUnreadTotal = async () => {
  return request('/chat/unread-total')
}

/** 将会话标记为已读到最新消息 */
export const markChatConversationRead = async (conversationId: number) => {
  return request(`/chat/conversations/${conversationId}/read`, { method: 'POST' })
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
