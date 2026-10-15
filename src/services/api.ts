// 模拟API服务（逐步切到真实后端）
import userStore from '../stores/userStore'
import type { HouseQuery } from '../types/houses'
import { houseFiltersToQuery } from '../utils/houseFilters'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// 公共请求封装
const request = async (path: string, options: RequestInit = {}) => {
  const token = userStore.getToken?.()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  })
  return res.json()
}

// 本地模拟房源数据（暂用于聊天、收藏等未接后端的功能）
const houses = [
  {
    id: 1,
    title: '高新区温馨一居室',
    price: 2800,
    location: '西安市高新区xxx小区',
    description: '近地铁站，交通便利，家具齐全，适合单身或情侣居住',
    image: '/images/houses/house-1.jpg',
    tags: ['近地铁', '精装修', '拎包入住'],
    riskLevel: 'low',
    area: 60,
    floor: '5/12层',
    orientation: '朝南',
    landlord: {
      id: 101,
      name: '张房东',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138101'
    }
  },
  {
    id: 2,
    title: '曲江新区学区房两居室',
    price: 4800,
    location: '西安市曲江新区xxx小区',
    description: '重点学区房，周边配套设施齐全，临近公园，环境优美',
    image: '/images/houses/house-2.jpg',
    tags: ['学区房', '安静', '采光好'],
    riskLevel: 'medium',
    area: 85,
    floor: '8/18层',
    orientation: '南北通透',
    landlord: {
      id: 102,
      name: '李经理',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138102'
    }
  },
  {
    id: 3,
    title: '浐灞生态区市中心合租房',
    price: 1800,
    location: '西安市浐灞生态区xxx小区',
    description: '市中心位置，交通方便，室友nice，公共设施完善',
    image: '/images/houses/house-3.jpg',
    tags: ['市中心', '合租', '生活便利'],
    riskLevel: 'high',
    area: 25,
    floor: '3/6层',
    orientation: '朝东',
    landlord: {
      id: 103,
      name: '王客户',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138103'
    }
  },
  {
    id: 4,
    title: '雁塔区文化区四合院',
    price: 4200,
    location: '西安市雁塔区xxx胡同',
    description: '传统四合院改造，保留老西安特色，交通便利，周边文化底蕴深厚',
    image: '/images/houses/house-4.jpg',
    tags: ['四合院', '文化氛围', '独门独院'],
    riskLevel: 'medium',
    area: 70,
    floor: '1/1层',
    orientation: '朝南',
    landlord: {
      id: 104,
      name: '赵老板',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138104'
    }
  },
  {
    id: 5,
    title: '未央区高端公寓两居室',
    price: 3600,
    location: '西安市未央区xxx小区',
    description: '现代化装修，配备全套家电家具，靠近商业中心，生活便利',
    image: '/images/houses/house-1.jpg',
    tags: ['高端公寓', '现代化', '商业中心'],
    riskLevel: 'low',
    area: 90,
    floor: '15/24层',
    orientation: '朝南',
    landlord: {
      id: 105,
      name: '陈经理',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138105'
    }
  },
  {
    id: 6,
    title: '长安区舒适三居室',
    price: 3200,
    location: '西安市长安区xxx小区',
    description: '宽敞明亮的三居室，适合家庭居住，小区环境优美，绿化覆盖率高',
    image: '/images/houses/house-2.jpg',
    tags: ['家庭房', '绿化好', '宽敞'],
    riskLevel: 'low',
    area: 110,
    floor: '6/12层',
    orientation: '南北通透',
    landlord: {
      id: 106,
      name: '刘房东',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138106'
    }
  },
  {
    id: 7,
    title: '高新区现代简约一居室',
    price: 3100,
    location: '西安市高新区yyy小区',
    description: '全新装修，简约风格，配备智能家居系统，拎包入住',
    image: '/images/houses/house-3.jpg',
    tags: ['智能家居', '拎包入住', '近地铁'],
    riskLevel: 'low',
    area: 65,
    floor: '12/18层',
    orientation: '朝南',
    landlord: {
      id: 107,
      name: '王房东',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138107'
    }
  },
  {
    id: 8,
    title: '曲江新区豪华复式公寓',
    price: 6500,
    location: '西安市曲江新区yyy小区',
    description: '高端复式公寓，视野开阔，可俯瞰曲江全景，配备高端家电',
    image: '/images/houses/house-4.jpg',
    tags: ['复式', '景观房', '高端'],
    riskLevel: 'low',
    area: 120,
    floor: '2/2层',
    orientation: '南北通透',
    landlord: {
      id: 108,
      name: '李总',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138108'
    }
  },
  {
    id: 9,
    title: '浐灞生态区湖景房',
    price: 5200,
    location: '西安市浐灞生态区yyy小区',
    description: '一线湖景房，环境优美，空气清新，适合养生居住',
    image: '/images/houses/house-1.jpg',
    tags: ['湖景房', '生态环境', '安静'],
    riskLevel: 'low',
    area: 95,
    floor: '8/16层',
    orientation: '朝南',
    landlord: {
      id: 109,
      name: '张经理',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138109'
    }
  },
  {
    id: 10,
    title: '雁塔区学区房',
    price: 4300,
    location: '西安市雁塔区yyy小区',
    description: '临近名校，教育资源丰富，小区成熟，配套完善',
    image: '/images/houses/house-2.jpg',
    tags: ['学区房', '成熟社区', '配套完善'],
    riskLevel: 'medium',
    area: 80,
    floor: '5/12层',
    orientation: '朝东',
    landlord: {
      id: 110,
      name: '赵女士',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138110'
    }
  },
  {
    id: 11,
    title: '未央区地铁房',
    price: 2900,
    location: '西安市未央区yyy小区',
    description: '地铁口房源，交通便利，周边商圈成熟，生活便捷',
    image: '/images/houses/house-3.jpg',
    tags: ['地铁房', '交通便利', '商圈成熟'],
    riskLevel: 'low',
    area: 70,
    floor: '3/15层',
    orientation: '朝南',
    landlord: {
      id: 111,
      name: '陈先生',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138111'
    }
  },
  {
    id: 12,
    title: '长安区温馨两居室',
    price: 2600,
    location: '西安市长安区yyy小区',
    description: '温馨舒适的两居室，适合小家庭居住，小区绿化率高',
    image: '/images/houses/house-4.jpg',
    tags: ['温馨', '绿化率高', '小家庭'],
    riskLevel: 'low',
    area: 85,
    floor: '9/12层',
    orientation: '南北通透',
    landlord: {
      id: 112,
      name: '刘女士',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138112'
    }
  },
  {
    id: 13,
    title: '高新区科技人才公寓',
    price: 3800,
    location: '西安市高新区zzz小区',
    description: '专为科技人才打造的高品质公寓，配备共享办公空间',
    image: '/images/houses/house-1.jpg',
    tags: ['人才公寓', '共享办公', '高品质'],
    riskLevel: 'low',
    area: 75,
    floor: '18/24层',
    orientation: '朝南',
    landlord: {
      id: 113,
      name: '高经理',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138113'
    }
  },
  {
    id: 14,
    title: '曲江新区文化主题公寓',
    price: 4600,
    location: '西安市曲江新区zzz小区',
    description: '以大唐文化为主题的精装公寓，充满文化气息',
    image: '/images/houses/house-2.jpg',
    tags: ['文化主题', '精装', '大唐风格'],
    riskLevel: 'medium',
    area: 88,
    floor: '6/12层',
    orientation: '朝东',
    landlord: {
      id: 114,
      name: '孙经理',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138114'
    }
  },
  {
    id: 15,
    title: '浐灞生态区生态别墅',
    price: 12000,
    location: '西安市浐灞生态区zzz小区',
    description: '独栋别墅，私密性好，拥有独立花园和车库',
    image: '/images/houses/house-3.jpg',
    tags: ['独栋别墅', '私密性好', '带花园'],
    riskLevel: 'low',
    area: 220,
    floor: '3/3层',
    orientation: '南北通透',
    landlord: {
      id: 115,
      name: '何总',
      avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
      phone: '13800138115'
    }
  }
]

// 模拟延时函数（仅供本地模拟用）
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
    price: house.price,
    location: house.location,
    lng: house.lng != null ? Number(house.lng) : null,
    lat: house.lat != null ? Number(house.lat) : null,
    description: house.description,
    image: house.image,
    tags: typeof house.tags === 'string' && house.tags.length > 0
      ? house.tags.split(',').map((t: string) => t.trim())
      : [],
    riskLevel: house.risk_level || house.riskLevel || 'low',
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
export const getHouseDetail = async (id: number) => {
  const res = await request(`/houses/${id}`)
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
  title: string
  price: number
  location: string
  lng?: number | null
  lat?: number | null
  description?: string
  image?: string
  tags?: string[]
  riskLevel?: string
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
