import { parseContractPdf } from '../contracts/pdf';
import { analyzeContract } from '../contracts/analysis';
import { completeConfiguredJson, readModelConfig } from '../services/modelClient';
import { AppError } from '../utils/AppError';
import { makePdf } from '../tests/pdfFixture';

// 显式手动执行才会调用真实模型；只发送合成合同，不发送用户文件或另一项目的数据。
async function main() {
  const config = readModelConfig();
  const buffer = makePdf([
    'SYNTHETIC RENTAL CONTRACT - NOT A REAL AGREEMENT.\nMonthly rent is 2000 yuan. The lease term is twelve months.',
    'The deposit is not refundable under any circumstances.\nThe landlord may enter the home at any time without notice.'
  ]);
  const parsed = await parseContractPdf(buffer);
  const result = await analyzeContract(parsed.pages, completeConfiguredJson);
  console.log(JSON.stringify({
    source: 'synthetic-contract', model: config.model, realModelCalls: 1,
    pageCount: parsed.pageCount, characterCount: parsed.characterCount,
    verifiedFindings: result.findings.length, rejectedFindings: result.rejectedFindingCount,
    note: '真实模型协议与证据校验烟测；不代表法律判断正确率。'
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof AppError ? `${error.code}: ${error.message}` : '合同烟测失败，请检查本地配置。');
  process.exitCode = 1;
});
