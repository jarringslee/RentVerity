import assert from 'node:assert/strict';
import { replyToAssistant, searchAssistantHouses } from '../assistant/service';
import { houseRepository } from '../houses/repository';
import { completeConfiguredJson, readModelConfig } from '../services/modelClient';
import { pool } from '../config/db';
import { AppError } from '../utils/AppError';

async function main() {
  const config = readModelConfig();
  let calls = 0;
  const complete: typeof completeConfiguredJson = (...args) => { calls++; return completeConfiguredJson(...args); };
  const search = await replyToAssistant({ message: '高新区一居室，月租预算3000元以内' }, complete);
  assert.equal(search.intent, 'house_search');
  assert.equal(search.filters?.maxPrice, 3000);
  assert.ok(search.filters?.location.includes('高新区'));
  assert.ok(search.filters?.houseTypes.includes('一居室'));
  const houses = await searchAssistantHouses({ filters: search.filters }, houseRepository);
  assert.ok(houses.list.every(row => row.price <= 3000 && row.title.includes('一居室')));
  const followUp = await replyToAssistant({ message: '预算改成2500元以内，其他条件不变', filters: search.filters, history: [{ role: 'user', content: '高新区一居室，月租预算3000元以内' }, { role: 'assistant', content: search.reply }] }, complete);
  assert.equal(followUp.filters?.maxPrice, 2500);
  assert.equal(followUp.filters?.location, search.filters?.location);
  assert.deepEqual(followUp.filters?.houseTypes, search.filters?.houseTypes);
  const qa = await replyToAssistant({ message: '看房前应检查哪些事项？' }, complete);
  assert.equal(qa.intent, 'rental_qa');
  const outside = await replyToAssistant({ message: '请写一个 React 计数器组件' }, complete);
  assert.equal(outside.intent, 'out_of_scope');
  const vague = await replyToAssistant({ message: '帮我找房，预算和区域还没决定，房型也不限' }, complete);
  assert.equal(vague.needsClarification, true);
  const contract = await replyToAssistant({ message: '分析我的合同风险' }, complete);
  assert.equal(contract.intent, 'contract_review');
  console.log(JSON.stringify({ model: config.model, realModelCalls: calls, passed: ['条件提取', '多轮修改', '通用租房问答', '越界引导', '模糊条件追问', '合同入口隔离'], actualDatabaseMatches: houses.total, shownRealHouseIds: houses.list.map(row => row.id), note: '固定场景烟测，不代表通用意图识别准确率；仅只读查询已有房源。' }, null, 2));
}

main().catch(error => { console.error(error instanceof AppError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : '助手烟测失败'); process.exitCode = 1; }).finally(() => pool.end());
