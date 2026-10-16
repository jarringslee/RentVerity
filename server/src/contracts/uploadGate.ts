import { AppError } from '../utils/AppError';

export const UPLOAD_LIMITS = { perUser: 6, perIp: 30, concurrent: 4, windowMs: 60000, timeoutMs: 60000 } as const;

// 单进程准入：在 Multer 接收文件之前占位，上传和解析共用槽位。
// 多实例部署应改为网关/共享限流；此处不是病毒扫描或 CPU 沙箱。
export class ContractUploadGate {
  private active = new Set<number>();
  private windows = new Map<string, { since: number; count: number }>();
  constructor(private now = Date.now) {}

  acquire(userId: number, ip: string): () => void {
    const now = this.now();
    for (const [key, window] of this.windows) if (now - window.since >= UPLOAD_LIMITS.windowMs) this.windows.delete(key);
    const limits: [string, number][] = [[`user:${userId}`, UPLOAD_LIMITS.perUser], [`ip:${ip}`, UPLOAD_LIMITS.perIp]];
    for (const [key, limit] of limits) {
      const window = this.windows.get(key);
      if (window && window.count >= limit) throw new AppError(429, 'UPLOAD_RATE_LIMIT', '上传过于频繁，请一分钟后重试。');
    }
    if (this.windows.size + limits.filter(([key]) => !this.windows.has(key)).length > 2000) throw new AppError(503, 'UPLOAD_CAPACITY', '上传服务繁忙，请稍后重试。');
    for (const [key] of limits) {
      const window = this.windows.get(key) ?? { since: now, count: 0 };
      window.count++;
      this.windows.set(key, window);
    }
    if (this.active.has(userId) || this.active.size >= UPLOAD_LIMITS.concurrent) throw new AppError(429, 'PDF_BUSY', '正在上传或解析其他合同，请稍后重试。');
    this.active.add(userId);
    let released = false;
    return () => { if (!released) { released = true; this.active.delete(userId); } };
  }
}
