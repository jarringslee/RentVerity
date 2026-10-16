export interface ChatMessage {
  id: number
  conversation_id: number
  sender_id: number
  content: string
  createdAt: string
}
export const CHAT_PAGE_SIZE = 50
export const CHAT_RENDER_LIMIT = 500

// HTTP 历史和 WS 实时回包可能重叠/乱序，统一按持久化 ID 去重、排序。
export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map<number, ChatMessage>()
  for (const message of [...current, ...incoming]) {
    if (Number.isSafeInteger(message.id) && message.id > 0) unique.set(message.id, message)
  }
  return [...unique.values()].sort((a, b) => a.id - b.id).slice(-CHAT_RENDER_LIMIT)
}

export function parseChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: Number(row.id), conversation_id: Number(row.conversation_id), sender_id: Number(row.sender_id),
    content: String(row.content ?? ''), createdAt: String(row.created_at ?? '')
  }
}
