import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import { createContractsRouter } from '../routes/contracts';
import { ContractTaskManager } from '../contracts/tasks';
import { ContractTempStorage } from '../contracts/tempStorage';
import { readContractLimits, type ContractLimits } from '../contracts/limits';
import { IsolatedPdfParser } from '../contracts/isolatedParser';
import { splitContract, buildChunkMessages, verifyChunkResult, mergeChunkResults } from '../contracts/chunks';
import { ContractUploadGate, UPLOAD_LIMITS } from '../contracts/uploadGate';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { AppError } from '../utils/AppError';
import { makePdf, writePdfFixture } from './pdfFixture';
import type { CompleteJson } from '../services/modelClient';

const clause = 'Residential rental agreement. The deposit is never refundable. Tenant pays all repairs. ';
const emptyModel: CompleteJson = async () => ({ summary: 'Synthetic verified block.', findings: [] });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function harness(t: any, options: { limits?: Partial<ContractLimits>; model?: CompleteJson; parser?: Pick<IsolatedPdfParser, 'parse'>; freeBytes?: () => Promise<number>; now?: () => number } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rentverity-contract-test-'));
  const limits = { ...readContractLimits(), tempRoot: path.join(root, 'jobs'), ...options.limits };
  const storage = new ContractTempStorage(limits, options.freeBytes);
  const manager = new ContractTaskManager({ limits, storage, model: options.model ?? emptyModel, parser: options.parser, now: options.now, gate: new ContractUploadGate(Date.now, { ...UPLOAD_LIMITS, perUser: 1000, perIp: 1000 }), audit: () => {} });
  const app = express(); app.use(express.json()); app.use('/contracts', createContractsRouter({ manager }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/contracts`;
  process.env.JWT_SECRET = 'contract-task-test-only';
  const auth = (userId = 1) => ({ Cookie: `${SESSION_COOKIE}=${createSession(userId).token}` });
  const post = async (data: Uint8Array | Blob = makePdf([clause]), userId = 1, declared?: number, name = 'contract.pdf') => {
    const id = randomUUID(), blob = data instanceof Blob ? data : new Blob([Uint8Array.from(data)], { type: 'application/pdf' });
    const form = new FormData(); form.append('file', blob, name);
    const response = await fetch(base + '/tasks', { method: 'POST', headers: { ...auth(userId), 'X-Contract-Task-Id': id, 'X-Contract-File-Size': String(declared ?? blob.size) }, body: form });
    return { id, response, payload: await response.json() as any };
  };
  const wait = async (id: string, userId = 1) => {
    for (let n = 0; n < 1000; n++) { const response = await fetch(`${base}/tasks/${id}`, { headers: auth(userId) }); const value: any = await response.json(); if (!value.success) throw new Error(JSON.stringify(value)); if (!['receiving','queued','parsing','analyzing'].includes(value.data.state) && !value.data.cleanupPending) return value.data; await sleep(20); }
    throw new Error('Contract task did not finish');
  };
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await manager.close(); const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true, force: true }); });
  return { root, limits, manager, storage, server, base, auth, post, wait };
}
test('real streaming HTTP accepts complete PDFs, isolates ownership, closes old bypass and cleans artifacts', async t => {
  const h = await harness(t);
  assert.equal((await fetch(h.base + '/tasks', { method: 'POST' })).status, 401);
  const uploaded = await h.post(); assert.equal(uploaded.response.status, 202, JSON.stringify(uploaded.payload));
  const done = await h.wait(uploaded.id); assert.equal(done.state, 'completed'); assert.equal(done.stats.modelCalls, 1); assert.equal(done.chunks.length, 1);
  assert.equal(h.storage.reservedBytes, 0); assert.deepEqual(await fs.readdir(h.limits.tempRoot), ['.owner.json']);
  assert.equal((await fetch(`${h.base}/tasks/${uploaded.id}`, { headers: h.auth(2) })).status, 404);
  assert.equal((await fetch(h.base + '/parse', { method: 'POST', headers: h.auth() })).status, 410);
  await h.manager.remove(uploaded.id, 1); await h.manager.remove(uploaded.id, 1); assert.equal(h.storage.reservedBytes, 0);
});
test('actual byte limits, header/type, extra fields, truncated multipart and simulated space shortage never parse', async t => {
  let parses = 0;
  const parser = { parse: async () => { parses++; return { pages: [{ page: 1, text: clause }], pageCount: 1, characterCount: clause.length }; } };
  const h = await harness(t, { parser });
  for (const [data, size, name, code] of [[Buffer.from('bad header'), undefined, 'a.pdf', 400], [makePdf([clause]), undefined, 'a.docx', 400], [makePdf([clause]), 10, 'a.pdf', 413]] as [Uint8Array, number | undefined, string, number][]) {
    const result = await h.post(data, 1, size, name); assert.equal(result.response.status, code, JSON.stringify(result.payload)); await h.manager.remove(result.id, 1);
  }
  const id = randomUUID(), data = `--bad\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\nwithout-final-boundary`;
  const response = await fetch(h.base + '/tasks', { method: 'POST', headers: { ...h.auth(), 'Content-Type': 'multipart/form-data; boundary=bad', 'X-Contract-Task-Id': id, 'X-Contract-File-Size': '200' }, body: data });
  assert.equal(response.status, 400); await h.manager.remove(id, 1); assert.equal(parses, 0); assert.equal(h.storage.reservedBytes, 0);
  const low = await harness(t, { parser, freeBytes: async () => 0 }); const rejected = await low.post(); assert.equal(rejected.response.status, 507); assert.equal(low.storage.reservedBytes, 0); assert.equal(parses, 0);
});
test('same account competing tabs cannot upload while the first task is analyzing; cancel frees it', async t => {
  let started!: () => void; const running = new Promise<void>(resolve => { started = resolve; });
  const h = await harness(t, { model: async (_messages, signal) => { started(); return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new AppError(499, 'REQUEST_CANCELLED', 'stopped')), { once: true })); } });
  const first = await h.post(); await running;
  const second = await h.post(); assert.equal(second.response.status, 429); assert.equal(second.payload.code, 'PDF_BUSY');
  await h.manager.remove(first.id, 1); assert.equal(h.storage.reservedBytes, 0);
  const third = await h.post(makePdf([clause]), 1); assert.equal(third.response.status, 202); await h.manager.remove(third.id, 1);
});
test('upload timeout and aborted sockets clean partial files and release reservation', async t => {
  const h = await harness(t, { limits: { uploadTimeoutMs: 80 } });
  const id = randomUUID();
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(h.base + '/tasks', { method: 'POST', headers: { ...h.auth(), 'Content-Type': 'multipart/form-data; boundary=slow', 'X-Contract-Task-Id': id, 'X-Contract-File-Size': '4096' } }, res => { res.resume(); res.once('end', () => { req.destroy(); resolve(res.statusCode!); }); }); req.once('error', reject);
    req.write('--slow\r\nContent-Disposition: form-data; name="file"; filename="slow.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n');
  });
  assert.equal(status, 408); await h.manager.remove(id, 1); assert.equal(h.storage.reservedBytes, 0);
  const abortId = randomUUID();
  const req = http.request(h.base + '/tasks', { method: 'POST', headers: { ...h.auth(), 'Content-Type': 'multipart/form-data; boundary=abort', 'X-Contract-Task-Id': abortId, 'X-Contract-File-Size': '4096' } }); req.on('error', () => {});
  req.write('--abort\r\nContent-Disposition: form-data; name="file"; filename="abort.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n');
  await sleep(50); req.destroy(); await sleep(80); await h.manager.remove(abortId, 1); assert.equal(h.storage.reservedBytes, 0);
});
test('100MiB valid textual PDF and 80-page text use the isolated real parser', async t => {
  const h = await harness(t);
  const large = path.join(h.root, 'large.pdf'); await writePdfFixture(large, [clause], 100 * 1024 * 1024);
  const uploaded = await h.post(await openAsBlob(large, { type: 'application/pdf' })); assert.equal(uploaded.response.status, 202, JSON.stringify(uploaded.payload));
  const done = await h.wait(uploaded.id); assert.equal(done.state, 'completed', JSON.stringify(done)); assert.equal(done.receivedBytes, 100 * 1024 * 1024); await h.manager.remove(uploaded.id, 1);
  const long = await h.post(makePdf(Array(80).fill(clause.repeat(12)))); const result = await h.wait(long.id); assert.equal(result.state, 'completed'); assert.equal(result.pageCount, 80); assert.ok(result.characterCount > 60000); assert.ok(result.chunks.length > 1); assert.ok(result.stats.inputMaxCharacters <= h.limits.maxInputCharacters);
});
test('chunk coverage preserves offsets, long pages, cross-page context, overlap and block/input caps', () => {
  const limits = { ...readContractLimits(), chunkCharacters: 1000, overlapCharacters: 100, sharedCharacters: 200 };
  const pages = [{ page: 1, text: ('Article 1. Deposit must be returned.\n').repeat(140) }, { page: 2, text: 'Continuation: within 10 days.\n' + clause.repeat(50) }];
  const { chunks, shared } = splitContract(pages, limits); assert.ok(chunks.length > 5);
  for (const page of pages) {
    const sources = chunks.flatMap(c => c.segments).filter(s => s.page === page.page && !s.overlap); let at = 0;
    for (const source of sources) { assert.equal(source.start, at); assert.equal(source.text, page.text.slice(source.start, source.end)); at = source.end; } assert.equal(at, page.text.length);
  }
  assert.ok(chunks.some(c => new Set(c.segments.map(s => s.page)).size > 1)); assert.ok(chunks[1].segments.some(s => s.overlap));
  assert.ok(chunks.every(c => buildChunkMessages(c, shared).reduce((n, m) => n + m.content.length, 0) <= limits.maxInputCharacters));
  assert.throws(() => splitContract(pages, { ...limits, maxChunks: 1 }), (e: AppError) => e.code === 'CONTRACT_CHUNK_LIMIT');
});
test('block evidence rejects off-block/fabricated quotes; server merges, sorts and caps at20 without another model call', () => {
  const limits = { ...readContractLimits(), chunkCharacters: 500, overlapCharacters: 100, sharedCharacters: 0 };
  const { chunks } = splitContract([{ page: 1, text: clause.repeat(80) }], limits);
  chunks.forEach((chunk, index) => {
    const quote = chunk.segments.find(s => s.text.includes('The deposit is never refundable.'));
    chunk.result = verifyChunkResult({ summary: 'Block.', findings: quote ? [{ severity: index % 2 ? 'high' : 'medium', category: 'Deposit', quote: 'The deposit is never refundable.', page: 1, reason: 'Verify.', suggestion: 'Discuss.' }, { severity: 'high', category: 'Fake', quote: 'A fabricated rent term.', page: 1, reason: 'Fake.', suggestion: 'Fake.' }] : [] }, chunk); chunk.state = 'succeeded';
  });
  const result = mergeChunkResults(chunks, true); assert.equal(result.findings.length, 1); assert.equal(result.findings[0].severity, 'high'); assert.ok(result.rejectedFindingCount > 0); assert.ok(result.findings[0].sources?.[0].start! >= 0);
  const many = Array.from({ length: 30 }, (_, id) => ({ ...chunks[0], id, state: 'succeeded' as const, result: { summary: 'Block', findings: [{ ...result.findings[0], category: 'Unique' + id }], rejectedFindingCount: 0, warnings: [] } }));
  assert.equal(mergeChunkResults(many, true).findings.length, 20); assert.match(mergeChunkResults([many[0], { ...many[1], state: 'failed' }], false).summary, /不能视为全文/);
});
test('failed blocks retry finitely; manual retry never re-runs successful blocks', async t => {
  const calls = new Map<number, number>(); let failing = true;
  const h = await harness(t, { limits: { chunkCharacters: 600, overlapCharacters: 100, sharedCharacters: 0 }, model: async messages => {
    const id = JSON.parse(messages[1].content).block; calls.set(id, (calls.get(id) ?? 0) + 1);
    if (id === 2 && failing) throw new AppError(504, 'AI_TIMEOUT', 'fixture'); return { summary: 'Good block.', findings: [] };
  } });
  const uploaded = await h.post(makePdf([clause.repeat(20)])); const partial = await h.wait(uploaded.id); assert.equal(partial.state, 'partial'); assert.equal(calls.get(2), 2);
  const successful = [...calls].filter(([id]) => id !== 2); failing = false;
  const retry = await fetch(`${h.base}/tasks/${uploaded.id}/retry`, { method: 'POST', headers: h.auth() }); assert.equal(retry.status, 202);
  const complete = await h.wait(uploaded.id); assert.equal(complete.state, 'completed'); assert.equal(calls.get(2), 3); for (const [id, count] of successful) assert.equal(calls.get(id), count);
});
test('task deadline, TTL, stale restart files and idempotent cleanup have deterministic bounds', async t => {
  const h = await harness(t, { limits: { taskTimeoutMs: 100 }, model: async (_m, signal) => new Promise((_r, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const uploaded = await h.post(); const stopped = await h.wait(uploaded.id); assert.equal(stopped.state, 'cancelled'); assert.equal(stopped.errorCode, 'CONTRACT_TIMEOUT'); assert.equal(h.storage.reservedBytes, 0);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rentverity-contract-restart-')); t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const limits = { ...readContractLimits(), tempRoot: root }; const stale = path.join(root, 'job-' + randomUUID()); await fs.mkdir(stale); await fs.writeFile(path.join(stale, 'original.part'), 'old');
  await fs.writeFile(path.join(root, '.owner.json'), JSON.stringify({ pid: 2147483647, nonce: 'old' }));
  const storage = new ContractTempStorage(limits); await storage.initialize(); assert.deepEqual(await fs.readdir(root), ['.owner.json']);
  const id = randomUUID(); await storage.reserve(id, 100); await storage.cleanup(id); await storage.cleanup(id); assert.equal(storage.reservedBytes, 0); await storage.close();
  let now = Date.now(); const expiring = await harness(t, { now: () => now, limits: { ttlMs: 100 } }); const item = await expiring.post(); await expiring.wait(item.id); now += 200; await expiring.manager.sweep(); assert.throws(() => expiring.manager.get(item.id, 1));
});

test('isolated child timeout/crash/output bound/cancel and environment allowlist are enforced', async t => {
  const h = await harness(t);
  const fixture = path.join(h.root, 'worker.cjs'), pdf = path.join(h.root, 'input.pdf'); await fs.writeFile(pdf, makePdf([clause]));
  const limits = { ...h.limits, parserTimeoutMs: 500 };
  await fs.writeFile(fixture, 'setInterval(()=>{},1000)');
  const parser = new IsolatedPdfParser(limits, fixture);
  await assert.rejects(parser.parse(pdf, path.join(h.root, 'timeout.json'), new AbortController().signal), (e: AppError) => e.code === 'PDF_PARSE_TIMEOUT');
  await fs.writeFile(fixture, 'process.exit(12)');
  await assert.rejects(new IsolatedPdfParser(limits, fixture).parse(pdf, path.join(h.root, 'crash.json'), new AbortController().signal), (e: AppError) => e.code === 'PDF_WORKER_CRASH');
  await fs.writeFile(fixture, 'process.stdout.write("x".repeat(20000));setInterval(()=>{},1000)');
  await assert.rejects(new IsolatedPdfParser(limits, fixture).parse(pdf, path.join(h.root, 'output.json'), new AbortController().signal), (e: AppError) => e.code === 'PDF_WORKER_OUTPUT');
  await fs.writeFile(fixture, 'setInterval(()=>{},1000)'); const controller = new AbortController(); const stopped = new IsolatedPdfParser(limits, fixture).parse(pdf, path.join(h.root, 'cancel.json'), controller.signal); setTimeout(() => controller.abort(), 50);
  await assert.rejects(stopped, (e: AppError) => e.code === 'REQUEST_CANCELLED');
  process.env.CONTRACT_TEST_SECRET = 'must-not-inherit';
  await fs.writeFile(fixture, 'const fs=require("node:fs");const bad=Object.keys(process.env).some(k=>/^(AI_|DB_|JWT_|CONTRACT_TEST_SECRET|NODE_OPTIONS)/.test(k));if(bad)process.exit(13);const text="Residential rental agreement sample.";fs.writeFileSync(process.argv[3],JSON.stringify({pages:[{page:1,text}],pageCount:1,characterCount:text.length}));process.stdout.write(JSON.stringify({success:true}));');
  const parsed = await new IsolatedPdfParser({ ...limits, parserTimeoutMs: 3000 }, fixture).parse(pdf, path.join(h.root, 'env.json'), new AbortController().signal); assert.equal(parsed.pageCount, 1); delete process.env.CONTRACT_TEST_SECRET;
});

test('quota reserves original and intermediate bytes atomically, preserves failed cleanup reservations and rejects a live second owner', async t => {
  const h = await harness(t, { limits: { parserOutputBytes: 10000, quotaBytes: 1024 * 1024 + 10000 + 1000, freeMarginBytes: 0 } });
  await h.storage.initialize();
  const first = randomUUID(), second = randomUUID();
  const results = await Promise.allSettled([h.storage.reserve(first, 1000), h.storage.reserve(second, 1000)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(h.storage.reservedBytes >= 1000 + 10000);
  await assert.rejects(new ContractTempStorage(h.limits).initialize(), (e: AppError) => e.code === 'CONTRACT_STORAGE_BUSY');
  const id = results[0].status === 'fulfilled' ? first : second;
  await h.storage.cleanup(id); assert.equal(h.storage.reservedBytes, 0);
});

test('extra multipart fields/files and claimed max size cannot bypass preflight or byte checks', async t => {
  const h = await harness(t);
  for (const multipleFiles of [false, true]) {
    const id = randomUUID(), buffer = makePdf([clause]), form = new FormData(); form.append('file', new Blob([Uint8Array.from(buffer)], { type: 'application/pdf' }), 'test.pdf');
    if (multipleFiles) form.append('file', new Blob([Uint8Array.from(buffer)], { type: 'application/pdf' }), 'other.pdf'); else form.append('extra', 'not allowed');
    const response = await fetch(h.base + '/tasks', { method: 'POST', headers: { ...h.auth(), 'X-Contract-Task-Id': id, 'X-Contract-File-Size': String(buffer.length) }, body: form }); assert.equal(response.status, 400); await h.manager.remove(id, 1);
  }
  const rejected = await h.post(makePdf([clause]), 1, h.limits.maxBytes + 1); assert.equal(rejected.response.status, 413); assert.equal(h.storage.reservedBytes, 0);
});

test('default300-page/600000-character boundary passes; one extra page or character fails before model calls', async t => {
  const h = await harness(t);
  const pages = Array(300).fill('A'.repeat(1972));
  const combined = path.join(h.root, 'combined-boundary.pdf'); await writePdfFixture(combined, pages, 100 * 1024 * 1024);
  const accepted = await h.post(await openAsBlob(combined, { type: 'application/pdf' })); const done = await h.wait(accepted.id);
  assert.equal(done.state, 'completed'); assert.equal(done.receivedBytes, 100 * 1024 * 1024); assert.equal(done.pageCount, 300); assert.equal(done.characterCount, 600000); assert.ok(done.chunks.length <= 64);
  t.diagnostic(JSON.stringify({ type: 'combined-boundary', receivedBytes: done.receivedBytes, pages: done.pageCount, characters: done.characterCount, blocks: done.chunks.length, inputMaxCharacters: done.stats.inputMaxCharacters, model: 'deterministic-stub' }));
  await h.manager.remove(accepted.id, 1);
  const extraPage = await h.post(makePdf(Array(301).fill(clause))); const pageResult = await h.wait(extraPage.id); assert.equal(pageResult.errorCode, 'PDF_PAGE_LIMIT'); assert.equal(pageResult.stats.modelCalls, 0); await h.manager.remove(extraPage.id, 1);
  const extraCharacter = [...pages]; extraCharacter[0] += 'A'; const beyond = await h.post(makePdf(extraCharacter)); const textResult = await h.wait(beyond.id); assert.equal(textResult.errorCode, 'PDF_TEXT_LIMIT'); assert.equal(textResult.stats.modelCalls, 0);
});

test('failed cleanup keeps reserved quota until a subsequent sweep succeeds', async t => {
  const h = await harness(t); const cleanup = h.storage.cleanup.bind(h.storage);
  h.storage.cleanup = async () => { throw new Error('simulated EBUSY'); };
  t.after(() => { h.storage.cleanup = cleanup; });
  try {
    const uploaded = await h.post(); let task: any;
    for (let n = 0; n < 200; n++) { task = (await (await fetch(`${h.base}/tasks/${uploaded.id}`, { headers: h.auth() })).json() as any).data; if (task.state === 'completed') break; await sleep(20); }
    assert.equal(task.state, 'completed'); assert.equal(task.cleanupPending, true); assert.ok(h.storage.reservedBytes > 0);
    h.storage.cleanup = cleanup; await h.manager.sweep(); assert.equal(h.storage.reservedBytes, 0);
  } finally { h.storage.cleanup = cleanup; }
});

test('Unicode PDF text and UTF16 source offsets survive extraction and splitting', async t => {
  const h = await harness(t);
  const uploaded = await h.post(makePdf(['房屋租赁合同。押金一律不退，所有结构维修费由承租人承担。出租人随时可进入房屋。']));
  const done = await h.wait(uploaded.id); assert.equal(done.state, 'completed'); assert.ok(done.characterCount >= 30);
  const text = ('甲'.repeat(498) + '🏠' + '乙'.repeat(200) + '\n').repeat(4);
  const chunks = splitContract([{ page: 1, text }], { ...readContractLimits(), chunkCharacters: 500, overlapCharacters: 100, sharedCharacters: 0 }).chunks;
  for (const segment of chunks.flatMap(c => c.segments)) assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(segment.text));
});

test('task call budget stops additional API attempts and cannot be bypassed by manual retry', async t => {
  let calls = 0;
  const h = await harness(t, { limits: { chunkCharacters: 600, overlapCharacters: 100, sharedCharacters: 0, maxCalls: 1 }, model: async () => { calls++; return { summary: 'Budget fixture.', findings: [] }; } });
  const uploaded = await h.post(makePdf([clause.repeat(30)])), done = await h.wait(uploaded.id);
  assert.equal(calls, 1); assert.equal(done.stats.modelCalls, 1); assert.equal(done.state, 'partial');
  assert.ok(done.chunks.some((c: any) => c.errorCode === 'CONTRACT_CALL_LIMIT'));
  assert.equal((await fetch(`${h.base}/tasks/${uploaded.id}/retry`, { method: 'POST', headers: h.auth() })).status, 409);
  assert.equal(calls, 1);
});

test('global model concurrency is bounded across accounts and cancelled queued blocks never call the model', async t => {
  const finishes: (() => void)[] = []; let active = 0, peak = 0, calls = 0;
  const parser = { parse: async () => ({ pages: [{ page: 1, text: clause }], pageCount: 1, characterCount: clause.length }) };
  const h = await harness(t, { parser, model: async () => { calls++; active++; peak = Math.max(peak, active); await new Promise<void>(resolve => finishes.push(resolve)); active--; return { summary: 'Concurrent fixture.', findings: [] }; } });
  const one = await h.post(makePdf([clause]), 1), two = await h.post(makePdf([clause]), 2);
  for (let n = 0; n < 200 && calls < 2; n++) await sleep(10);
  assert.equal(calls, 2);
  const queued = await h.post(makePdf([clause]), 3); await sleep(30); await h.manager.remove(queued.id, 3);
  assert.equal(calls, 2); assert.equal(peak, 2); finishes.forEach(resolve => resolve());
  assert.equal((await h.wait(one.id)).state, 'completed'); assert.equal((await h.wait(two.id, 2)).state, 'completed');
});

test('session expiry aborts the in-flight model and prevents automatic retry', async t => {
  let calls = 0;
  const parser = { parse: async () => ({ pages: [{ page: 1, text: clause }], pageCount: 1, characterCount: clause.length }) };
  const h = await harness(t, { parser, model: async (_m, signal) => { calls++; return new Promise((_resolve, reject) => { const stop = () => reject(signal!.reason); signal!.addEventListener('abort', stop, { once: true }); if (signal!.aborted) stop(); }); } });
  const task = await h.manager.create(1, 'local', randomUUID(), 100, Date.now() + 100); h.manager.accept(task, 'fixture.pdf');
  const done = await h.wait(task.id); assert.equal(done.state, 'cancelled'); assert.equal(done.errorCode, 'AUTH_EXPIRED'); assert.equal(calls, 1); assert.equal(done.stats.retries, 0); assert.equal(h.storage.reservedBytes, 0);
  let now = Date.now(), retryCalls = 0;
  const expired = await harness(t, { now: () => now, limits: { chunkCharacters: 600, overlapCharacters: 100, sharedCharacters: 0, blockRetries: 0 }, parser: { parse: async () => ({ pages: [{ page: 1, text: clause.repeat(20) }], pageCount: 1, characterCount: clause.repeat(20).length }) }, model: async messages => { retryCalls++; if (JSON.parse(messages[1].content).block === 2) throw new AppError(504, 'AI_TIMEOUT', 'fixture'); return { summary: 'Partial fixture.', findings: [] }; } });
  const partial = await expired.manager.create(1, 'local', randomUUID(), 100, now + 1000); expired.manager.accept(partial, 'fixture.pdf'); await partial.work; assert.equal(partial.state, 'partial'); const previousCalls = retryCalls;
  now += 2000; await assert.rejects(expired.manager.retry(partial.id, 1, 'local'), (e: AppError) => e.code === 'CONTRACT_RETRY_UNAVAILABLE'); assert.equal(retryCalls, previousCalls);
});

test('parser queue respects one child, queued cancellation and bounded on-disk output', async t => {
  const h = await harness(t), worker = path.join(h.root, 'queue.cjs'), source = path.join(h.root, 'queue.pdf'); await fs.writeFile(source, makePdf([clause]));
  await fs.writeFile(worker, 'const fs=require("node:fs");fs.writeFileSync(process.argv[3]+".started","");setTimeout(()=>{const text="Rental contract queue fixture";fs.writeFileSync(process.argv[3],JSON.stringify({pages:[{page:1,text}],pageCount:1,characterCount:text.length}));process.stdout.write(JSON.stringify({success:true}));},350);');
  const parser = new IsolatedPdfParser({ ...h.limits, parserConcurrency: 1, parserTimeoutMs: 3000 }, worker);
  const first = new AbortController(), queued = new AbortController();
  const output1 = path.join(h.root, 'one.json'), output2 = path.join(h.root, 'two.json'), output3 = path.join(h.root, 'three.json');
  const one = parser.parse(source, output1, first.signal); const rejectedOne = assert.rejects(one, (e: AppError) => e.code === 'REQUEST_CANCELLED');
  for (let n = 0; n < 100; n++) { if (await fs.stat(output1 + '.started').catch(() => null)) break; await sleep(10); }
  const two = parser.parse(source, output2, new AbortController().signal), three = parser.parse(source, output3, queued.signal);
  const rejectedThree = assert.rejects(three); queued.abort(); await rejectedThree;
  assert.equal(await fs.stat(output2 + '.started').catch(() => null), null); first.abort(); await rejectedOne; assert.equal((await two).pageCount, 1); assert.equal(await fs.stat(output3 + '.started').catch(() => null), null);
  await fs.writeFile(worker, 'require("node:fs").writeFileSync(process.argv[3],"x".repeat(20000));process.stdout.write(JSON.stringify({success:true}));');
  await assert.rejects(new IsolatedPdfParser({ ...h.limits, parserOutputBytes: 10000 }, worker).parse(source, path.join(h.root, 'huge.json'), new AbortController().signal), (e: AppError) => e.code === 'PDF_OUTPUT_LIMIT');
});

test('parser guard kills a CPU-blocked process on hard deadline or owner death', async t => {
  const h = await harness(t), fixture = path.join(h.root, 'guard.cjs');
  await fs.writeFile(fixture, `require(${JSON.stringify(path.resolve(__dirname, '../contracts/parserGuard.js'))}).startParserGuard(Number(process.argv[2]),Number(process.argv[3]));process.stdout.write('ready');while(true){}`);
  const start = async (owner: number, timeout: number) => {
    const child = spawn(process.execPath, [fixture, String(owner), String(timeout)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const exited = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
    return { child, exited };
  };
  const deadline = await start(process.pid, 200);
  await Promise.race([deadline.exited, sleep(3000).then(() => { throw new Error('CPU-blocked worker exceeded hard deadline'); })]);
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' }); assert.ok(owner.pid);
  t.after(() => { if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL'); });
  const orphan = await start(owner.pid, 10000); owner.kill('SIGKILL');
  await Promise.race([orphan.exited, sleep(3000).then(() => { throw new Error('Orphan parser survived owner death'); })]);
});

test('JSON-escaped text shrinks to input budget without losing original offsets', () => {
  const text = '"\\\n🏠'.repeat(1800), limits = { ...readContractLimits(), sharedCharacters: 0, chunkCharacters: 10000, maxInputCharacters: 4000 };
  const { chunks, shared } = splitContract([{ page: 1, text }], limits);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flatMap(c => c.segments).filter(s => !s.overlap).map(s => s.text).join(''), text);
  for (const chunk of chunks) { assert.ok(buildChunkMessages(chunk, shared).reduce((n, m) => n + m.content.length, 0) <= 4000); for (const s of chunk.segments) assert.equal(s.text, text.slice(s.start, s.end)); }
});
