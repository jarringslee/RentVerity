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
import { ContractUploadGate, UPLOAD_LIMITS } from '../contracts/uploadGate';

const pages = [{ page: 1, text: 'Tenant must pay a deposit of 2000 yuan.' }, { page: 2, text: 'The deposit is not refundable.\nRent is due on day 1.' }];
const finding = { severity: 'high', category: 'Deposit', quote: 'The deposit is not refundable.', page: 2, reason: 'Confirm the refund condition.', suggestion: 'Agree a refund condition.' };
const validResult = { summary: 'Synthetic rental contract.', findings: [finding] };

test('PDF validation rejects disguised, empty, and oversized files', () => {
  const pdf = makePdf(pages.map(p => p.text));
  assert.doesNotThrow(() => validatePdfFile({ buffer: pdf, originalname: 'contract.pdf', mimetype: 'application/pdf' }));
  for (const file of [
    { buffer: Buffer.from('not a pdf'), originalname: 'contract.pdf', mimetype: 'application/pdf' },
    { buffer: Buffer.concat([Buffer.from('<script>bad</script>'), pdf]), originalname: 'contract.pdf', mimetype: 'application/pdf' },
    { buffer: pdf, originalname: 'contract.docx', mimetype: 'application/pdf' },
    { buffer: pdf, originalname: 'contract.pdf', mimetype: 'image/png' },
    { buffer: Buffer.alloc(0), originalname: 'contract.pdf', mimetype: 'application/pdf' },
    { buffer: Buffer.alloc(PDF_LIMITS.maxBytes + 1), originalname: 'contract.pdf', mimetype: 'application/pdf' }
  ]) assert.throws(() => validatePdfFile(file), AppError);
});

test('upload admission caps per-user/IP frequency, global concurrency and releases idempotently', () => {
  let now = 0;
  const gate = new ContractUploadGate(() => now);
  const release = gate.acquire(1, 'local');
  assert.throws(() => gate.acquire(1, 'local'), (e: AppError) => e.code === 'PDF_BUSY');
  const other = [2, 3, 4].map(id => gate.acquire(id, 'local'));
  assert.throws(() => gate.acquire(5, 'local'), (e: AppError) => e.code === 'PDF_BUSY');
  release(); release();
  const next = gate.acquire(5, 'local');
  next(); other.forEach(done => done());
  now += UPLOAD_LIMITS.windowMs;
  for (let n = 0; n < UPLOAD_LIMITS.perUser; n++) gate.acquire(1, 'local')();
  assert.throws(() => gate.acquire(1, 'local'), (e: AppError) => e.code === 'UPLOAD_RATE_LIMIT');
  now += UPLOAD_LIMITS.windowMs;
  for (let id = 1; id <= UPLOAD_LIMITS.perIp; id++) gate.acquire(id, 'local')();
  assert.throws(() => gate.acquire(100, 'local'), (e: AppError) => e.code === 'UPLOAD_RATE_LIMIT');
  now += UPLOAD_LIMITS.windowMs;
  assert.doesNotThrow(() => gate.acquire(100, 'local')());
});

test('HTTP admission precedes Multer buffering and holds the parse slot after disconnect', async t => {
  process.env.JWT_SECRET = 'rentverity-test-only-secret';
  const gate = new ContractUploadGate();
  let finishParse!: () => void, markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const blocked = new Promise<void>(resolve => { finishParse = resolve; });
  let calls = 0;
  const app = express();
  app.use('/contracts', createContractsRouter({ uploadGate: gate, parsePdf: async () => {
    calls++; markStarted(); await blocked;
    return { pages, pageCount: 2, characterCount: 100 };
  } }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { finishParse(); server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contracts/parse`;
  const auth = { Authorization: `Bearer ${jwt.sign({ userId: 11 }, process.env.JWT_SECRET!)}` };
  const form = () => { const data = new FormData(); data.append('file', new Blob([Uint8Array.from(makePdf(['Synthetic contract text.']))], { type: 'application/pdf' }), 'test.pdf'); return data; };
  const controller = new AbortController();
  const first = fetch(base, { method: 'POST', headers: auth, body: form(), signal: controller.signal }).catch(() => null);
  await started;
  // 没有发送任何正文、甚至不是 multipart：应由准入返回 429 而非进入 Multer/文件校验。
  const rejected = await fetch(base, { method: 'POST', headers: auth });
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json() as { code: string }).code, 'PDF_BUSY');
  assert.equal(rejected.headers.get('retry-after'), '2');
  controller.abort(); await first;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.throws(() => gate.acquire(11, 'another-ip'), (e: AppError) => e.code === 'PDF_BUSY', 'disconnect must not release a running parser');
  finishParse();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await fetch(base, { method: 'POST', headers: auth, body: form() })).status, 200);
  assert.equal(calls, 2);
});

test('HTTP invalid uploads and stalled/aborted connections release their admission slot', async t => {
  process.env.JWT_SECRET = 'rentverity-test-only-secret';
  let calls = 0;
  const app = express();
  app.use('/contracts', createContractsRouter({ uploadTimeoutMs: 100, parsePdf: async () => { calls++; return { pages, pageCount: 2, characterCount: 100 }; } }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contracts/parse`;
  const auth = (id: number) => ({ Authorization: `Bearer ${jwt.sign({ userId: id }, process.env.JWT_SECRET!)}` });
  const upload = (id: number, filename: string) => {
    const form = new FormData(); form.append('file', new Blob([Uint8Array.from(makePdf(['Synthetic contract text.']))], { type: 'application/pdf' }), filename);
    return fetch(base, { method: 'POST', headers: auth(id), body: form });
  };
  assert.equal((await upload(21, 'bad.docx')).status, 400);
  assert.equal(calls, 0, 'early extension filter does not parse the body');
  assert.equal((await upload(21, 'good.pdf')).status, 200);
  const stalled = await new Promise<number>((resolve, reject) => {
    const request = http.request(base, { method: 'POST', headers: { ...auth(22), 'Content-Type': 'multipart/form-data; boundary=slow' } }, response => {
      response.resume(); response.on('end', () => { request.destroy(); resolve(response.statusCode!); });
    });
    request.on('error', reject);
    request.write('--slow\r\nContent-Disposition: form-data; name="file"; filename="slow.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n');
  });
  assert.equal(stalled, 408);
  assert.equal((await upload(22, 'retry.pdf')).status, 200, 'upload timeout frees admission');
  await new Promise<void>(resolve => {
    const request = http.request(base, { method: 'POST', headers: { ...auth(23), 'Content-Type': 'multipart/form-data; boundary=abort' } });
    request.on('error', () => {});
    server.once('request', (_req, response) => { response.once('close', resolve); setTimeout(() => request.destroy(), 10); });
    request.write('--abort\r\n');
  });
  assert.equal((await upload(23, 'retry.pdf')).status, 200, 'aborted upload frees admission');
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
