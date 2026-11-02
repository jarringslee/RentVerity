import type { AssistantEvent, ExecutionSummary } from '../types/assistant'
import { validateHouseFilters } from './houseFilters'

export class AssistantProtocolError extends Error { constructor() { super('助手事件顺序、关联标识或执行结果不一致；本轮不能视为完整成功。') } }
const invalid = (): never => { throw new AssistantProtocolError() }
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
const correlation = (data: any) => typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/.test(data.requestId) && (data.callId === null || typeof data.callId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.callId))
const filters = (value: any): boolean => value && typeof value.location === 'string' && Array.isArray(value.houseTypes) && !validateHouseFilters(value)
const key = (value: any) => JSON.stringify({ city: value?.city ?? null, location: value?.location ?? '', minPrice: value?.minPrice ?? null, maxPrice: value?.maxPrice ?? null, houseTypes: [...(value?.houseTypes ?? [])].sort() })
const queryStates = ['not_started', 'not_required', 'running', 'succeeded', 'failed']
const answerStates = ['not_started', 'streaming', 'succeeded', 'failed', 'cancelled']
function summary(data: any): boolean {
  return queryStates.includes(data.queryState) && answerStates.includes(data.answerState) && count(data.queryCount) && data.queryCount <= 1 && count(data.modelCalls) && data.modelCalls <= 3 && count(data.correctionCount) && data.correctionCount <= 1 && count(data.returned) && data.returned <= 6 && count(data.total) && data.returned <= data.total && count(data.elapsedMs) && count(data.queryDurationMs) && (data.errorCode === null || typeof data.errorCode === 'string')
}
export function parseAssistantEvent(event: string, data: any): AssistantEvent {
  if (!data || typeof data !== 'object' || !correlation(data)) invalid()
  if (event === 'start' && data.callId === null) return { event, data }
  if (event === 'status' && ['understanding', 'correcting', 'searching', 'responding'].includes(data.stage) && typeof data.message === 'string' && data.message.length <= 200) return { event, data }
  if (event === 'context' && ['house_search', 'rental_qa', 'out_of_scope', 'contract_review'].includes(data.intent) && (data.filters === null || filters(data.filters)) && typeof data.needsClarification === 'boolean') return { event, data }
  if (event === 'execution' && queryStates.includes(data.queryState) && count(data.queryCount) && data.queryCount <= 1 && count(data.returned) && data.returned <= 6 && count(data.total) && data.total >= data.returned && count(data.durationMs)) return { event, data }
  if (event === 'generation' && answerStates.includes(data.answerState)) return { event, data }
  if (event === 'delta' && typeof data.text === 'string' && data.text.length > 0 && data.text.length <= 12000) return { event, data }
  if (event === 'done' && data.complete === true && summary(data)) return { event, data }
  if (event === 'error' && summary(data) && typeof data.code === 'string' && typeof data.message === 'string' && typeof data.retainResults === 'boolean') return { event, data }
  if (event === 'houses' && filters(data.filters) && data.filters.city && count(data.total) && Array.isArray(data.list) && data.list.length <= 6 && data.list.length <= data.total && typeof data.notice === 'string' && Array.isArray(data.unavailablePreferences) && data.unavailablePreferences.length <= 6 && data.unavailablePreferences.every((v: unknown) => typeof v === 'string' && v.length <= 80)) {
    if (!data.list.every((row: any) => row && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.title === 'string' && typeof row.price === 'number' && Number.isFinite(row.price) && row.price >= 0 && typeof row.location === 'string' && typeof row.image === 'string' && (row.area === null || typeof row.area === 'number' && Number.isFinite(row.area)) && row.city === data.filters.city && (row.houseType === null || typeof row.houseType === 'string') && (!data.filters.houseTypes.length || data.filters.houseTypes.includes(row.houseType)) && (data.filters.minPrice == null || row.price >= data.filters.minPrice) && (data.filters.maxPrice == null || row.price <= data.filters.maxPrice) && Array.isArray(row.matchReasons) && row.matchReasons.every((v: unknown) => typeof v === 'string'))) invalid()
    if (new Set(data.list.map((row: any) => row.id)).size !== data.list.length) invalid()
    return { event, data }
  }
  return invalid()
}

// 只信执行器的状态与结果关联；不通过正文关键词推断“已查询”。
export class AssistantStreamGuard {
  private requestId: string | null = null
  private callId: string | null = null
  private context: Extract<AssistantEvent, { event: 'context' }>['data'] | null = null
  private queryState = 'not_started'
  private answerState = 'not_started'
  private houses = false
  private returned = 0
  private total = 0
  private characters = 0
  private ended = false
  accept(frame: AssistantEvent) {
    const { event, data } = frame
    if (this.ended) invalid()
    if (event === 'start') { if (this.requestId) invalid(); this.requestId = data.requestId; return }
    if (!this.requestId || data.requestId !== this.requestId) invalid()
    if (event === 'context') {
      if (this.context || !data.callId && !(data.intent === 'house_search' && data.needsClarification)) invalid()
      if (data.intent === 'house_search' ? !data.filters || !data.needsClarification && !data.filters.city : data.filters !== null || data.needsClarification) invalid()
      this.context = data; this.callId = data.callId; return
    }
    if (data.callId !== this.callId) invalid()
    if (event === 'status') {
      if (data.stage === 'searching' && (!this.context || this.context.intent !== 'house_search' || this.context.needsClarification || this.queryState !== 'not_started')) invalid()
      if (data.stage === 'responding' && !['not_required', 'succeeded'].includes(this.queryState)) invalid()
      if (['understanding', 'correcting'].includes(data.stage) && this.context) invalid()
      return
    }
    if (event === 'execution') {
      if (!this.context) invalid()
      const search = this.context.intent === 'house_search' && !this.context.needsClarification
      const next = data.queryState
      if (search) {
        if (data.queryCount !== 1 || !(this.queryState === 'not_started' && next === 'running' || this.queryState === 'running' && ['succeeded', 'failed'].includes(next))) invalid()
      } else if (this.queryState !== 'not_started' || next !== 'not_required' || data.queryCount !== 0) invalid()
      if (next !== 'succeeded' && (data.returned || data.total)) invalid()
      this.queryState = next; this.returned = data.returned; this.total = data.total; return
    }
    if (event === 'houses') {
      if (this.houses || !this.context || this.context.intent !== 'house_search' || this.context.needsClarification || this.queryState !== 'succeeded' || key(data.filters) !== key(this.context.filters) || data.list.length !== this.returned || data.total !== this.total) invalid()
      this.houses = true; return
    }
    if (event === 'generation') {
      if (data.answerState === 'streaming') {
        if (this.answerState !== 'not_started' || !this.context || !(this.queryState === 'not_required' || this.queryState === 'succeeded' && this.houses)) invalid()
      } else if (this.answerState !== 'streaming' || !['succeeded', 'failed'].includes(data.answerState) || data.answerState === 'succeeded' && !this.characters) invalid()
      this.answerState = data.answerState; return
    }
    if (event === 'delta') { if (this.answerState !== 'streaming') invalid(); this.characters += data.text.length; if (this.characters > 12000) invalid(); return }
    if (event === 'done' || event === 'error') {
      const search = this.context?.intent === 'house_search' && !this.context.needsClarification
      // 中止信号会禁止执行器继续发普通事件；终结错误可报告尚未发出的失败/取消转移。
      if (event === 'error' && ['REQUEST_CANCELLED', 'AUTH_EXPIRED', 'ASSISTANT_TIMEOUT'].includes(data.code)) {
        if (this.queryState === 'running' && data.queryState === 'failed') this.queryState = 'failed'
        if (this.answerState === 'streaming' && data.answerState === 'cancelled') this.answerState = 'cancelled'
      }
      if (data.queryState !== this.queryState || data.answerState !== this.answerState || data.queryCount !== (['running', 'succeeded', 'failed'].includes(this.queryState) ? 1 : 0) || data.returned !== this.returned || data.total !== this.total) invalid()
      if (event === 'done' && (!this.context || this.answerState !== 'succeeded' || !this.characters || search && (!this.houses || this.queryState !== 'succeeded') || !search && this.queryState !== 'not_required')) invalid()
      if (event === 'error' && (data.retainResults !== this.houses || this.queryState === 'succeeded' && !this.houses)) invalid()
      if (event === 'error' && data.errorCode !== data.code || event === 'done' && data.errorCode !== null) invalid()
      this.ended = true; return
    }
    invalid()
  }
}
