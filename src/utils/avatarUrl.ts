const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

/** 前端默认头像（未上传或已清除） */
export const DEFAULT_AVATAR_PATH = '/images/default-avatar.svg'

/**
 * 将用户 avatarUrl（库内相对路径或完整 URL）转为 <img src>
 */
export function resolveAvatarSrc(avatarUrl: string | null | undefined): string {
  if (!avatarUrl || !String(avatarUrl).trim()) return DEFAULT_AVATAR_PATH
  const u = String(avatarUrl).trim()
  if (u.startsWith('blob:')) return u
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/uploads/')) return `${API_BASE_URL}${u}`
  if (u.startsWith('/')) return u
  return `${API_BASE_URL}/${u.replace(/^\//, '')}`
}
