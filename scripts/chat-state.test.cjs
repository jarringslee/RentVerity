// 只测试无浏览器依赖的前端纯函数，不启动 MySQL/模型服务。
const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../src/utils/chatMessages.ts');
const row = (id, content = String(id)) => ({ id, conversation_id: 1, sender_id: 1, content, createdAt: '2026-10-16T00:00:00Z' });

test('HTTP and WS messages are deduplicated and ordered without mutating the old array', async () => {
  const { mergeChatMessages } = await helpers;
  const current = [row(3), row(1)];
  const merged = mergeChatMessages(current, [row(2), row(3, 'same persisted message'), row(0), row(NaN)]);
  assert.deepEqual(merged.map(m => m.id), [1, 2, 3]);
  assert.deepEqual(current.map(m => m.id), [3, 1]);
  assert.equal(merged[2].content, 'same persisted message');
});

test('bounded rendering keeps the latest 500 persisted messages', async () => {
  const { mergeChatMessages, CHAT_RENDER_LIMIT } = await helpers;
  const merged = mergeChatMessages([], Array.from({ length: 700 }, (_, i) => row(700-i)));
  assert.equal(merged.length, CHAT_RENDER_LIMIT);
  assert.equal(merged[0].id, 201); assert.equal(merged[499].id, 700);
});

test('HTTP snake-case rows are mapped consistently before merge', async () => {
  const { parseChatMessage } = await helpers;
  assert.deepEqual(parseChatMessage({ id: '7', conversation_id: '1', sender_id: '2', content: '<script>plain text</script>', created_at: 'date' }), {
    id: 7, conversation_id: 1, sender_id: 2, content: '<script>plain text</script>', createdAt: 'date'
  });
});
