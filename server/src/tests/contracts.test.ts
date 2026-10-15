import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { parseContractPdf, validatePdfFile, PDF_LIMITS } from '../contracts/pdf';
import { buildContractMessages, verifyContractAnalysis, type ContractAnalysis } from '../contracts/analysis';
import { ContractSessionStore } from '../contracts/sessionStore';
import { createContractsRouter } from '../routes/contracts';
import { makePdf } from './pdfFixture';

const pages = [{ page: 1, text: 'Tenant must pay a deposit of 2000 yuan.' }, { page: 2, text: 'The deposit is not refundable.\nRent is due on day 1.' }];
const finding = { severity: 'high', category: 'Deposit', quote: 'The deposit is not refundable.', page: 2, reason: 'Confirm the refund condition.', suggestion: 'Agree a refund condition.' };
const validResult = { summary: 'Synthetic rental contract.', findings: [finding] };

test('PDF validation rejects disguised, empty, and oversized files', () => {
  const pdf = makePdf(pages.map(p => p.text));
  assert.doesNotThrow(() => validatePdfFile({ buffer: pdf, originalname: 'contract.pdf', mimetype: 'application/pdf' }));
  for (const file of [
    { buffer: Buffer.from('not a pdf'), originalname: 'contract.pdf', mimetype: 'application/pdf' },
    { buffer: pdf, originalname: 'contract.docx', mimetype: 'application/pdf' },
    { buffer: pdf, originalname: 'contract.pdf', mimetype: 'image/png' },
    { buffer: Buffer.alloc(0), originalname: 'contract.pdf', mimetype: 'application/pdf' },
    { buffer: Buffer.alloc(PDF_LIMITS.maxBytes + 1), originalname: 'contract.pdf', mimetype: 'application/pdf' }
  ]) assert.throws(() => validatePdfFile(file), AppError);
});

test('PDF.js extracts genuine per-page text and rejects blank, excessive, or broken PDFs', async t => {
  await t.test('real two-page extraction', async () => {
    const parsed = await parseContractPdf(makePdf(pages.map(p => p.text)));
    assert.equal(parsed.pageCount, 2);
    assert.ok(parsed.pages[1].text.includes('The deposit is not refundable.'));
    assert.equal(parsed.pages[1].page, 2);
    assert.ok(parsed.characterCount > 50);
  });
  await t.test('blank/scanned-like file', async () => { await assert.rejects(parseContractPdf(makePdf([''])), (e: AppError) => e.code === 'PDF_NO_TEXT'); });
  await t.test('page cap', async () => { await assert.rejects(parseContractPdf(makePdf(Array(41).fill('Synthetic rental clause.'))), (e: AppError) => e.code === 'PDF_PAGE_LIMIT'); });
  await t.test('text cap', async () => {
    const page = Array(30).fill('Rental clause for the synthetic contract with additional conditions.').join('\n');
    await assert.rejects(parseContractPdf(makePdf(Array(40).fill(page))), (e: AppError) => e.code === 'PDF_TEXT_LIMIT');
  });
  await t.test('broken document', async () => { await assert.rejects(parseContractPdf(Buffer.from('%PDF-1.4 broken')), (e: AppError) => e.code === 'PDF_INVALID'); });
});

test('schema and evidence verification reject hallucinated references without inventing safety', () => {
  const verified = verifyContractAnalysis({ ...validResult, findings: [finding, { ...finding, quote: 'A fabricated refund term.' }, { ...finding, page: 1 }, { ...finding, page: 99 }] }, pages);
  assert.equal(verified.findings.length, 1);
  assert.equal(verified.rejectedFindingCount, 3);
  assert.match(verified.warnings.join(''), /不应据此认为合同没有风险/);
  const whitespace = verifyContractAnalysis({ ...validResult, findings: [{ ...finding, quote: 'The deposit\n is not refundable.' }] }, pages);
  assert.equal(whitespace.findings.length, 1);
  assert.throws(() => verifyContractAnalysis({ ...validResult, findings: [{ ...finding, severity: 'critical' }] }, pages), (e: AppError) => e.code === 'AI_INVALID_SCHEMA');
  assert.throws(() => verifyContractAnalysis({ ...validResult, findings: [{ ...finding, page: '2' }] }, pages), AppError);
  const empty = verifyContractAnalysis({ summary: 'Insufficient evidence.', findings: [] }, pages);
  assert.equal(empty.findings.length, 0);
  assert.ok(empty.warnings.length > 0);
  const messages = buildContractMessages(pages);
  assert.equal(messages.length, 2);
  assert.deepEqual(JSON.parse(messages[1].content).pages, pages);
});

test('temporary sessions isolate ownership, expire, and cap memory per user', () => {
  let now = 0;
  const store = new ContractSessionStore(() => now, 100);
  const parsed = { pages, pageCount: 2, characterCount: 100 };
  const session = store.create(1, 'contract.pdf', parsed);
  assert.throws(() => store.get(session.id, 2), (e: AppError) => e.code === 'CONTRACT_NOT_FOUND');
  store.remove(session.id, 2);
  assert.equal(store.get(session.id, 1).id, session.id);
  store.create(1, 'second.pdf', parsed);
  assert.throws(() => store.create(1, 'third.pdf', parsed), (e: AppError) => e.code === 'CONTRACT_SESSION_LIMIT');
  now = 101;
  assert.throws(() => store.get(session.id, 1), (e: AppError) => e.code === 'CONTRACT_NOT_FOUND');
  assert.ok(store.create(1, 'new.pdf', parsed));
});

test('HTTP upload → parse → model adapter → verified result; authentication and error boundaries', async t => {
  process.env.JWT_SECRET = 'rentverity-test-only-secret';
  let calls = 0;
  let fail = false;
  const app = express();
  app.use(express.json());
  app.use('/contracts', createContractsRouter({ completeJson: async () => { calls++; if (fail) throw new AppError(504, 'AI_TIMEOUT', 'Model timeout'); return validResult; } }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contracts`;
  const auth = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}` });
  const upload = async (userId = 1, buffer: Uint8Array = makePdf(pages.map(p => p.text))) => {
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: 'application/pdf' }), 'synthetic.pdf');
    return fetch(`${base}/parse`, { method: 'POST', headers: auth(userId), body: form });
  };
  const analyze = (documentId: string, userId = 1) => fetch(`${base}/analyze`, { method: 'POST', headers: { ...auth(userId), 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId }) });
  assert.equal((await fetch(`${base}/parse`, { method: 'POST' })).status, 401);
  const parsedResponse = await upload();
  assert.equal(parsedResponse.status, 200);
  const parsed = (await parsedResponse.json() as { data: { documentId: string; pageCount: number } }).data;
  assert.equal(parsed.pageCount, 2);
  assert.equal((await analyze(parsed.documentId, 2)).status, 404);
  assert.equal(calls, 0);
  const analyzed = await analyze(parsed.documentId);
  assert.equal(analyzed.status, 200);
  const result = (await analyzed.json() as { data: ContractAnalysis }).data;
  assert.equal(result.findings[0].page, 2);
  assert.equal(calls, 1);
  assert.equal((await analyze(parsed.documentId)).status, 200);
  assert.equal(calls, 1, 'cached results do not call the model again');
  await fetch(`${base}/${parsed.documentId}`, { method: 'DELETE', headers: auth() });
  assert.equal((await analyze(parsed.documentId)).status, 404);
  const retrySession = (await (await upload()).json() as { data: { documentId: string } }).data;
  fail = true;
  const failed = await analyze(retrySession.documentId);
  assert.equal(failed.status, 504);
  assert.equal((await failed.json() as { code: string }).code, 'AI_TIMEOUT');
  fail = false;
  assert.equal((await analyze(retrySession.documentId)).status, 200, 'failed requests release the busy flag');
  assert.equal((await upload(2, Buffer.from('fake file'))).status, 400);
  assert.equal((await upload(2, Buffer.alloc(PDF_LIMITS.maxBytes + 1))).status, 413);
  assert.equal((await fetch(`${base}/analyze`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
});
