import assert from 'node:assert/strict';
import { runAssistant, parseAssistantRequest, type AssistantEvent } from '../assistant/service';
import { houseRepository } from '../houses/repository';
import { configuredAssistantModel, type AssistantModel } from '../services/chatModel';
import { readModelConfig } from '../services/modelClient';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
async function main() {
  let modelCalls = 0, searches = 0;
  const model: AssistantModel = { choose: (...args) => { modelCalls++; console.log(`真实模型调用 ${modelCalls}：工具选择`); return configuredAssistantModel.choose(...args); }, stream: (...args) => { modelCalls++; console.log(`真实模型调用 ${modelCalls}：流式正文`); return configuredAssistantModel.stream(...args); } };
  const run = async (input: unknown) => {
    const events: AssistantEvent[] = [];
    await runAssistant(parseAssistantRequest(input), model, { search: query => { searches++; return houseRepository.search(query); } }, async event => { events.push(event); }, new AbortController().signal);
    assert.equal(events.at(-1)?.event, 'done'); return events;
  };
  const missing = await run({ message: '高新区一居室，3000以内' });
  assert.ok(missing.some(event => event.event === 'context' && event.data.needsClarification)); assert.equal(searches, 0);
  const initial = '西安高新区一居室，月租3000以内';
  const events = await run({ message: initial });
  const cards = events.find(event => event.event === 'houses'); assert.ok(cards?.event === 'houses');
  assert.equal(cards.data.filters.city, '西安市'); assert.equal(cards.data.filters.maxPrice, 3000); assert.ok(cards.data.filters.houseTypes.includes('一居室'));
  assert.ok(cards.data.list.every(row => row.city === '西安市' && row.houseType === '一居室' && row.price <= 3000));
  const follow = await run({ message: '预算改成2500以内，其他条件不变', context: cards.data.filters, history: [{ role: 'user', content: initial }] });
  assert.ok(follow.some(event => event.event === 'houses' && event.data.filters.maxPrice === 2500 && event.data.filters.city === '西安市'));
  const qa = await run({ message: '看房前应该检查哪些事项？请用简短 Markdown 列表回答。' });
  assert.ok(qa.filter(event => event.event === 'delta').length > 1);
  const empty = await run({ message: '西安，月租不超过0元' });
  assert.ok(empty.some(event => event.event === 'houses' && event.data.total === 0 && event.data.filters.maxPrice === 0));
  const outside = await run({ message: '请写一个 React 计数器' }); assert.ok(outside.some(event => event.event === 'context' && event.data.intent === 'out_of_scope'));
  const contract = await run({ message: '分析我的合同风险' }); assert.ok(contract.some(event => event.event === 'context' && event.data.intent === 'contract_review'));
  console.log(JSON.stringify({ model: readModelConfig().model, realModelCalls: modelCalls, actualDatabaseQueries: searches, actualMatches: cards.data.total, passed: ['缺城市不查库', '自动查真实房源', '多轮预算修改', '真流式租房问答', '严格无结果', '题外与合同隔离'], note: '固定场景，只读业务库；不是普遍准确率或法律结论。' }, null, 2));
}
main().catch(error => { console.error(error instanceof AppError ? `${error.code}: ${error.message}` : '助手真实烟测断言失败；未输出配置或上游原文。'); process.exitCode = 1; }).finally(() => pool.end());
