import type { HouseFilters } from './houses'
export type AssistantIntent = 'house_search' | 'rental_qa' | 'out_of_scope' | 'contract_review'
export interface AssistantHouse { id: number; title: string; price: number; city: string | null; houseType: string | null; area: number | null; location: string; image: string; matchReasons: string[] }
export interface AssistantSearchResult { filters: HouseFilters; total: number; list: AssistantHouse[]; notice: string; unavailablePreferences: string[] }
export interface AssistantMessage {
  id: string; role: 'user' | 'assistant'; content: string; intent?: AssistantIntent
  status: 'complete' | 'pending' | 'failed' | 'cancelled'; search?: AssistantSearchResult; filters?: HouseFilters
}
export type AssistantEvent =
  | { event: 'status'; data: { stage: 'understanding' | 'searching' | 'responding'; message: string } }
  | { event: 'context'; data: { intent: AssistantIntent; filters: HouseFilters | null; needsClarification: boolean } }
  | { event: 'houses'; data: AssistantSearchResult }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { complete: true } }
