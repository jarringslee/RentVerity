import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError';
import { runAssistant, parseAssistantRequest } from '../assistant/service';
import { AssistantExecution, AssistantExecutionError } from '../assistant/execution';
import { checkSearchConditions } from '../assistant/constraints';
import type { AssistantEvent, ExecutionSummary } from '../assistant/protocol';
import type { AssistantModel, ToolCall } from '../services/chatModel';
import type { HouseRepository } from '../houses/repository';
import { createAssistantRouter } from '../routes/assistant';
import { createSession, SESSION_COOKIE } from '../auth/session';

const args = { city: '西安市', location: null, minPrice: null, maxPrice: 3000, houseTypes: ['一居室'], unavailablePreferences: [] };
const makeCall = (patch: object = {}, name = 'search_houses'): ToolCall => ({ id: 'fixture-call', type: 'function', function: { name, arguments: JSON.stringify({ ...args, ...patch }) } });
const request = { message: '帮我找西安，一居室，月租不超过3000元' };
function harness(choose?: AssistantModel['choose'], stream?: AssistantModel['stream'], repositoryError?: Error) {
  let selections = 0, generations = 0, queries = 0;
  const events: AssistantEvent[] = [], logs: object[] = [];
  const model: AssistantModel = {
    choose: async (...parameters) => { selections++; return choose ? choose(...parameters) : makeCall(); },
    stream: async (...parameters) => { generations++; if (stream) return stream(...parameters); await parameters[1]('合成说明；状态以执行器为准。'); }
  };
  const repo: HouseRepository = { search: async query => {
    queries++; if (repositoryError) throw repositoryError;
    return { list: [{ id: 1, title: '合成房源', city: query.city, house_type: '一居室', price: 2500, location: '西安市', image: '', description: 'private source must not enter logs' }], total: 1, page: query.page, pageSize: query.pageSize };
  } };
  return { model, repo, events, logs, counts: () => ({ selections, generations, queries }), run: (body: unknown = request, signal = new AbortController().signal, assertActive = () => {}) => runAssistant(parseAssistantRequest(body), model, repo, async event => { events.push(event); }, signal, { audit: entry => logs.push(entry), assertActive }) };
}

test('pre-execution missing-call/JSON/type correction runs once and does not duplicate the query', async t => {
  for (const mode of ['missing', 'json', 'type', 'wrong-selection']) await t.test(mode, async () => {
    let attempts = 0;
    const h = harness(async () => {
      if (attempts++ === 0) {
        if (mode === 'missing') throw new AppError(502, 'AI_TOOL_MISSING', 'missing');
        if (mode === 'json') return { ...makeCall(), function: { name: 'search_houses', arguments: '{broken' } };
        if (mode === 'type') return makeCall({ maxPrice: '3000' });
        return { ...makeCall(), function: { name: 'respond_to_user', arguments: '{"kind":"rental_qa"}' } };
      }
      return makeCall();
    });
    const outcome = await h.run();
    assert.deepEqual(h.counts(), { selections: 2, generations: 1, queries: 1 });
    assert.equal(outcome.correctionCount, 1); assert.equal(outcome.modelCalls, 3);
    assert.ok(h.logs.some(entry => (entry as { stage: string; errorCode: string }).stage === 'correcting' && (entry as { errorCode: string }).errorCode.startsWith('AI_TOOL_')));
    const names = h.events.map(event => event.event);
    assert.ok(names.indexOf('houses') > names.indexOf('execution'));
    assert.ok(names.indexOf('houses') < names.indexOf('generation')); assert.equal(names.at(-1), 'done');
    assert.equal(new Set(h.events.map(event => event.data.requestId)).size, 1);
  });
});

test('unknown tools/extra privileged parameters are refused without correction or SQL', async () => {
  for (const call of [makeCall({}, 'run_sql'), makeCall({}, 'delete_houses'), makeCall({ sql: 'DROP TABLE users' }), makeCall({ userId: 99 })]) {
    const h = harness(async () => call);
    await assert.rejects(h.run(), (error: AppError) => error.code === 'AI_TOOL_FORBIDDEN');
    assert.deepEqual(h.counts(), { selections: 1, generations: 0, queries: 0 });
  }
});

test('correction exhaustion and model network faults do not trigger broader retries', async () => {
  const repeated = harness(async () => { throw new AppError(502, 'AI_TOOL_MISSING', 'missing'); });
  await assert.rejects(repeated.run()); assert.equal(repeated.counts().selections, 2); assert.equal(repeated.counts().queries, 0);
  const network = harness(async () => { throw new AppError(504, 'AI_TIMEOUT', 'timeout'); });
  await assert.rejects(network.run()); assert.equal(network.counts().selections, 1);
});

test('cancel/identity loss between selection attempts prevents correction and query', async () => {
  for (const mode of ['cancel', 'identity']) {
    const controller = new AbortController(); let valid = true;
    const h = harness(async () => { if (mode === 'cancel') controller.abort(); else valid = false; throw new AppError(502, 'AI_TOOL_MISSING', 'missing'); });
    await assert.rejects(h.run(request, controller.signal, () => { if (!valid) throw new AppError(401, 'AUTH_EXPIRED', 'expired'); }));
    assert.deepEqual(h.counts(), { selections: 1, generations: 0, queries: 0 });
  }
});

test('query failure publishes no cards and does not generate a claimed success', async () => {
  const h = harness(undefined, undefined, new Error('private SQL values must not leak'));
  await assert.rejects(h.run(), (e: AppError) => e.code === 'HOUSE_QUERY_FAILED');
  assert.deepEqual(h.counts(), { selections: 1, generations: 0, queries: 1 });
  assert.equal(h.events.some(event => event.event === 'houses' || event.event === 'done'), false);
  assert.ok(h.events.some(event => event.event === 'execution' && event.data.queryState === 'failed'));
  assert.ok(!JSON.stringify(h.logs).includes('private SQL'));
});

test('generation failure preserves confirmed result, IDs, query count and safe audit metadata', async () => {
  const h = harness(undefined, async (_messages, delta) => { await delta('已经收到部分说明'); throw new AppError(504, 'AI_TIMEOUT', 'private upstream body'); });
  await assert.rejects(h.run(), (e: AssistantExecutionError) => e.summary.queryState === 'succeeded' && e.summary.answerState === 'failed' && e.summary.queryCount === 1 && /卡片已保留/.test(e.message));
  assert.equal(h.events.filter(e => e.event === 'houses').length, 1);
  assert.equal(h.events.some(e => e.event === 'done'), false);
  assert.equal(h.counts().queries, 1);
  assert.ok(!JSON.stringify(h.logs).includes(request.message));
  assert.ok(!JSON.stringify(h.logs).includes('private')); assert.ok(!JSON.stringify(h.logs).includes('2500'));
});

test('executor refuses a second query, even after first failure', async () => {
  const executor = new AssistantExecution(async () => {}, new AbortController().signal, () => {}, () => {});
  await assert.rejects(executor.query(async () => { throw new AppError(503, 'HOUSE_QUERY_FAILED', 'fault'); }));
  let called = false;
  await assert.rejects(executor.query(async () => { called = true; return {} as any; }), (e: AppError) => e.code === 'QUERY_ALREADY_EXECUTED');
  assert.equal(called, false); assert.equal(executor.snapshot().queryCount, 1);
});

test('SSE write failure cannot count a query that never entered the repository', async () => {
  let queries = 0;
  const executor = new AssistantExecution(async () => { throw new Error('fixture write failure'); }, new AbortController().signal, () => {}, () => {});
  await assert.rejects(executor.query(async () => { queries++; throw new Error('fixture database failure'); }));
  assert.equal(queries, 1); assert.equal(executor.snapshot().queryCount, queries);
});

test('explicit city/budget/type mismatches and ambiguity clarify without retrying semantics', () => {
  for (const [message, patch] of [
    ['西安一居室3000以内', { city: '北京市' }], ['西安一居室3000以内', { maxPrice: 5000 }],
    ['西安一居室2000到3000', { minPrice: null }], ['西安一居室3000以内', { houseTypes: ['两居室'] }],
    ['西安或北京一居室3000以内', {}], ['西安一居室预算3000左右', {}], ['西安一居室预算2000或3000', {}],
    ['高新区一居室3000以内', {}], ['西安一居室最低4000最高3000', { minPrice: 4000 }],
    ['西安一居室年租三万', {}], ['西安一居室月租低于3000', {}], ['西安不要合租', { maxPrice: null, houseTypes: [] }]
  ] as [string, object][]) assert.equal(checkSearchConditions(parseAssistantRequest({ message }), { ...args, ...patch }).ok, false, message);
  for (const [message, patch] of [['西安一居室两千以内', { maxPrice: 2000 }], ['西安一居室3k以下', {}], ['西安一居室2500到3000', { minPrice: 2500 }], ['西安一居室三千以内，押金一千', {}]] as [string, object][]) assert.equal(checkSearchConditions(parseAssistantRequest({ message }), { ...args, ...patch }).ok, true, message);
  assert.equal(checkSearchConditions(parseAssistantRequest({ message: '帮我找西安，其他条件全部不限。请回答不超过180字。' }), { ...args, maxPrice: null, houseTypes: [] }).ok, true);
  assert.equal(checkSearchConditions(parseAssistantRequest({ message: '西安一居室月租3000以内且回答不超过180字' }), args).ok, true);
});

test('legal/common rental questions no longer bypass the model to the contract page', async () => {
  for (const message of ['房东未经允许进屋是否违法？', '押一付五是否合理？', '合同约定押金不退，我该怎么沟通？']) {
    const h = harness(async () => ({ ...makeCall(), function: { name: 'respond_to_user', arguments: '{"kind":"rental_qa"}' } }));
    await h.run({ message }); assert.deepEqual(h.counts(), { selections: 1, generations: 1, queries: 0 });
    assert.ok(h.events.some(e => e.event === 'context' && e.data.intent === 'rental_qa'));
  }
});

test('explicit multi-turn budget replacement and excluding the previous city remain consistent', () => {
  const history = [{ role: 'user' as const, content: '帮我找西安高新区一居室，月租3000以内。' }];
  const first = parseAssistantRequest({ message: '月租上限改成2500元，其他条件不变。', history });
  assert.equal(checkSearchConditions(first, { ...args, location: '高新区', maxPrice: 2500 }).ok, true);
  const second = parseAssistantRequest({ message: '改去北京找房，月租和房型不变，不沿用西安的高新区。', history: [...history, { role: 'user', content: first.message }], context: { city: '西安市', location: '高新区', maxPrice: 2500, houseTypes: ['一居室'] } });
  const checked = checkSearchConditions(second, { ...args, city: '北京市', location: null, maxPrice: 2500 });
  assert.equal(checked.ok, true);
});

test('insufficient conditions and multiple-city tool proposals clarify without retry or execution', async () => {
  for (const choose of [async () => makeCall({ minPrice: -1 }), async () => { throw new AppError(502, 'AI_TOOL_MULTIPLE_SEARCH', 'multiple'); }]) {
    const h = harness(choose);
    await h.run({ message: '西安或者北京，月租3000以内，帮我找房。' });
    assert.deepEqual(h.counts(), { selections: 1, generations: 1, queries: 0 });
    assert.ok(h.events.some(e => e.event === 'context' && e.data.needsClarification));
    assert.equal(h.events.at(-1)?.event, 'done');
  }
});

test('HTTP/SSE failure carries execution summary; cards survive only a real successful query', async t => {
  process.env.JWT_SECRET = 'reliability-test-only-secret';
  const h = harness(undefined, async () => { throw new AppError(504, 'AI_TIMEOUT', 'fault'); });
  const app = express(); app.use(express.json()); app.use('/assistant', createAssistantRouter({ model: h.model, repository: h.repo, audit: () => {} }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/assistant/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${createSession(1).token}` }, body: JSON.stringify(request) });
  const text = await response.text();
  assert.ok(text.indexOf('event: houses') < text.indexOf('event: error'));
  const error = JSON.parse(text.split('event: error\ndata: ')[1].trim()) as ExecutionSummary & { retainResults: boolean };
  assert.equal(error.queryState, 'succeeded'); assert.equal(error.answerState, 'failed'); assert.equal(error.retainResults, true); assert.equal(error.queryCount, 1);
  assert.ok(!text.includes('event: done'));
});

test('real HTTP session expiry aborts selection before correction or query', async t => {
  process.env.JWT_SECRET = 'reliability-test-only-secret';
  const h = harness(async (_messages, _tools, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new AppError(502, 'AI_TOOL_MISSING', 'expired during selection')), { once: true })));
  const app = express(); app.use(express.json()); app.use('/assistant', createAssistantRouter({ model: h.model, repository: h.repo, audit: () => {} }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const token = jwt.sign({ userId: 1, jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: 2 });
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/assistant/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify(request) });
  const text = await response.text(); assert.match(text, /AUTH_EXPIRED/);
  assert.deepEqual(h.counts(), { selections: 1, generations: 0, queries: 0 });
  assert.ok(!text.includes('event: houses')); assert.ok(!text.includes('correcting'));
});
