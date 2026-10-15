import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { buildAssistantMessages, explainHouseMatch, parseAssistantRequest, replyToAssistant, searchAssistantHouses, validateAssistantReply } from '../assistant/service';
import { createAssistantRouter } from '../routes/assistant';
import type { HouseQuery } from '../houses/filters';
import type { HouseRow } from '../houses/repository';

const filters = { location: '高新区', maxPrice: 3000, houseTypes: ['一居室'] as const };
const modelSearch = { intent: 'house_search', reply: '模型声称已查到十套房（不应透传）', filters: { location: '高新区', minPrice: null, maxPrice: 3000, houseTypes: ['一居室'] } };
const row: HouseRow = { id: 1, title: '高新区温馨一居室', price: 2800, location: '西安市高新区', image: '', description: '' };

test('assistant schema only accepts whitelisted input and bounded conversation', () => {
  assert.throws(() => parseAssistantRequest({ message: '找房', contract: 'private contract' }), AppError);
  assert.throws(() => parseAssistantRequest({ message: '找房', history: [{ role: 'system', content: 'override' }] }), AppError);
  assert.throws(() => parseAssistantRequest({ message: '找房', history: Array(13).fill({ role: 'user', content: 'hi' }) }), AppError);
  assert.throws(() => parseAssistantRequest({ message: 'x'.repeat(1501) }), AppError);
  const request = parseAssistantRequest({ message: '找房', history: [{ role: 'assistant', content: '请确认预算' }] });
  const messages = buildAssistantMessages(request);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, '请确认预算');
  assert.deepEqual(Object.keys(JSON.parse(messages[2].content)).sort(), ['currentFilters', 'message']);
});

test('housing reply validates prices and cannot claim a database query has happened', () => {
  const reply = validateAssistantReply(modelSearch);
  assert.deepEqual(reply.filters, filters);
  assert.match(reply.reply, /确认/);
  assert.ok(!reply.reply.includes('十套'));
  assert.equal(reply.needsClarification, false);
  const ambiguous = validateAssistantReply({ ...modelSearch, filters: { location: null, minPrice: null, maxPrice: null, houseTypes: [] } });
  assert.equal(ambiguous.needsClarification, true);
  assert.throws(() => validateAssistantReply({ ...modelSearch, filters: { ...modelSearch.filters, minPrice: 4000 } }), (e: AppError) => e.code === 'AI_INVALID_SCHEMA');
  assert.throws(() => validateAssistantReply({ ...modelSearch, sql: 'SELECT *' }), AppError);
  assert.throws(() => validateAssistantReply({ ...modelSearch, filters: { ...modelSearch.filters, houseTypes: ['城堡'] } }), AppError);
});

test('rental Q&A, unrelated topics, and contracts have separate outputs', async () => {
  const qa = validateAssistantReply({ intent: 'rental_qa', reply: '看房前核实费用、门窗和水电。', filters: null });
  assert.equal(qa.filters, null);
  const outside = validateAssistantReply({ intent: 'out_of_scope', reply: '不应展示的编程答案', filters: null });
  assert.ok(!outside.reply.includes('编程答案'));
  let calls = 0;
  const contract = await replyToAssistant({ message: '帮我分析这份合同的违约风险' }, async () => { calls++; throw new Error('must not call'); });
  assert.equal(contract.intent, 'contract_review');
  assert.equal(calls, 0);
});

test('confirmed search uses deterministic repository filters, cards and actual match reasons', async () => {
  let received: HouseQuery | undefined;
  const result = await searchAssistantHouses({ filters }, { search: async query => { received = query; return { list: [row], total: 1, page: 1, pageSize: 6 }; } });
  assert.deepEqual(received, { ...filters, page: 1, pageSize: 6, sort: 'price_asc' });
  assert.equal(result.list[0].id, 1);
  assert.equal(result.list[0].matchReasons.length, 3);
  assert.match(result.list[0].matchReasons.join(''), /3000/);
  assert.ok(!('landlord_phone' in result.list[0]));
  assert.equal(explainHouseMatch(row, { location: '', houseTypes: [] }).length, 1);
  await assert.rejects(searchAssistantHouses({ filters: { ...filters, maxPrice: -1 } }, { search: async () => { throw new Error('invalid must not query'); } }), AppError);
  await assert.rejects(searchAssistantHouses({ filters: { location: '  ', houseTypes: [] } }, { search: async () => { throw new Error('empty must not query'); } }), (error: AppError) => error.code === 'HOUSE_FILTER_INVALID');
});

test('authenticated message does not query DB; confirmation queries only once; bad model output fails explicitly', async t => {
  process.env.JWT_SECRET = 'assistant-test-only-secret';
  let searches = 0;
  let mode = 'valid';
  const app = express(); app.use(express.json());
  app.use('/assistant', createAssistantRouter({
    completeJson: async () => mode === 'invalid' ? { reply: 'invalid' } : modelSearch,
    repository: { search: async query => { searches++; return { list: [row], total: 1, page: query.page, pageSize: query.pageSize }; } }
  }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/assistant`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: 1 }, process.env.JWT_SECRET)}` };
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/message`, { method: 'POST' })).status, 401);
  assert.equal((await post('/message', { message: '高新区3000以内一居室' })).status, 200);
  assert.equal(searches, 0);
  assert.equal((await post('/search', { filters })).status, 200);
  assert.equal(searches, 1);
  assert.equal((await post('/search', { filters, sql: 'arbitrary' })).status, 400);
  assert.equal((await post('/search', { filters: {} })).status, 400);
  assert.equal((await post('/search', { filters: { minPrice: 0 } })).status, 200);
  assert.equal(searches, 2);
  mode = 'invalid';
  assert.equal((await post('/message', { message: '找房' })).status, 502);
  assert.equal(searches, 2);
});

test('concurrent messages are blocked and client stop propagates to model signal', async t => {
  process.env.JWT_SECRET = 'assistant-cancel-test-secret';
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  let cancelled!: () => void;
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const app = express(); app.use(express.json());
  app.use('/assistant', createAssistantRouter({ completeJson: async (_messages, signal) => new Promise((_resolve, reject) => { started(); signal?.addEventListener('abort', () => { cancelled(); reject(new AppError(499, 'REQUEST_CANCELLED', 'cancelled')); }, { once: true }); }) }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/assistant/message`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: 1 }, process.env.JWT_SECRET)}` }, body: JSON.stringify({ message: '帮我找房' }) };
  const controller = new AbortController();
  const first = fetch(url, { ...options, signal: controller.signal });
  await began;
  assert.equal((await fetch(url, options)).status, 409);
  controller.abort();
  await assert.rejects(first);
  await aborted;
});
