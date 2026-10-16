import type { AssistantMessage } from '../types/assistant'
import { emptyHouseFilters, HOUSE_TYPES, type HouseFilters, type HouseType } from '../types/houses'
import { cloneHouseFilters, validateHouseFilters } from './houseFilters'
const key = (userId: number) => `rentverity_assistant_${userId}`
export function assistantHistory(messages: AssistantMessage[]) {
  const result: { role: 'user' | 'assistant'; content: string }[] = []
  let characters = 0
  for (const message of messages.filter(item => item.status === 'complete').slice(-12).reverse()) {
    const content = message.content.slice(0, message.role === 'assistant' ? 3000 : 1500)
    if (characters + content.length > 12000) break
    result.unshift({ role: message.role, content }); characters += content.length
  }
  return result
}
export function readAssistantSession(userId: number): { messages: AssistantMessage[]; filters: HouseFilters } {
  const empty = { messages: [], filters: emptyHouseFilters() }
  if (!userId) return empty
  try {
    const raw = sessionStorage.getItem(key(userId)); if (!raw || raw.length > 120000) return empty
    const saved = JSON.parse(raw)
    if (saved.version !== 2 || !Array.isArray(saved.messages)) return empty
    const messages: AssistantMessage[] = saved.messages.slice(-12).filter((item: AssistantMessage) => item && typeof item.id === 'string' && ['user', 'assistant'].includes(item.role) && item.status === 'complete' && typeof item.content === 'string' && item.content.length <= 12000).map((item: AssistantMessage) => ({ id: item.id, role: item.role, content: item.content, status: 'complete' }))
    const source = saved.filters
    const filters: HouseFilters = { ...(typeof source?.city === 'string' ? { city: source.city.slice(0, 64) } : {}), location: typeof source?.location === 'string' ? source.location.slice(0, 80) : '', minPrice: typeof source?.minPrice === 'number' ? source.minPrice : undefined, maxPrice: typeof source?.maxPrice === 'number' ? source.maxPrice : undefined, houseTypes: Array.isArray(source?.houseTypes) ? source.houseTypes.filter((type: HouseType) => HOUSE_TYPES.includes(type)).slice(0, 4) : [] }
    return { messages, filters: validateHouseFilters(filters) ? emptyHouseFilters() : filters }
  } catch { return empty }
}
export function saveAssistantSession(userId: number, messages: AssistantMessage[], filters: HouseFilters) {
  if (!userId) return
  try {
    const completed = messages.filter(item => item.status === 'complete').slice(-12).map(({ id, role, content }) => ({ id, role, content, status: 'complete' }))
    // 不缓存房源卡片，刷新后不把旧库存冒充当前查询；不在每个 token 到达时写存储。
    sessionStorage.setItem(key(userId), JSON.stringify({ version: 2, messages: completed, filters: validateHouseFilters(filters) ? emptyHouseFilters() : cloneHouseFilters(filters) }))
  } catch { /* 存储禁用/配额不足时仍可使用当前页。 */ }
}
export function clearAssistantSession(userId: number) { try { sessionStorage.removeItem(key(userId)) } catch { /* ignore */ } }
