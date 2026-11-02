import type { HouseFilters } from './houses'
export type AssistantIntent = 'house_search' | 'rental_qa' | 'out_of_scope' | 'contract_review'
export type QueryState = 'not_started' | 'not_required' | 'running' | 'succeeded' | 'failed'
export type AnswerState = 'not_started' | 'streaming' | 'succeeded' | 'failed' | 'cancelled'
export interface Correlation { requestId: string; callId: string | null }
export interface ExecutionSummary extends Correlation {
  queryState: QueryState; answerState: AnswerState; queryCount: number; modelCalls: number; correctionCount: number
  returned: number; total: number; elapsedMs: number; queryDurationMs: number; errorCode: string | null
}
export interface AssistantHouse { id: number; title: string; price: number; city: string | null; houseType: string | null; area: number | null; location: string; image: string; matchReasons: string[] }
export interface AssistantSearchResult { filters: HouseFilters; total: number; list: AssistantHouse[]; notice: string; unavailablePreferences: string[] }
export interface AssistantMessage {
  id: string; role: 'user' | 'assistant'; content: string; intent?: AssistantIntent
  status: 'complete' | 'pending' | 'failed' | 'cancelled'; search?: AssistantSearchResult; filters?: HouseFilters
  requestId?: string; callId?: string | null; queryState?: QueryState; answerState?: AnswerState; needsClarification?: boolean
}
type Data<T> = T & Correlation
export type AssistantEvent =
  | { event: 'start'; data: Correlation }
  | { event: 'status'; data: Data<{ stage: 'understanding' | 'correcting' | 'searching' | 'responding'; message: string }> }
  | { event: 'context'; data: Data<{ intent: AssistantIntent; filters: HouseFilters | null; needsClarification: boolean }> }
  | { event: 'execution'; data: Data<{ queryState: QueryState; queryCount: number; returned: number; total: number; durationMs: number }> }
  | { event: 'generation'; data: Data<{ answerState: AnswerState }> }
  | { event: 'houses'; data: Data<AssistantSearchResult> }
  | { event: 'delta'; data: Data<{ text: string }> }
  | { event: 'done'; data: ExecutionSummary & { complete: true } }
  | { event: 'error'; data: ExecutionSummary & { code: string; message: string; retainResults: boolean } }
