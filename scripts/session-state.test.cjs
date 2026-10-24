// 对真实状态模块注入 fetch/storage，验证竞态；不模拟为浏览器或真实服务验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

const user = (id = 1) => ({ id, username: `user${id}`, phone: '', preferences: [], sessionId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; };

function harness() {
  const saved = new Map([['rentverity_current_user', '{"token":"legacy-credential"}']]);
  const listeners = new Map();
  let fetcher = async () => json({}, 401);
  const globals = {
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    localStorage: { setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    crypto: { randomUUID }, fetch: (...args) => fetcher(...args), AbortSignal, DOMException, Date, Headers, Response
  };
  let store;
  const modules = new Map();
  function load(relative) {
    const file = path.join(__dirname, '..', relative);
    if (modules.has(file)) return modules.get(file);
    const source = fs.readFileSync(file, 'utf8').replace(/^\s*import\.meta\.hot\?\.dispose.*$/mg, '');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(compiled, { ...globals, exports, require: name => {
      if (name === 'vue') return require('vue');
      if (name.endsWith('/config')) return { API_BASE_URL: 'http://localhost:3001', SESSION_HEADER: 'X-RentVerity-Session' };
      if (name.endsWith('/userStore')) return { default: store };
      if (name.endsWith('/authMutation')) return load('src/services/authMutation.ts');
      if (name.endsWith('/sessionRequest')) return load('src/services/sessionRequest.ts');
      if (name.endsWith('/houseFilters')) return { houseFiltersToQuery: () => ({}) };
      throw new Error(`unexpected import ${name}`);
    } }, { filename: file });
    return exports;
  }
  store = load('src/stores/userStore.ts').default;
  return { store, requests: load('src/services/sessionRequest.ts'), saved, listeners, load, fetch: handler => { fetcher = handler; } };
}

test('legacy credentials are removed; identity restores from server and only change notices persist', async () => {
  const h = harness(), data = user();
  assert.equal(h.saved.has('rentverity_current_user'), false);
  assert.equal(h.store.currentUser.value, null);
  h.fetch(async (url, options) => {
    assert.equal(url, 'http://localhost:3001/users/me');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    return json({ success: true, data });
  });
  await h.store.initializeSession();
  assert.equal(h.store.currentUser.value.id, data.id);
  h.store.setCurrentUser({ ...data, token: 'must-not-enter-state' });
  assert.equal(h.store.currentUser.value.token, undefined);
  assert.deepEqual([...h.saved.keys()], ['rentverity_auth_event']);
  assert.deepEqual(Object.keys(JSON.parse(h.saved.get('rentverity_auth_event'))), ['nonce']);
});

test('simultaneous startup checks share one request', async () => {
  const h = harness(), response = deferred(); let calls = 0;
  h.fetch(() => { calls++; return response.promise; });
  const first = h.store.refreshSession(), second = h.store.refreshSession();
  assert.equal(first, second); assert.equal(calls, 1);
  response.resolve(json({ success: true, data: user() })); await first;
  assert.equal(h.store.initialized.value, true);
});

test('rechecking a guest session does not change the route view version', async () => {
  const h = harness(), version = h.store.getSessionVersion();
  await h.store.initializeSession(); await h.store.refreshSession();
  assert.equal(h.store.getSessionVersion(), version);
  assert.equal(h.store.initialized.value, true);
});

test('a delayed restore 401 and an old request version cannot clear a newer login', async () => {
  const h = harness(), response = deferred(), newer = user(2);
  h.fetch(() => response.promise);
  const oldVersion = h.store.getSessionVersion(), pending = h.store.refreshSession();
  h.store.setCurrentUser(newer);
  response.resolve(json({}, 401)); await pending;
  h.store.expireSession(oldVersion);
  assert.equal(h.store.currentUser.value.id, 2);
  assert.equal(h.store.sessionExpired.value, false);
});

test('cross-tab notices immediately clear private state and recheck the shared Cookie', async () => {
  const h = harness(), response = deferred(); h.store.setCurrentUser(user(1));
  h.fetch(() => response.promise);
  h.listeners.get('storage')({ key: 'rentverity_auth_event' });
  assert.equal(h.store.currentUser.value, null); assert.equal(h.store.initialized.value, false);
  response.resolve(json({ success: true, data: user(2) })); await h.store.initializeSession();
  assert.equal(h.store.currentUser.value.id, 2);
});

test('network failures preserve identity; a current unauthorized response clears it', async () => {
  const h = harness(); h.store.setCurrentUser(user());
  h.fetch(async () => { throw new Error('network unavailable'); });
  await h.store.refreshSession();
  assert.equal(h.store.currentUser.value.id, 1); assert.ok(h.store.sessionError.value);
  h.fetch(async () => json({}, 401)); await h.store.refreshSession();
  assert.equal(h.store.currentUser.value, null); assert.equal(h.store.sessionExpired.value, true);
});

test('logout is deduplicated, binds the expected session and only clears after server success', async () => {
  const h = harness(), data = user(), response = deferred(); let calls = 0;
  h.store.setCurrentUser(data);
  h.fetch((url, options) => {
    calls++; assert.equal(url, 'http://localhost:3001/auth/logout');
    assert.equal(options.credentials, 'include'); assert.equal(options.headers['X-RentVerity-Session'], data.sessionId);
    return response.promise;
  });
  const first = h.store.logout(), second = h.store.logout(); assert.equal(first, second);
  assert.equal(h.store.currentUser.value.id, 1);
  response.resolve(json({ success: true })); await first;
  assert.equal(calls, 1); assert.equal(h.store.currentUser.value, null);
  h.store.setCurrentUser(user());
  h.fetch(async () => { throw new Error('network unavailable'); });
  await assert.rejects(h.store.logout()); assert.equal(h.store.currentUser.value.id, 1);
});

test('requests carry Cookie credentials and session metadata; late 401 cannot clear the new user', async () => {
  const h = harness(), data = user(), response = deferred(); h.store.setCurrentUser(data);
  h.fetch((url, options) => {
    assert.equal(options.credentials, 'include'); assert.equal(options.headers.get('X-RentVerity-Session'), data.sessionId);
    assert.equal(options.headers.has('Authorization'), false); return response.promise;
  });
  const request = h.requests.sessionFetch('/favorites'); h.store.setCurrentUser(user(2));
  response.resolve(json({}, 401)); await assert.rejects(request, error => error.name === 'AbortError');
  assert.equal(h.store.currentUser.value.id, 2);
});

test('auth mutations serialize without Web Locks and a failed mutation does not block the queue', async () => {
  const h = harness(), { withAuthMutation } = h.load('src/services/authMutation.ts');
  const gate = deferred(), order = [];
  const first = withAuthMutation(async () => { order.push('first-start'); await gate.promise; order.push('first-end'); return 1; });
  const second = withAuthMutation(async () => { order.push('second'); return 2; });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['first-start']);
  gate.resolve(); assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  await assert.rejects(withAuthMutation(async () => { throw new Error('test rejection'); }));
  assert.equal(await withAuthMutation(async () => 3), 3);
});

test('an old focus check cannot clear identity while a login mutation is in progress', async () => {
  const h = harness(), oldResponse = deferred(), started = deferred(), finish = deferred();
  h.store.setCurrentUser(user(1)); h.fetch(() => oldResponse.promise);
  const check = h.store.refreshSession();
  const mutation = h.load('src/services/authMutation.ts').withAuthMutation(async () => { started.resolve(); await finish.promise; });
  await started.promise;
  oldResponse.resolve(json({}, 401)); await check;
  const survivingUser = h.store.currentUser.value;
  finish.resolve(); await mutation;
  assert.equal(survivingUser?.id, 1);
});

test('a queued logout sees the identity established by login before the auth lock is released', async () => {
  const h = harness(), data = user(2); h.store.setCurrentUser(user(1));
  h.fetch(async url => url.endsWith('/auth/login') ? json({ success: true, data }) : json({ success: true }));
  const login = h.load('src/services/api.ts').login('user2', 'test-password');
  const observed = h.load('src/services/authMutation.ts').withAuthMutation(async () => h.store.currentUser.value?.id);
  await login;
  assert.equal(await observed, 2);
});

test('focus checks are skipped while auth mutates and normal late 401 is cancelled', async () => {
  const h = harness(), response = deferred(), started = deferred(), finish = deferred(); let calls = 0;
  h.store.setCurrentUser(user(1)); h.fetch(() => { calls++; return response.promise; });
  const request = h.requests.sessionFetch('/favorites');
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  const mutation = h.load('src/services/authMutation.ts').withAuthMutation(async () => { started.resolve(); await finish.promise; });
  await started.promise;
  await h.store.refreshSession(); assert.equal(calls, 1);
  response.resolve(json({}, 401)); await rejected;
  finish.resolve(); await mutation;
  assert.equal(h.store.currentUser.value.id, 1);
});

test('wrong-password 401 does not log out an existing identity and auth requests have a deadline', async () => {
  const h = harness(); h.store.setCurrentUser(user(1));
  h.fetch(async (_url, options) => { assert.ok(options.signal); return json({ success: false, message: 'wrong password' }, 401); });
  const result = await h.load('src/services/api.ts').login('user2', 'wrong-password');
  assert.equal(result.success, false); assert.equal(h.store.currentUser.value.id, 1);
});

test('a notice during failed login is reconciled against the real Cookie after the lock releases', async () => {
  const h = harness(), started = deferred(), response = deferred(), newer = user(2); h.store.setCurrentUser(user(1));
  h.fetch(async url => {
    if (url.endsWith('/auth/login')) { started.resolve(); return response.promise; }
    return json({ success: true, data: newer });
  });
  const login = h.load('src/services/api.ts').login('user3', 'wrong-password'); await started.promise;
  h.listeners.get('storage')({ key: 'rentverity_auth_event' });
  assert.equal(h.store.currentUser.value, null);
  response.resolve(json({ success: false }, 401)); await login;
  assert.equal(h.store.currentUser.value.id, 2); assert.equal(h.store.initialized.value, true);
});

test('a failed auth response body triggers reconciliation without persisting credentials', async () => {
  const h = harness(), newer = user(2); h.store.setCurrentUser(user(1));
  h.fetch(async url => url.endsWith('/auth/login') ? { status: 200, json: async () => { throw new Error('lost auth body'); } } : json({ success: true, data: newer }));
  await assert.rejects(h.load('src/services/api.ts').login('user2', 'test-password'));
  assert.equal(h.store.currentUser.value.id, 2);
});
