import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError';
import type { ContractAnalysis } from './analysis';
import type { ParsedContract } from './pdf';

interface ContractSession extends ParsedContract {
  id: string;
  userId: number;
  filename: string;
  expiresAt: number;
  analyzing: boolean;
  result?: ContractAnalysis;
}

export class ContractSessionStore {
  private sessions = new Map<string, ContractSession>();
  constructor(private now = Date.now, private ttlMs = 15 * 60 * 1000) {
    // 即使没有后续请求，也定期清理到期文本；unref 不阻止服务/测试正常退出。
    setInterval(() => this.prune(), 30000).unref();
  }

  private prune() {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.now() && !session.analyzing) this.sessions.delete(id);
  }

  create(userId: number, filename: string, parsed: ParsedContract): ContractSession {
    this.prune();
    const own = [...this.sessions.values()].filter(item => item.userId === userId);
    if (own.length >= 2) throw new AppError(429, 'CONTRACT_SESSION_LIMIT', '最多同时保留两份临时合同，请先清除旧合同或稍后再试。');
    if (this.sessions.size >= 100) throw new AppError(503, 'CONTRACT_CAPACITY', '合同解析服务繁忙，请稍后重试。');
    const session = { ...parsed, id: randomUUID(), userId, filename, expiresAt: this.now() + this.ttlMs, analyzing: false };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string, userId: number): ContractSession {
    this.prune();
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId || session.expiresAt <= this.now()) throw new AppError(404, 'CONTRACT_NOT_FOUND', '临时合同不存在或已过期，请重新上传。');
    return session;
  }

  remove(id: string, userId: number) {
    const session = this.sessions.get(id);
    if (session?.userId === userId && !session.analyzing) this.sessions.delete(id);
  }

  isAnalyzing(userId: number): boolean {
    return [...this.sessions.values()].some(item => item.userId === userId && item.analyzing);
  }
}
