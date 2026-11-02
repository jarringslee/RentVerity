// 不加载 env/config/db/modelClient。父进程只传文件路径与数值上限。
import fs from 'node:fs/promises';
import { parseContractPdf } from './pdf';
import { AppError } from '../utils/AppError';
import type { ContractLimits } from './limits';
import { startParserGuard } from './parserGuard';

async function main() {
  const [source, target, encoded, owner] = process.argv.slice(2);
  const limits = JSON.parse(encoded) as ContractLimits;
  const ownerPid = Number(owner);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error('Missing parser owner');
  const stopGuard = startParserGuard(ownerPid, limits.parserTimeoutMs + 1000);
  try {
    const info = await fs.stat(source);
    if (info.size < 1 || info.size > limits.maxBytes) throw new AppError(413, 'FILE_SIZE', '文件大小超限。');
    const buffer = await fs.readFile(source);
    const parsed = await parseContractPdf(buffer, limits);
    const output = JSON.stringify(parsed);
    if (Buffer.byteLength(output) > limits.parserOutputBytes) throw new AppError(413, 'PDF_OUTPUT_LIMIT', '解析输出超过限制。');
    await fs.writeFile(target + '.part', output, { flag: 'wx', mode: 0o600 });
    await fs.rename(target + '.part', target);
    process.stdout.write(JSON.stringify({ success: true }));
  } finally { await stopGuard(); }
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ success: false, code: error instanceof AppError ? error.code : 'PDF_INVALID', status: error instanceof AppError ? error.status : 422 }));
  process.exitCode = 1;
});
