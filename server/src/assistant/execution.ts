import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError';
import type { AssistantEvent, AssistantSearchResult, EmitAssistant, ExecutionSummary } from './protocol';

export type AssistantAudit = (record: ExecutionSummary & { stage: string }) => void;
export class AssistantExecutionError extends AppError {
  constructor(status: number, code: string, message: string, public summary: ExecutionSummary) { super(status, code, message); }
}
// 一轮请求内的权威记录。正文不参与状态判断，所有纠错完成后才进入唯一查询入口。
export class AssistantExecution {
  private readonly since = Date.now();
  private querySince = 0;
  private result?: AssistantSearchResult;
  private state: Omit<ExecutionSummary, 'elapsedMs'> = {
    requestId: randomUUID(), callId: null, queryState: 'not_started', answerState: 'not_started',
    queryCount: 0, modelCalls: 0, correctionCount: 0, returned: 0, total: 0, queryDurationMs: 0, errorCode: null
  };
  constructor(private emit: EmitAssistant, private signal: AbortSignal, private assertIdentity: () => void = () => {}, private audit: AssistantAudit = record => console.info(JSON.stringify({ tag: 'assistant_execution', ...record }))) {}
  active() { this.signal.throwIfAborted(); this.assertIdentity(); }
  snapshot(): ExecutionSummary { return { ...this.state, elapsedMs: Date.now() - this.since }; }
  trace(stage: string, errorCode?: string) { try { this.audit({ ...this.snapshot(), ...(errorCode ? { errorCode } : {}), stage }); } catch { /* 日志故障不能触发重复执行。 */ } }
  async send(event: AssistantEvent['event'], data: Record<string, unknown> = {}) {
    this.active();
    await this.emit({ event, data: { ...data, requestId: this.state.requestId, callId: this.state.callId } } as AssistantEvent);
  }
  async start() { await this.send('start'); this.trace('started'); }
  modelCall() { this.active(); this.state.modelCalls++; }
  correct(code: string) { this.active(); if (this.state.correctionCount || this.state.queryCount) throw new AppError(502, 'AI_CORRECTION_LIMIT', '本轮纠错已结束，未重复查询。'); this.state.correctionCount++; this.trace('correcting', code); }
  select(callId: string) { this.active(); this.state.callId = callId; this.trace('selected'); }
  async noQuery() { this.state.queryState = 'not_required'; await this.queryEvent(); }
  private async queryEvent() { await this.send('execution', { queryState: this.state.queryState, queryCount: this.state.queryCount, returned: this.state.returned, total: this.state.total, durationMs: this.state.queryDurationMs }); }
  async query(run: () => Promise<AssistantSearchResult>) {
    this.active();
    if (this.state.queryCount || this.state.queryState !== 'not_started') throw new AppError(502, 'QUERY_ALREADY_EXECUTED', '同一轮只能执行一次查询。');
    this.state.queryCount = 1; this.state.queryState = 'running'; this.querySince = Date.now();
    this.trace('query_started');
    try {
      // 紧邻计数同步进入仓库，避免等待 SSE 背压时取消导致“计数1、实际调用0”。
      // SQL 已开始后即使连接中断也不重新执行；预挂 rejection handler 防止输出故障掩盖未处理拒绝。
      const work = run(); void work.catch(() => {});
      await this.queryEvent();
      const result = await work; this.active();
      this.result = result; this.state.queryState = 'succeeded'; this.state.returned = result.list.length; this.state.total = result.total;
      this.state.queryDurationMs = Date.now() - this.querySince;
      await this.queryEvent(); await this.send('houses', result as unknown as Record<string, unknown>); this.trace('query_succeeded');
      return result;
    } catch (error) {
      if (this.state.queryState === 'succeeded') throw error;
      this.state.queryState = 'failed'; this.state.queryDurationMs = Date.now() - this.querySince;
      this.state.errorCode = error instanceof AppError ? error.code : 'HOUSE_QUERY_FAILED';
      this.trace('query_failed');
      if (!this.signal.aborted) await this.queryEvent();
      throw error instanceof AppError ? error : new AppError(503, 'HOUSE_QUERY_FAILED', '房源查询失败，未返回房源卡片，请稍后手动重试。');
    }
  }
  async generating() { this.active(); this.state.answerState = 'streaming'; await this.send('generation', { answerState: 'streaming' }); }
  async complete() {
    this.active();
    if (this.state.queryState === 'running' || this.state.queryState === 'not_started' || this.state.queryState === 'failed' || this.state.answerState !== 'streaming') throw new AppError(502, 'EXECUTION_INCOMPLETE', '执行结果尚未确认，不能完成本轮。');
    this.state.answerState = 'succeeded'; await this.send('generation', { answerState: 'succeeded' });
    await this.send('done', { ...this.snapshot(), complete: true }); this.trace('completed');
    return this.snapshot();
  }
  async fail(error: unknown): Promise<AssistantExecutionError> {
    const known = error instanceof AppError;
    const cancelled = this.signal.aborted;
    const code = cancelled ? (this.signal.reason instanceof AppError ? this.signal.reason.code : this.signal.reason?.name === 'TimeoutError' ? 'ASSISTANT_TIMEOUT' : 'REQUEST_CANCELLED') : known ? error.code : 'ASSISTANT_ERROR';
    const message = cancelled ? '请求已停止或身份已失效。' : this.result ? '房源查询已完成，卡片已保留；说明生成失败。本轮不会自动重新查询。' : known ? error.message : '本轮处理失败，请手动重试。';
    this.state.errorCode = code;
    if (this.state.answerState === 'streaming') {
      this.state.answerState = cancelled ? 'cancelled' : 'failed';
      if (!cancelled) { try { await this.send('generation', { answerState: 'failed' }); } catch {} }
    }
    this.trace(cancelled ? 'cancelled' : 'failed');
    return new AssistantExecutionError(known ? error.status : 502, code, message, this.snapshot());
  }
}
