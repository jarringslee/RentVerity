import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/AppError';
import type { ContractLimits } from './limits';
import type { ParsedContract } from './pdf';
import { Semaphore } from './semaphore';

export class IsolatedPdfParser {
  private slots: Semaphore;
  // ts-node-dev运行源码时仍使用构建后的独立工作进程，不在子进程注入ts-node或主服务环境。
  constructor(private limits: ContractLimits, private worker = __filename.endsWith('.ts') ? path.resolve(__dirname, '../../dist/contracts/parserWorker.js') : path.join(__dirname, 'parserWorker.js')) { this.slots = new Semaphore(limits.parserConcurrency); }
  async parse(source: string, output: string, signal: AbortSignal): Promise<ParsedContract> {
    signal.throwIfAborted();
    const release = await this.slots.acquire(signal);
    try {
      await new Promise<void>((resolve, reject) => {
        // 显式环境白名单；不继承 Node options、AI、JWT、MySQL、代理或其他凭据。
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['SystemRoot', 'WINDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key];
        const child = spawn(process.execPath, [`--max-old-space-size=${this.limits.parserHeapMb}`, this.worker, source, output, JSON.stringify(this.limits), String(process.pid)], { env, cwd: path.dirname(source), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = '', bytes = 0, cause: AppError | undefined;
        const stop = (error: AppError) => { cause ??= error; child.kill('SIGKILL'); };
        const cancelled = () => stop(new AppError(499, 'REQUEST_CANCELLED', '解析已停止。'));
        const timer = setTimeout(() => stop(new AppError(504, 'PDF_PARSE_TIMEOUT', 'PDF 解析超时，进程已终止。')), this.limits.parserTimeoutMs);
        signal.addEventListener('abort', cancelled, { once: true });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16384) stop(new AppError(422, 'PDF_WORKER_OUTPUT', '解析进程输出超限。')); else if (stream === child.stdout) text += chunk.toString('utf8'); });
        child.once('error', () => { cause = new AppError(503, 'PDF_WORKER_START', '无法启动隔离解析进程。'); });
        child.once('close', code => {
          clearTimeout(timer); signal.removeEventListener('abort', cancelled);
          if (cause) { reject(cause); return; }
          try {
            const result = JSON.parse(text);
            if (code !== 0 || !result.success) throw new AppError(result.status || 422, result.code || 'PDF_WORKER_CRASH', 'PDF 无法安全完成解析，请检查文件或限制。');
            resolve();
          } catch (error) { reject(error instanceof AppError ? error : new AppError(422, 'PDF_WORKER_CRASH', '解析进程异常退出。')); }
        });
        if (signal.aborted) cancelled();
      });
      signal.throwIfAborted();
      const stat = await fs.stat(output);
      if (stat.size > this.limits.parserOutputBytes) throw new AppError(413, 'PDF_OUTPUT_LIMIT', '解析输出超限。');
      const parsed = JSON.parse(await fs.readFile(output, 'utf8')) as ParsedContract;
      if (!Number.isSafeInteger(parsed.pageCount) || parsed.pageCount < 1 || parsed.pageCount > this.limits.maxPages || !Array.isArray(parsed.pages) || parsed.pages.length !== parsed.pageCount || parsed.pages.some((p, i) => p.page !== i + 1 || typeof p.text !== 'string') || parsed.pages.reduce((n, p) => n + p.text.length, 0) !== parsed.characterCount || parsed.characterCount > this.limits.maxCharacters) throw new AppError(422, 'PDF_OUTPUT_INVALID', '解析进程结果无效。');
      return parsed;
    } finally { release(); }
  }
}
