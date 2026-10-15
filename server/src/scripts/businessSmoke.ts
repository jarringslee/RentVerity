import '../config/env';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import mysql from 'mysql2/promise';
import { WebSocket } from 'ws';
import { initializeEmptyDatabase, seedDemoDatabase } from '../database/bootstrap';

type Actor = { id: number; token: string; username: string };
type Sandbox = { base: string; database: string; password: string; query: (sql: string, values?: unknown[]) => Promise<unknown> };

/** 只创建/清理本脚本新建的随机演示测试库，不复用 DB_NAME，不触碰现有账号。 */
export async function withBusinessSandbox(run: (sandbox: Sandbox) => Promise<void>, options: { database?: string; confirmEmpty?: boolean } = {}) {
  const database = options.database ?? `rentverity_demo_test_${randomBytes(6).toString('hex')}`;
  if (!/^rentverity_demo_test_[a-z0-9_]{1,32}$/.test(database) || (options.database && !options.confirmEmpty)) throw new Error('仅允许独立的 rentverity_demo_test_* 测试库；已有空测试库须 --confirm-empty-test-db。');
  const password = `test-only-${randomBytes(12).toString('hex')}`;
  const control = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  let created = false;
  const ownedTables: string[] = [];
  let server: http.Server | undefined;
  let wss: ReturnType<typeof import('../ws/chatGateway').attachChatWss> | undefined;
  let databasePool: typeof import('../config/db').pool | undefined;
  try {
    if (!options.database) { await control.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true; }
    await initializeEmptyDatabase(control, database, table => ownedTables.push(table));
    await assert.rejects(initializeEmptyDatabase(control, database), /非空/);
    await assert.rejects(seedDemoDatabase(control, database, 'short'), /DEMO_PASSWORD/);
    await seedDemoDatabase(control, database, password);
    await assert.rejects(seedDemoDatabase(control, database, password), /已有用户/);
    process.env.DB_NAME = database;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.AI_API_KEY = ''; // 本轮不需要也不允许真实模型调用。
    const { createApp } = await import('../app.js');
    const { attachChatWss } = await import('../ws/chatGateway.js');
    databasePool = (await import('../config/db.js')).pool;
    server = http.createServer(createApp()); wss = attachChatWss(server);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    await run({ base: `http://127.0.0.1:${address.port}`, database, password, query: async (sql, values = []) => (await control.query(sql, values))[0] });
  } finally {
    if (wss) { for (const client of wss.clients) client.terminate(); await new Promise<void>(resolve => wss!.close(() => resolve())); }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    await databasePool?.end();
    // 目标必须是此次 create 成功的精确随机库名；绝不根据 DB_NAME 拼接删除。
    if (created && /^rentverity_demo_test_[a-f0-9]{12}$/.test(database)) await control.query(`DROP DATABASE \`${database}\``);
    else if (options.database && options.confirmEmpty && /^rentverity_demo_test_[a-z0-9_]{1,32}$/.test(database)) {
      // 管理员手动创建的测试库保留，只清理由本轮成功创建并记录的表。
      for (const table of [...ownedTables].reverse()) await control.query(`DROP TABLE \`${database}\`.\`${table}\``);
    }
    await control.end();
    if (created) console.log('独立临时测试库已清理，现有业务库未改动。');
    else if (ownedTables.length) console.log('手工提供的测试库已恢复为空，现有业务库未改动。');
  }
}

async function businessChecks({ base, password, query }: Sandbox) {
  const request = async (path: string, method = 'GET', body?: unknown, actor?: Actor) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  const register = async (username: string, phone: string): Promise<Actor> => {
    const result = await request('/auth/register', 'POST', { username, phone, password });
    assert.equal(result.status, 200); assert.ok(!('password_hash' in result.body.data)); return result.body.data;
  };
  const owner = await register('smoke_owner', '19900000011'), tenant = await register('smoke_tenant', '19900000012'), outsider = await register('smoke_outside', '19900000013');
  assert.equal((await request('/auth/register', 'POST', { username: 'bad', phone: 'x', password })).status, 400);
  assert.equal((await request('/auth/register', 'POST', { username: owner.username, phone: '19900000014', password })).status, 409);
  assert.equal((await request('/auth/login', 'POST', { username: owner.username, password: 'wrong-password' })).status, 401);
  assert.equal((await request('/auth/login', 'POST', { username: owner.username, password })).status, 200);
  assert.equal((await request('/auth/login', 'POST', { username: 'demo_landlord', password })).status, 200);
  const [stored] = await query('SELECT password_hash FROM users WHERE id = ?', [owner.id]) as { password_hash: string }[];
  assert.notEqual(stored.password_hash, password);
  assert.equal((await request('/users/me', 'GET', undefined, owner)).body.data.id, owner.id);
  assert.equal((await request('/users/me', 'PATCH', undefined, owner)).status, 400);
  assert.equal((await request('/users/me/password', 'PATCH', undefined, owner)).status, 400);
  const house = { title: '[验收] 高新区一居室', price: 2900, location: '演示位置', lng: 108.94, lat: 34.25, description: '合成业务测试房源', tags: ['验收'], area: 45 };
  assert.equal((await request('/houses', 'POST', house)).status, 401);
  for (const patch of [{ price: -1 }, { price: 2900.5 }, { area: 45.5 }, { price: '2900' }, { lng: 108.94, lat: null }, { owner_user_id: outsider.id }, { riskLevel: 'low' }]) assert.equal((await request('/houses', 'POST', { ...house, ...patch }, owner)).status, 400);
  const published = await request('/houses', 'POST', house, owner); assert.equal(published.status, 200);
  const houseId = published.body.data.id;
  const detail = await request(`/houses/${houseId}`); assert.equal(detail.body.data.owner_user_id, owner.id); assert.equal(Number(detail.body.data.price), 2900);
  assert.equal((await request('/houses/-1')).status, 400); assert.equal((await request('/houses/99999999')).status, 404);
  const filtered = await request('/houses?location=' + encodeURIComponent('高新区') + '&minPrice=2900&maxPrice=3000&bounds=108.9,34.2,109,34.3'); assert.equal(filtered.body.data.total, 1);
  assert.equal((await request('/favorites/99999999', 'POST', undefined, tenant)).status, 404);
  assert.equal((await request(`/favorites/${houseId}`, 'POST', undefined, tenant)).status, 200);
  assert.equal((await request(`/favorites/${houseId}`, 'POST', undefined, tenant)).status, 200);
  assert.equal((await request('/favorites', 'GET', undefined, tenant)).body.data.length, 1);
  assert.equal((await request('/favorites', 'GET', undefined, owner)).body.data.length, 0);
  assert.equal((await request(`/favorites/${houseId}`, 'DELETE', undefined, tenant)).status, 200);
  assert.equal((await request(`/favorites/check/${houseId}`, 'GET', undefined, tenant)).body.data, false);
  assert.equal((await request('/chat/conversations', 'POST', { peerUserId: outsider.id, houseId }, tenant)).status, 403);
  assert.equal((await request('/chat/conversations', 'POST', { peerUserId: owner.id, houseId }, owner)).status, 400);
  const pair = await Promise.all([request('/chat/conversations', 'POST', { peerUserId: owner.id, houseId }, tenant), request('/chat/conversations', 'POST', { peerUserId: owner.id, houseId }, tenant)]);
  assert.equal(pair[0].status, 200); assert.equal(pair[1].status, 200); assert.equal(pair[0].body.data.id, pair[1].body.data.id);
  const conversationId = Number(pair[0].body.data.id);
  assert.equal((await request(`/chat/conversations/${conversationId}/messages`, 'GET', undefined, outsider)).status, 404);
  assert.equal((await request(`/chat/conversations/${conversationId}/read`, 'POST', undefined, outsider)).status, 404);
  assert.equal((await request(`/chat/conversations/${conversationId}/messages?limit=-1`, 'GET', undefined, tenant)).status, 400);
  assert.equal((await request(`/chat/conversations/${conversationId}/messages?beforeId=1.5`, 'GET', undefined, tenant)).status, 400);
  const connect = (actor: Actor) => new Promise<WebSocket>((resolve, reject) => { const socket = new WebSocket(base.replace('http', 'ws') + `/ws/chat?token=${encodeURIComponent(actor.token)}`); socket.once('open', () => resolve(socket)); socket.once('error', reject); });
  const receive = (socket: WebSocket) => new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { socket.off('message', message); reject(new Error('WebSocket frame timeout')); }, 5000); const message = (data: unknown) => { clearTimeout(timer); resolve(JSON.parse(String(data))); }; socket.once('message', message); });
  const [ownerSocket, tenantSocket, outsiderSocket] = await Promise.all([connect(owner), connect(tenant), connect(outsider)]);
  try {
    let incoming = receive(tenantSocket); tenantSocket.send('null'); assert.equal((await incoming).type, 'error');
    incoming = receive(tenantSocket); tenantSocket.send(JSON.stringify({ type: 'ping' })); assert.equal((await incoming).type, 'pong');
    incoming = receive(outsiderSocket); outsiderSocket.send(JSON.stringify({ type: 'send', conversationId, content: 'forbidden' })); assert.equal((await incoming).type, 'error');
    const receivedOwner = receive(ownerSocket), receivedTenant = receive(tenantSocket);
    tenantSocket.send(JSON.stringify({ type: 'send', conversationId, content: '合成验收消息：你好，请问还在出租吗？' }));
    const [a, b] = await Promise.all([receivedOwner, receivedTenant]); assert.equal(a.type, 'message'); assert.equal(a.message.id, b.message.id);
    assert.equal((await request('/chat/unread-total', 'GET', undefined, owner)).body.data.total, 1);
    assert.equal((await request('/chat/unread-total', 'GET', undefined, outsider)).body.data.total, 0);
    const history = await request(`/chat/conversations/${conversationId}/messages`, 'GET', undefined, owner); assert.equal(history.body.data.length, 1); assert.equal(history.body.data[0].content, a.message.content);
    assert.equal((await request(`/chat/conversations/${conversationId}/read`, 'POST', undefined, owner)).status, 200);
    assert.equal((await request('/chat/unread-total', 'GET', undefined, owner)).body.data.total, 0);
    const replyOwner = receive(ownerSocket), replyTenant = receive(tenantSocket);
    ownerSocket.send(JSON.stringify({ type: 'send', conversationId, content: '还在，欢迎预约看房。' })); await Promise.all([replyOwner, replyTenant]);
    const older = await request(`/chat/conversations/${conversationId}/messages?beforeId=${Number(a.message.id) + 1}&limit=1`, 'GET', undefined, tenant); assert.equal(older.body.data[0].id, a.message.id);
  } finally { ownerSocket.terminate(); tenantSocket.terminate(); outsiderSocket.terminate(); }
  assert.equal((await request('/users/me', 'PATCH', { phone: '19900000015' }, owner)).status, 200);
  assert.equal((await request('/users/me/password', 'PATCH', { oldPassword: 'wrong', newPassword: password + 'x' }, owner)).status, 400);
  console.log(JSON.stringify({ passed: ['fresh schema and guarded seed', 'registration/hash/login', 'publishing/ownership/validation', 'detail/filter', 'idempotent favorites/isolation', 'concurrent conversation uniqueness', 'HTTP/WS outsider denial', 'null frame/ping', 'bidirectional WS persistence', 'history pagination/unread/read', 'profile/password boundary'], realModelCalls: 0, existingDatabaseWrites: 0 }));
}
if (require.main === module) withBusinessSandbox(businessChecks, { database: process.argv.find(arg => arg.startsWith('--database='))?.slice('--database='.length), confirmEmpty: process.argv.includes('--confirm-empty-test-db') }).catch(error => { console.error(error instanceof Error && !('sql' in error) ? error.message : `临时库业务验收失败，错误码 ${(error as { code?: string })?.code || 'UNKNOWN'}（未输出连接信息或 SQL）。`); process.exitCode = 1; });
