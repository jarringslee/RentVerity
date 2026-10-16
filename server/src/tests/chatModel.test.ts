import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createChatModel, SseFrames } from '../services/chatModel';
import { AppError } from '../utils/AppError';

test('SSE parser handles arbitrary splits, CRLF, comments and multi-line data with bounded memory', () => {
  const frames = new SseFrames();
  assert.deepEqual(frames.feed(': heartbeat\r\neve'), []);
  assert.deepEqual(frames.feed('nt: delta\r\ndata: 一行\r\ndata: 第二'), []);
  assert.deepEqual(frames.feed('行\r\n\r\nevent: done\ndata: {}\n\n'), [{ event: 'delta', data: '一行\n第二行' }, { event: 'done', data: '{}' }]);
  assert.throws(() => frames.feed('x'.repeat(256001)), AppError);
  const many = new SseFrames();
  assert.throws(() => { for (let i = 0; i < 300; i++) many.feed('data: ' + 'x'.repeat(1000) + '\n'); }, AppError);
});

test('real local HTTP adapter validates tool protocol and incremental UTF-8/SSE, errors and abort', async t => {
  let mode = 'valid', ended = false;
  const makeData = (content: string | null, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer protocol-only-key');
    if (mode === 'unauthorized' || mode === 'rate') { res.writeHead(mode === 'rate' ? 429 : 401); res.end('private provider text'); return; }
    if (!body.stream) {
      assert.equal(body.tool_choice, 'required'); assert.ok(Array.isArray(body.tools));
      const call = { id: 'protocol-call', type: 'function', function: { name: 'test_tool', arguments: '{}' } };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: mode === 'parallel' ? [call, call] : [call] } }] })); return;
    }
    if (mode === 'invalid-content-type') { res.end('{}'); return; }
    res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
    if (mode === 'timeout') return;
    if (mode === 'bad-json') { res.end('data: {broken\n\n'); return; }
    if (mode === 'tool-in-text') { res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] })}\n\n`); return; }
    ended = false;
    const bytes = Buffer.from(': heartbeat\r\n\r\n' + makeData('你好🏠\n**第一段**'));
    // 每次只发一个字节，覆盖中文/emoji、JSON、CRLF 边界；不是模拟业务成功。
    for (let i = 0; i < bytes.length; i++) { if (res.destroyed) return; res.write(bytes.subarray(i, i + 1)); await new Promise<void>(resolve => setImmediate(resolve)); }
    await new Promise(resolve => setTimeout(resolve, 20));
    if (res.destroyed) return;
    if (mode === 'disconnect') { ended = true; res.end(); return; }
    if (mode === 'length') { ended = true; res.end(makeData(null, 'length') + 'data: [DONE]\n\n'); return; }
    const tail = makeData('第二段') + makeData(null, 'stop') + (mode === 'missing-done' ? '' : 'data: [DONE]\n\n');
    ended = true; res.end(tail);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const config = { apiKey: 'protocol-only-key', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'local-protocol-stub', timeoutMs: 3000 };
  const model = createChatModel(config), signal = new AbortController().signal, messages = [{ role: 'user' as const, content: '合成协议测试' }];
  assert.equal((await model.choose(messages, [], signal)).function.name, 'test_tool');
  let result = '', sawBeforeEnd = false;
  await model.stream(messages, async text => { result += text; if (!ended) sawBeforeEnd = true; }, signal);
  assert.equal(result, '你好🏠\n**第一段**第二段'); assert.equal(sawBeforeEnd, true);
  mode = 'parallel'; await assert.rejects(model.choose(messages, [], signal), (error: AppError) => error.code === 'AI_TOOL_INVALID');
  for (const [next, code] of [['unauthorized', 'AI_AUTH_FAILED'], ['rate', 'AI_RATE_LIMIT'], ['bad-json', 'AI_INVALID_RESPONSE'], ['tool-in-text', 'AI_TOOL_INVALID'], ['disconnect', 'AI_STREAM_INTERRUPTED'], ['missing-done', 'AI_STREAM_INTERRUPTED'], ['length', 'AI_TRUNCATED'], ['invalid-content-type', 'AI_STREAM_INVALID']]) {
    mode = next;
    await assert.rejects(model.stream(messages, async () => {}, signal), (error: AppError) => error.code === code && !error.message.includes('private provider text'));
  }
  mode = 'timeout';
  await assert.rejects(createChatModel({ ...config, timeoutMs: 70 }).stream(messages, async () => {}, signal), (error: AppError) => error.code === 'AI_TIMEOUT');
  mode = 'valid'; const cancelled = new AbortController();
  await assert.rejects(model.stream(messages, async () => { cancelled.abort(); }, cancelled.signal), (error: AppError) => error.code === 'REQUEST_CANCELLED');
});
