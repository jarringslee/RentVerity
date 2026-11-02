import { AppError } from '../utils/AppError';
import { completeConfiguredJson, type CompleteJson } from '../services/modelClient';
import { readContractLimits, type ContractLimits } from './limits';
import { ContractTempStorage } from './tempStorage';
import { IsolatedPdfParser } from './isolatedParser';
import { ContractUploadGate } from './uploadGate';
import { buildChunkMessages, mergeChunkResults, splitContract, verifyChunkResult, type ContractChunk, type SourceSegment } from './chunks';
import { Semaphore } from './semaphore';
import type { ContractAnalysis } from './analysis';

export type TaskState = 'receiving' | 'queued' | 'parsing' | 'analyzing' | 'partial' | 'completed' | 'failed' | 'cancelled';
export interface ContractTask {
  id: string; userId: number; filename: string; state: TaskState; createdAt: number; expiresAt: number;
  declaredBytes: number; receivedBytes: number; pageCount: number; characterCount: number;
  files: { directory: string; incoming: string; pdf: string; output: string }; cleanupPending: boolean;
  controller: AbortController; release: () => void; timer?: ReturnType<typeof setTimeout>; work?: Promise<void>;
  uploadDone: Promise<void>; finishUpload: () => void;
  shared: SourceSegment[]; chunks: ContractChunk[]; result?: ContractAnalysis; errorCode: string | null;
  modelCalls: number; retries: number; manualRetries: number; elapsedMs: number; inputMaxCharacters: number;
  baselineRssBytes: number; peakRssBytes: number; parseMs: number; sessionExpiresAt: number;
}
const activeStates: TaskState[] = ['receiving', 'queued', 'parsing', 'analyzing'];
const retryable = new Set(['AI_TIMEOUT', 'AI_NETWORK_ERROR', 'AI_SERVICE_ERROR', 'AI_RATE_LIMIT', 'AI_TRUNCATED', 'AI_INVALID_JSON', 'AI_INVALID_SCHEMA']);
export class ContractTaskManager {
  readonly limits: ContractLimits; readonly storage: ContractTempStorage;
  private tasks = new Map<string, ContractTask>();
  private admissions = new Set<string>();
  private parser: Pick<IsolatedPdfParser, 'parse'>; private gate: ContractUploadGate; private model: CompleteJson;
  private modelSlots: Semaphore; private sweepTimer: ReturnType<typeof setInterval>; private sampleTimer: ReturnType<typeof setInterval>;
  constructor(options: { limits?: ContractLimits; storage?: ContractTempStorage; parser?: Pick<IsolatedPdfParser, 'parse'>; model?: CompleteJson; gate?: ContractUploadGate; now?: () => number; audit?: (record: Record<string, unknown>) => void } = {}) {
    this.limits = options.limits ?? readContractLimits(); this.storage = options.storage ?? new ContractTempStorage(this.limits);
    this.parser = options.parser ?? new IsolatedPdfParser(this.limits); this.model = options.model ?? completeConfiguredJson; this.gate = options.gate ?? new ContractUploadGate();
    this.now = options.now ?? Date.now; this.audit = options.audit ?? (record => console.info(JSON.stringify({ tag: 'contract_task', ...record })));
    this.modelSlots = new Semaphore(this.limits.blockConcurrency);
    this.sweepTimer = setInterval(() => { void this.sweep().catch(() => {}); }, 30000); this.sweepTimer.unref();
    this.sampleTimer = setInterval(() => { const rss = process.memoryUsage().rss; for (const task of this.tasks.values()) if (activeStates.includes(task.state)) task.peakRssBytes = Math.max(task.peakRssBytes, rss); }, 50); this.sampleTimer.unref();
  }
  private now: () => number; private audit: (record: Record<string, unknown>) => void;
  private trace(task: ContractTask, stage: string, block?: ContractChunk) {
    try { this.audit({ taskId: task.id, stage, state: task.state, blockId: block?.id, blockState: block?.state, blockElapsedMs: block?.elapsedMs, attempts: block?.attempts, elapsedMs: this.now() - task.createdAt, receivedBytes: task.receivedBytes, pageCount: task.pageCount, characterCount: task.characterCount, blocks: task.chunks.length, modelCalls: task.modelCalls, retries: task.retries, errorCode: block?.errorCode ?? task.errorCode, inputCharacters: block?.inputCharacters ?? task.inputMaxCharacters, peakRssBytes: task.peakRssBytes }); } catch {}
  }
  async create(userId: number, ip: string, id: string, size: number, sessionExpiresAt: number) {
    const release = this.gate.acquire(userId, ip);
    let admitted = false;
    try {
      if (this.tasks.has(id) || this.admissions.has(id)) throw new AppError(409, 'TASK_ID_EXISTS', '该任务标识已使用，请重新发起。');
      if ([...this.tasks.values()].filter(t => t.userId === userId).length >= 2 || this.tasks.size + this.admissions.size >= 64) throw new AppError(429, 'CONTRACT_CAPACITY', '临时任务数量达到上限，请先清除旧任务。');
      this.admissions.add(id); admitted = true;
      await this.initialize();
      const files = await this.storage.reserve(id, size);
      let finishUpload!: () => void; const uploadDone = new Promise<void>(resolve => { finishUpload = resolve; });
      const memory = process.memoryUsage().rss;
      const task: ContractTask = { id, userId, filename: '', state: 'receiving', createdAt: this.now(), expiresAt: this.now() + this.limits.ttlMs, declaredBytes: size, receivedBytes: 0, pageCount: 0, characterCount: 0, files, cleanupPending: true, controller: new AbortController(), release, uploadDone, finishUpload, shared: [], chunks: [], errorCode: null, modelCalls: 0, retries: 0, manualRetries: 0, elapsedMs: 0, inputMaxCharacters: 0, baselineRssBytes: memory, peakRssBytes: memory, parseMs: 0, sessionExpiresAt };
      this.tasks.set(id, task); this.arm(task); this.trace(task, 'admitted'); return task;
    } catch (error) { release(); throw error; }
    finally { if (admitted) this.admissions.delete(id); }
  }
  private arm(task: ContractTask) {
    const remaining = Math.min(task.createdAt + this.limits.taskTimeoutMs, task.sessionExpiresAt) - this.now();
    task.timer = setTimeout(() => { void this.cancelTask(task, task.sessionExpiresAt <= this.now() ? 'AUTH_EXPIRED' : 'CONTRACT_TIMEOUT'); }, Math.max(1, remaining)); task.timer.unref();
  }
  get(id: string, userId: number) {
    const task = this.tasks.get(id);
    if (!task || task.userId !== userId || task.expiresAt <= this.now()) throw new AppError(404, 'CONTRACT_NOT_FOUND', '任务不存在或已过期，请重新选择文件。');
    return task;
  }
  async rejectUpload(task: ContractTask, error: unknown) {
    task.finishUpload();
    task.errorCode = task.controller.signal.aborted ? (task.controller.signal.reason as AppError)?.code ?? 'REQUEST_CANCELLED' : error instanceof AppError ? error.code : 'UPLOAD_FAILED';
    task.state = task.controller.signal.aborted ? 'cancelled' : 'failed';
    await this.finish(task);
  }
  accept(task: ContractTask, filename: string) {
    task.filename = filename; task.finishUpload(); task.state = 'queued'; task.work = this.process(task);
  }
  private async cleanup(task: ContractTask) {
    if (!task.cleanupPending) return;
    try { await this.storage.cleanup(task.id); task.cleanupPending = false; } catch { this.trace(task, 'cleanup_pending'); }
  }
  private async finish(task: ContractTask) {
    clearTimeout(task.timer); task.elapsedMs = this.now() - task.createdAt;
    await this.cleanup(task); task.release(); task.expiresAt = this.now() + this.limits.ttlMs;
    if (task.state === 'completed' || task.state === 'cancelled') { task.shared = []; for (const chunk of task.chunks) { chunk.segments = chunk.segments.map(s => ({ ...s, text: '' })); chunk.result = undefined; } }
    this.trace(task, 'finished');
  }
  private async process(task: ContractTask, retry = false) {
    const signal = task.controller.signal;
    try {
      if (!retry) {
        task.state = 'parsing'; this.trace(task, 'parse_started'); const since = this.now();
        const parsed = await this.parser.parse(task.files.pdf, task.files.output, signal); signal.throwIfAborted();
        task.parseMs = this.now() - since; task.pageCount = parsed.pageCount; task.characterCount = parsed.characterCount;
        const split = splitContract(parsed.pages, this.limits); task.chunks = split.chunks; task.shared = split.shared;
        await this.cleanup(task); // 原文件和解析中间产物立即回收，后续仅持有有界文本块。
      }
      task.state = 'analyzing'; this.trace(task, 'analysis_started');
      const pending = task.chunks.filter(chunk => chunk.state !== 'succeeded');
      let cursor = 0;
      const worker = async () => { while (cursor < pending.length) { signal.throwIfAborted(); const chunk = pending[cursor++]; await this.analyzeChunk(task, chunk); } };
      const outcomes = await Promise.allSettled(Array.from({ length: Math.min(this.limits.blockConcurrency, pending.length) }, worker));
      signal.throwIfAborted();
      const failure = outcomes.find(outcome => outcome.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
      const complete = task.chunks.length > 0 && task.chunks.every(chunk => chunk.state === 'succeeded');
      task.result = mergeChunkResults(task.chunks, complete);
      task.state = complete ? 'completed' : task.chunks.some(chunk => chunk.state === 'succeeded') ? 'partial' : 'failed';
      task.errorCode = complete ? null : 'CONTRACT_INCOMPLETE';
    } catch (error) {
      task.state = signal.aborted ? 'cancelled' : 'failed';
      task.errorCode = signal.aborted ? (signal.reason as AppError)?.code ?? 'REQUEST_CANCELLED' : error instanceof AppError ? error.code : 'CONTRACT_ERROR';
      if (task.chunks.some(chunk => chunk.state === 'succeeded')) task.result = mergeChunkResults(task.chunks, false);
    } finally { await this.finish(task); }
  }
  private async analyzeChunk(task: ContractTask, chunk: ContractChunk) {
    const signal = task.controller.signal;
    for (let attempt = 0; attempt <= this.limits.blockRetries; attempt++) {
      signal.throwIfAborted();
      const release = await this.modelSlots.acquire(signal), since = this.now();
      try {
        signal.throwIfAborted();
        if (task.modelCalls >= this.limits.maxCalls) throw new AppError(413, 'CONTRACT_CALL_LIMIT', '本任务模型调用预算已用尽。');
        const messages = buildChunkMessages(chunk, task.shared);
        chunk.inputCharacters = messages.reduce((n, message) => n + message.content.length, 0);
        if (chunk.inputCharacters > this.limits.maxInputCharacters) throw new AppError(413, 'CHUNK_INPUT_LIMIT', '单块输入超过预算。');
        task.inputMaxCharacters = Math.max(task.inputMaxCharacters, chunk.inputCharacters);
        chunk.state = 'running'; chunk.errorCode = null; chunk.attempts++; task.modelCalls++; if (chunk.attempts > 1) task.retries++;
        this.trace(task, 'block_started', chunk);
        const raw = await this.model(messages, signal, { maxOutputTokens: this.limits.outputTokens }); signal.throwIfAborted();
        chunk.result = verifyChunkResult(raw, chunk); chunk.state = 'succeeded'; chunk.elapsedMs += this.now() - since;
        this.trace(task, 'block_succeeded', chunk); return;
      } catch (error) {
        chunk.elapsedMs += this.now() - since; chunk.state = 'failed'; chunk.errorCode = error instanceof AppError ? error.code : signal.aborted ? 'REQUEST_CANCELLED' : 'AI_ERROR';
        this.trace(task, 'block_failed', chunk);
        if (signal.aborted) throw error;
        if (attempt >= this.limits.blockRetries || !retryable.has(chunk.errorCode)) return;
      } finally { release(); }
      await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 250); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
    }
  }
  async retry(id: string, userId: number, ip: string) {
    const task = this.get(id, userId);
    if (task.state === 'completed') return task;
    if (!['partial', 'failed'].includes(task.state) || !task.chunks.length || task.manualRetries >= 1 || task.modelCalls >= this.limits.maxCalls || this.now() >= task.createdAt + this.limits.taskTimeoutMs || this.now() >= task.sessionExpiresAt) throw new AppError(409, 'CONTRACT_RETRY_UNAVAILABLE', '当前任务不能继续重试，请重新选择文件。');
    task.release = this.gate.acquire(userId, ip); task.manualRetries++; task.errorCode = null;
    task.controller = new AbortController(); this.arm(task); task.state = 'queued'; task.work = this.process(task, true); return task;
  }
  private async cancelTask(task: ContractTask, code = 'REQUEST_CANCELLED') {
    if (!activeStates.includes(task.state)) { await this.cleanup(task); return; }
    task.controller.abort(new AppError(499, code, '合同任务已停止。'));
    await task.uploadDone; if (task.work) await task.work;
  }
  async remove(id: string, userId: number) {
    const task = this.tasks.get(id); if (!task || task.userId !== userId) return;
    await this.cancelTask(task); await this.cleanup(task);
    if (!task.cleanupPending) this.tasks.delete(id);
  }
  snapshot(task: ContractTask) {
    return { taskId: task.id, filename: task.filename, state: task.state, byteLength: task.declaredBytes, receivedBytes: task.receivedBytes, pageCount: task.pageCount, characterCount: task.characterCount, expiresAt: new Date(task.expiresAt).toISOString(), errorCode: task.errorCode, cleanupPending: task.cleanupPending,
      chunks: task.chunks.map(({ id, state, attempts, inputCharacters, elapsedMs, errorCode, segments }) => ({ id, state, attempts, inputCharacters, elapsedMs, errorCode, sources: segments.map(({ page, start, end, overlap }) => ({ page, start, end, overlap: !!overlap })) })),
      stats: { modelCalls: task.modelCalls, retries: task.retries, manualRetries: task.manualRetries, elapsedMs: activeStates.includes(task.state) ? this.now() - task.createdAt : task.elapsedMs, inputMaxCharacters: task.inputMaxCharacters, parseMs: task.parseMs, baselineRssBytes: task.baselineRssBytes, peakRssBytes: task.peakRssBytes }, result: task.result ?? null };
  }
  async sweep() {
    for (const task of this.tasks.values()) {
      if (task.expiresAt <= this.now()) await this.remove(task.id, task.userId);
      else if (!activeStates.includes(task.state) && task.cleanupPending) await this.cleanup(task);
    }
  }
  async close() {
    clearInterval(this.sweepTimer); clearInterval(this.sampleTimer);
    for (const task of this.tasks.values()) await this.remove(task.id, task.userId);
    if (this.tasks.size || this.storage.reservedBytes) throw new Error('Contract resources still pending cleanup');
    // 从未接收文件的管理器不创建临时目录/锁。
    if (this.storageStarted) await this.storage.close();
  }
  private storageStarted = false;
  async initialize() { await this.storage.initialize(); this.storageStarted = true; }
}
