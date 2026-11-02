import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../utils/AppError';
import { parseContractPdf, validatePdfFile, PDF_LIMITS } from '../contracts/pdf';
import { verifyContractAnalysis } from '../contracts/analysis';
import { buildChunkMessages } from '../contracts/chunks';
import { makePdf } from './pdfFixture';
import { ContractUploadGate, UPLOAD_LIMITS } from '../contracts/uploadGate';

const pages = [{ page: 1, text: 'Tenant must pay a deposit of 2000 yuan.' }, { page: 2, text: 'The deposit is not refundable.\nRent is due on day 1.' }];
const finding = { severity: 'high', category: 'Deposit', quote: 'The deposit is not refundable.', page: 2, reason: 'Confirm the refund condition.', suggestion: 'Agree a refund condition.' };
const result = { summary: 'Synthetic rental contract.', findings: [finding] };
test('PDF metadata and header reject disguised, empty and oversized files', () => {
  const pdf = makePdf(pages.map(p => p.text));
  assert.doesNotThrow(() => validatePdfFile({ buffer: pdf, originalname: 'contract.pdf', mimetype: 'application/pdf' }));
  for (const [buffer, originalname, mimetype] of [[Buffer.from('not a pdf'), 'a.pdf', 'application/pdf'], [Buffer.concat([Buffer.from('<html>'), pdf]), 'a.pdf', 'application/pdf'], [pdf, 'a.docx', 'application/pdf'], [pdf, 'a.pdf', 'image/png'], [Buffer.alloc(0), 'a.pdf', 'application/pdf']] as [Buffer, string, string][]) assert.throws(() => validatePdfFile({ buffer, originalname, mimetype }), AppError);
});
test('admission limits account/IP and global activity and releases idempotently', () => {
  let now = 0; const gate = new ContractUploadGate(() => now); const release = gate.acquire(1, 'local');
  assert.throws(() => gate.acquire(1, 'local'), (e: AppError) => e.code === 'PDF_BUSY');
  const others = [2, 3, 4].map(id => gate.acquire(id, 'local'));
  assert.throws(() => gate.acquire(5, 'local')); release(); release(); gate.acquire(5, 'local')(); others.forEach(done => done());
  now += UPLOAD_LIMITS.windowMs;
  for (let n = 0; n < UPLOAD_LIMITS.perUser; n++) gate.acquire(1, 'local')();
  assert.throws(() => gate.acquire(1, 'local'), (e: AppError) => e.code === 'UPLOAD_RATE_LIMIT');
  now += UPLOAD_LIMITS.windowMs;
  for (let id = 1; id <= UPLOAD_LIMITS.perIp; id++) gate.acquire(id, 'local')();
  assert.throws(() => gate.acquire(100, 'local'), (e: AppError) => e.code === 'UPLOAD_RATE_LIMIT');
});
test('PDF extraction supports more than 40 pages, configurable caps and rejects invalid/blank input', async () => {
  const parsed = await parseContractPdf(makePdf(Array(41).fill(pages[0].text)));
  assert.equal(parsed.pageCount, 41);
  await assert.rejects(parseContractPdf(makePdf([''])), (e: AppError) => e.code === 'PDF_NO_TEXT');
  await assert.rejects(parseContractPdf(makePdf(Array(3).fill(pages[0].text)), { ...PDF_LIMITS, maxPages: 2 }), (e: AppError) => e.code === 'PDF_PAGE_LIMIT');
  await assert.rejects(parseContractPdf(makePdf([pages[0].text.repeat(50)]), { ...PDF_LIMITS, maxCharacters: 100 }), (e: AppError) => e.code === 'PDF_TEXT_LIMIT');
  await assert.rejects(parseContractPdf(Buffer.from('%PDF-1.4 broken')), (e: AppError) => e.code === 'PDF_INVALID');
});
test('schema and page evidence reject fake references; prompt caps the final output at20', () => {
  const checked = verifyContractAnalysis({ ...result, findings: [finding, { ...finding, quote: 'fabricated refund term' }, { ...finding, page: 1 }, { ...finding, page: 99 }] }, pages);
  assert.equal(checked.findings.length, 1); assert.equal(checked.rejectedFindingCount, 3);
  assert.equal(verifyContractAnalysis({ ...result, findings: [{ ...finding, quote: 'The deposit\n is not refundable.' }] }, pages).findings.length, 1);
  assert.throws(() => verifyContractAnalysis({ ...result, findings: [{ ...finding, severity: 'critical' }] }, pages), AppError);
  assert.throws(() => verifyContractAnalysis({ ...result, findings: Array(21).fill(finding) }, pages), AppError);
  assert.equal(verifyContractAnalysis({ summary: 'No supported evidence.', findings: [] }, pages).findings.length, 0);
  assert.match(buildChunkMessages({ id: 1, segments: [] }, [])[0].content, /20/);
});
