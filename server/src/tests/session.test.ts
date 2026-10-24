import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { createApp } from '../app';
import { pool } from '../config/db';
import { createSession, verifySession, readSessionCookie, SESSION_COOKIE, SESSION_SECONDS } from '../auth/session';
import { hasTrustedSource } from '../middleware/csrf';
import { attachChatWss } from '../ws/chatGateway';

const secret = 'rentverity-cookie-test-only-secret';
process.env.JWT_SECRET = secret;
process.env.CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';
const origin = 'http://localhost:5173';
const cookieFor = (token: string) => `${SESSION_COOKIE}=${token}`;

test('session JWT has a unique ID and a bounded expiry; ambiguous cookies fail closed', () => {
  const first = createSession(13), second = createSession(13);
  assert.notEqual(first.sessionId, second.sessionId);
  const claims = verifySession({ cookie: cookieFor(first.token) });
  assert.equal(claims.userId, 13); assert.equal(claims.jti, first.sessionId);
  assert.ok(claims.exp * 1000 > Date.now());
  assert.ok(claims.exp * 1000 <= Date.now() + SESSION_SECONDS * 1000);
  assert.equal(readSessionCookie({ cookie: `${cookieFor(first.token)}; ${cookieFor(second.token)}` }), null);
  assert.equal(readSessionCookie({ cookie: `${SESSION_COOKIE}=%broken` }), null);
  assert.throws(() => verifySession({ authorization: `Bearer ${first.token}` }));
  for (const token of [
    jwt.sign({ userId: 13, jti: randomUUID(), exp: 1 }, secret),
    jwt.sign({ userId: -1, jti: randomUUID(), exp: 9999999999 }, secret),
    jwt.sign({ userId: 13, exp: 9999999999 }, secret),
    jwt.sign({ userId: 13, jti: randomUUID(), exp: 9999999999 }, secret, { algorithm: 'HS384' })
  ]) assert.throws(() => verifySession({ cookie: cookieFor(token) }));
});

test('source checks compare exact origins, prefer Origin and fail closed when absent', () => {
  assert.equal(hasTrustedSource({ origin }), true);
  assert.equal(hasTrustedSource({ referer: origin + '/profile?tab=basic' }), true);
  for (const headers of [{}, { origin: 'null' }, { origin: origin + '.attacker.example' }, { origin: origin + '/' }, { origin: 'http://localhost:9999' }, { origin: 'https://attacker.example', referer: origin + '/' }]) {
    assert.equal(hasTrustedSource(headers), false);
  }
  assert.equal(hasTrustedSource({ referer: origin + '/' }, false), false);
});

test('HTTP and WebSocket cookie protocol works without a real database or model', async t => {
  const password = 'test-only-password';
  const row = { id: 13, username: 'cookie_demo', phone: '19900000099', password_hash: bcrypt.hashSync(password, 4), gender: 'male', city: null, avatar_url: null, preferences_json: '[]' };
  let queries = 0;
  t.mock.method(pool, 'query', (async (sql: string, values: any[]) => {
    queries++;
    if (sql.startsWith('SELECT id FROM users')) return [[], []];
    if (sql.startsWith('INSERT INTO users')) return [{ insertId: 13 }, []];
    if (sql.includes('FROM users WHERE username')) return [values[0] === row.username ? [row] : [], []];
    if (sql.includes('FROM users WHERE id')) return [[row], []];
    throw new Error('unexpected database access in cookie protocol test');
  }) as any);
  const server = http.createServer(createApp()), wss = attachChatWss(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const login = () => fetch(base + '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: row.username, password }) });
  let cookie = '', sessionId = '';

  await t.test('untrusted writes are blocked before body parsing and database access', async () => {
    const count = queries;
    for (const headers of [{}, { Origin: 'null' }, { Origin: 'http://localhost:5173.evil.example' }]) {
      const response = await fetch(base + '/auth/login', { method: 'POST', headers, body: '{invalid json' });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as any).code, 'CSRF_ORIGIN_INVALID');
    }
    assert.equal((await fetch(base + '/contracts/parse', { method: 'POST', body: 'not multipart' })).status, 403);
    assert.equal((await fetch(base + '/users/me/avatar', { method: 'POST', body: 'not multipart' })).status, 403);
    assert.equal(queries, count);
  });

  await t.test('CORS allows credentials for exact local origins only', async () => {
    const response = await fetch(base + '/health', { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    const denied = await fetch(base + '/health', { headers: { Origin: 'https://attacker.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(base + '/users/me', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type,x-rentverity-session' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-rentverity-session/i);
  });

  await t.test('login sets a host-only HttpOnly SameSite cookie without returning the JWT', async () => {
    const response = await login();
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie()[0]!;
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i); assert.match(setCookie, /Max-Age=604800/i);
    assert.ok(!/Domain=/i.test(setCookie));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as any;
    assert.ok(!('token' in body.data)); assert.ok(!('password_hash' in body.data));
    cookie = setCookie.split(';')[0]!; sessionId = body.data.sessionId;
    assert.equal(verifySession({ cookie }).jti, sessionId);
  });

  await t.test('registration also establishes a cookie session without exposing a token', async () => {
    const response = await fetch(base + '/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'cookie_new', phone: '19900000098', password }) });
    const body = await response.json() as any;
    assert.equal(response.status, 200); assert.ok(body.data.sessionId);
    assert.ok(!('token' in body.data)); assert.match(response.headers.getSetCookie()[0]!, /HttpOnly/);
  });

  await t.test('me restores public profile and session metadata; Bearer and stale sessions are refused', async () => {
    const response = await fetch(base + '/users/me', { headers: { Cookie: cookie } });
    const body = await response.json() as any;
    assert.equal(response.status, 200); assert.equal(body.data.id, 13); assert.equal(body.data.sessionId, sessionId);
    assert.ok(!('token' in body.data));
    const bearer = await fetch(base + '/users/me', { headers: { Authorization: `Bearer ${cookie.split('=')[1]}` } });
    assert.equal(bearer.status, 401);
    const stale = await fetch(base + '/users/me', { headers: { Cookie: cookie, 'X-RentVerity-Session': randomUUID() } });
    assert.equal(stale.status, 409); assert.equal(stale.headers.get('set-cookie'), null);
    const fallback = await fetch(base + '/auth/logout', { method: 'POST', headers: { Referer: origin + '/profile' } });
    assert.equal(fallback.status, 200);
  });

  await t.test('session metadata alone cannot authenticate and unauthorized responses never clear Cookie', async () => {
    const metadataOnly = await fetch(base + '/users/me', { headers: { 'X-RentVerity-Session': sessionId } });
    assert.equal(metadataOnly.status, 401); assert.equal(metadataOnly.headers.get('set-cookie'), null); assert.equal(metadataOnly.headers.get('cache-control'), 'no-store');
    const expired = jwt.sign({ userId: 13, exp: 1 }, secret, { jwtid: randomUUID() });
    const rejected = await fetch(base + '/users/me', { headers: { Cookie: cookieFor(expired) } });
    assert.equal(rejected.status, 401); assert.equal(rejected.headers.get('set-cookie'), null);
    const before = queries;
    const mismatch = await fetch(base + '/users/me', { headers: { Cookie: cookieFor(createSession(13).token), 'X-RentVerity-Session': sessionId } });
    assert.equal(mismatch.status, 409); assert.equal(queries, before);
  });

  const deniedSocket = (headers: Record<string, string>, id = sessionId, suffix = '') => new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws/chat' + suffix, ['rentverity-chat', `session.${id}`], { headers });
    socket.on('error', () => {});
    socket.once('open', () => { socket.terminate(); reject(new Error('untrusted upgrade succeeded')); });
    socket.once('unexpected-response', (_req, response) => { const status = response.statusCode!; response.resume(); socket.terminate(); resolve(status); });
  });
  const connect = async (sessionCookie = cookie, id = sessionId) => {
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws/chat', ['rentverity-chat', `session.${id}`], { headers: { Cookie: sessionCookie, Origin: origin } });
    socket.on('error', () => {});
    await once(socket, 'open'); return socket;
  };

  await t.test('WebSocket rejects untrusted origin, missing Cookie, stale session and old token URLs', async () => {
    assert.equal(await deniedSocket({ Cookie: cookie }), 403);
    assert.equal(await deniedSocket({ Cookie: cookie, Origin: 'https://attacker.example' }), 403);
    assert.equal(await deniedSocket({ Origin: origin }), 401);
    assert.equal(await deniedSocket({ Cookie: cookie, Origin: origin }, randomUUID()), 409);
    assert.equal(await deniedSocket({ Cookie: cookie, Origin: origin }, sessionId, '?token=old'), 404);
  });

  await t.test('logout clears Cookie and closes only matching session sockets; stale logout cannot clear a new session', async () => {
    const socket = await connect();
    const other = createSession(13), otherSocket = await connect(cookieFor(other.token), other.sessionId);
    const pong = once(socket, 'message'); socket.send(JSON.stringify({ type: 'ping' }));
    assert.equal(JSON.parse(String((await pong)[0])).type, 'pong');
    const stale = await fetch(base + '/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-RentVerity-Session': randomUUID() } });
    assert.equal(stale.status, 409); assert.equal(stale.headers.get('set-cookie'), null);
    const closed = once(socket, 'close');
    const response = await fetch(base + '/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-RentVerity-Session': sessionId } });
    assert.equal(response.status, 200); assert.match(response.headers.getSetCookie()[0]!, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await closed)[0], 4001); assert.equal(otherSocket.readyState, WebSocket.OPEN);
    otherSocket.close(); await once(otherSocket, 'close');
  });

  await t.test('WebSocket expires an already established connection', async () => {
    const id = randomUUID();
    const token = jwt.sign({ userId: 13, exp: Math.floor(Date.now() / 1000) + 2 }, secret, { jwtid: id });
    const socket = await connect(cookieFor(token), id);
    assert.equal((await once(socket, 'close'))[0], 4001);
  });
});
