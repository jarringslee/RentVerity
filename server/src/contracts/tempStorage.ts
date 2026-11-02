import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError';
import type { ContractLimits } from './limits';
import { UPLOADS_ROOT } from '../config/paths';

const owned = /^job-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class ContractTempStorage {
  private reservations = new Map<string, number>();
  private serial: Promise<unknown> = Promise.resolve();
  private nonce = randomUUID();
  private ready?: Promise<void>;
  constructor(public readonly limits: ContractLimits, private freeBytes = async (root: string) => { const s = await fs.statfs(root); return s.bavail * s.bsize; }) {}
  initialize() { return this.ready ??= this.start(); }
  private async start() {
    const root = this.limits.tempRoot;
    const publicRelative = path.relative(path.resolve(UPLOADS_ROOT), root);
    if (!publicRelative || !publicRelative.startsWith('..') && !path.isAbsolute(publicRelative) || root === path.parse(root).root) throw new Error('Contract temp directory must be private');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Contract temp root cannot be a symlink');
    const lock = path.join(root, '.owner.json');
    try {
      const previous = JSON.parse(await fs.readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0 || typeof previous.nonce !== 'string') throw new AppError(503, 'CONTRACT_STORAGE_BUSY', '临时目录锁无法可靠核对，请检查服务状态。');
      let alive = false;
      try { process.kill(previous.pid, 0); alive = true; } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (alive) throw new AppError(503, 'CONTRACT_STORAGE_BUSY', '临时目录正在被其他服务使用。');
      await fs.unlink(lock);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, nonce: this.nonce }), { flag: 'wx', mode: 0o600 });
    for (const item of await fs.readdir(root, { withFileTypes: true })) if (owned.test(item.name)) await this.removeDirectory(item.name);
  }
  private folder(id: string) {
    if (!owned.test(`job-${id}`)) throw new Error('Invalid contract temporary ID');
    return path.join(this.limits.tempRoot, `job-${id}`);
  }
  private async removeDirectory(name: string) {
    if (!owned.test(name)) throw new Error('Refusing unowned directory');
    const target = path.resolve(this.limits.tempRoot, name), relative = path.relative(this.limits.tempRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe temporary path');
    // 只删除本命名空间内的随机任务目录；rm 不跟随符号链接。
    await fs.rm(target, { recursive: true, force: true });
  }
  async reserve(id: string, originalBytes: number) {
    await this.initialize();
    const run = this.serial.then(async () => {
      // 原文件 + 一个受限解析输出/半成品（原子重命名不复制）+ 元数据余量。
      const bytes = originalBytes + this.limits.parserOutputBytes + 1024 * 1024;
      const reserved = [...this.reservations.values()].reduce((a, b) => a + b, 0);
      const free = await this.freeBytes(this.limits.tempRoot);
      if (reserved + bytes > this.limits.quotaBytes || free - reserved - bytes < this.limits.freeMarginBytes) throw new AppError(507, 'CONTRACT_SPACE', '临时处理空间预留不足，请稍后重试。');
      const directory = this.folder(id);
      await fs.mkdir(directory, { mode: 0o700 });
      this.reservations.set(id, bytes);
      return { directory, incoming: path.join(directory, 'original.part'), pdf: path.join(directory, 'original.pdf'), output: path.join(directory, 'pages.json') };
    });
    this.serial = run.catch(() => {}); return run;
  }
  async cleanup(id: string) {
    await this.initialize();
    await this.removeDirectory(`job-${id}`);
    // 删除失败时保留配额，后续清扫重试，不能虚假释放。
    this.reservations.delete(id);
  }
  get reservedBytes() { return [...this.reservations.values()].reduce((a, b) => a + b, 0); }
  async close() {
    await this.initialize();
    for (const id of this.reservations.keys()) await this.cleanup(id);
    const lock = path.join(this.limits.tempRoot, '.owner.json');
    const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
    if (owner.nonce === this.nonce) await fs.unlink(lock);
  }
}
