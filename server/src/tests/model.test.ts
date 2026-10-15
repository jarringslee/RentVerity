import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createModelClient, readModelConfig } from '../services/modelClient';
import { AppError } from '../utils/AppError';

test('missing independent model key is explicit and never falls back to demo output', () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try { assert.throws(readModelConfig, (error: AppError) => error.code === 'AI_NOT_CONFIGURED'); }
  finally { if (saved !== undefined) process.env.AI_API_KEY = saved; }
});

test('model adapter validates actual HTTP protocol, JSON failures, timeout and cancellation with a local stub', async t => {
  let mode = 'valid';
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-only-key');
    assert.equal(request.response_format.type, 'json_object');
    assert.equal(request.stream, false);
    if (mode === 'unauthorized') { res.writeHead(401); res.end('private provider detail must not leak'); return; }
    if (mode === 'rate-limit') { res.writeHead(429); res.end('rate'); return; }
    if (mode === 'timeout') { req.socket.on('close', () => {}); return; }
    const content = mode === 'json-error' ? '{broken' : mode === 'empty' ? '' : JSON.stringify({ summary: 'Synthetic result', findings: [] });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop', message: { content } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const config = { apiKey: 'test-only-key', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'local-protocol-stub', timeoutMs: 100 };
  const complete = createModelClient(config);
  const messages = [{ role: 'user' as const, content: 'Return json with a synthetic summary.' }];
  assert.deepEqual(await createModelClient({ ...config, timeoutMs: 2000 })(messages), { summary: 'Synthetic result', findings: [] });
  for (const [nextMode, code] of [['unauthorized', 'AI_AUTH_FAILED'], ['rate-limit', 'AI_RATE_LIMIT'], ['json-error', 'AI_INVALID_JSON'], ['empty', 'AI_EMPTY_RESPONSE'], ['truncated', 'AI_TRUNCATED'], ['timeout', 'AI_TIMEOUT']]) {
    mode = nextMode;
    await assert.rejects(complete(messages), (error: AppError) => error.code === code && !error.message.includes('private provider detail'));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(complete(messages, controller.signal), (error: AppError) => error.code === 'REQUEST_CANCELLED');
});
