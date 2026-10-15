import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseName } from '../database/bootstrap';
import { positiveId, registerSchema, publishSchema, chatFrameSchema, passwordSchema } from '../utils/validation';

test('ids and registration reject non-scalars and bcrypt truncation', () => {
  for (const value of [null, {}, [], [1], 0, -1, 1.5, '1.5', '1e2', 'Infinity', Number.MAX_SAFE_INTEGER + 1]) assert.equal(positiveId(value), null);
  assert.equal(positiveId('12'), 12);
  for (const payload of [{ username: {}, phone: '19900000001', password: 'abcdef' }, { username: 'demo', phone: 'bad', password: 'abcdef' }, { username: 'demo', phone: '19900000001', password: '123' }]) assert.equal(registerSchema.safeParse(payload).success, false);
  assert.equal(passwordSchema.safeParse('字'.repeat(25)).success, false);
  assert.equal(passwordSchema.safeParse('字'.repeat(24)).success, true);
});
test('publishing rejects invalid amounts, coordinates, ownership spoofing and fake risk ratings', () => {
  const good = { title: '演示一居室', price: 2800, location: '演示位置' };
  assert.equal(publishSchema.safeParse(good).success, true);
  for (const patch of [{ price: 0 }, { price: -1 }, { price: 2800.5 }, { area: 40.5 }, { price: Infinity }, { price: '2800' }, { lng: 108 }, { lng: Infinity, lat: 34 }, { owner_user_id: 2 }, { riskLevel: 'low' }, { title: '  ' }, { image: 'javascript:alert(1)' }, { image: 'https://example.com/' + 'x'.repeat(255) }, { tags: 'not-an-array' }, { tags: Array(12).fill('x'.repeat(24)) }]) assert.equal(publishSchema.safeParse({ ...good, ...patch }).success, false);
});
test('WebSocket messages reject null, arrays, objects and oversized content without throwing', () => {
  for (const body of [null, [], { type: 'send', conversationId: -1, content: 'x' }, { type: 'send', conversationId: 1, content: {} }, { type: 'send', conversationId: 1, content: 'x'.repeat(2001) }]) assert.equal(chatFrameSchema.safeParse(body).success, false);
  assert.equal(chatFrameSchema.safeParse({ type: 'send', conversationId: 1, content: 'hello' }).success, true);
});
test('database target must be explicit and safe to quote', () => {
  assert.equal(databaseName('rentverity_demo'), 'rentverity_demo');
  for (const name of ['', undefined, 'mysql; DROP DATABASE', '../rent', 'a`b', 'a'.repeat(65)]) assert.throws(() => databaseName(name));
});
