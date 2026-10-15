import type { HouseFilters } from './houses'
export type AssistantIntent = 'house_search' | 'rental_qa' | 'out_of_scope' | 'contract_review'
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  intent?: AssistantIntent
  status: 'complete' | 'pending' | 'failed' | 'cancelled'
}
export interface AssistantReply { intent: AssistantIntent; reply: string; filters: HouseFilters | null; needsClarification: boolean }
export interface AssistantHouse { id: number; title: string; price: number; location: string; description: string; image: string; matchReasons: string[] }
export interface AssistantSearchResult { filters: HouseFilters; total: number; list: AssistantHouse[]; notice: string }
