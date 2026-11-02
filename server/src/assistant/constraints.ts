import { citiesMentioned, normalizeHouseCity } from '../houses/catalog';
import { HOUSE_TYPES, type HouseFilters } from '../houses/filters';

interface EvidenceRequest { message: string; history: { role: 'user' | 'assistant'; content: string }[]; context: HouseFilters }
export interface SearchArguments { city: string | null; location: string | null; minPrice: number | null; maxPrice: number | null; houseTypes: string[]; unavailablePreferences: string[] }
export function evidenceCity(request: EvidenceRequest): string | null {
  for (const text of [request.message, ...request.history.filter(item => item.role === 'user').map(item => item.content).reverse()]) {
    const mentioned = citiesMentioned(text);
    const cities = mentioned.filter(city => {
      const name = city.endsWith('市') ? city.slice(0, -1) : city;
      return !new RegExp(`(?:不在|不去|不选|不要|不考虑|不沿用|不继承|排除|避开|不是|不想去)[^，。；！？\\n]{0,4}${name}`, 'u').test(text);
    });
    if (mentioned.length) return cities.length === 1 ? cities[0] : null;
    if (/城市不限|不限城市|城市还没|城市未定|换个城市|没确定城市|清除城市|取消城市|不要这个城市/u.test(text)) return null;
  }
  return null;
}
// 只约束高置信的显式检索动作；“怎么找房/租金是否合法”等知识提问仍由模型分流。
export function explicitlyRequestsSearch(text: string): boolean {
  return /(?:帮我|给我|我想|我要|请你)(?:查找|搜索|找|搜|查|推荐)[^。！？\n]{0,30}(?:房源|房子|住房|房|一居室|两居室|三居室|合租)|(?:查询|检索|查一下)[^。！？\n]{0,15}房源|推荐(?:几|一|两|三|[1-6])套|有哪些(?:可租|出租|符合条件的)?房源/u.test(text);
}

const numberPattern = '(?:[0-9]+(?:\\.[0-9]+)?[kK千万]?|[零〇一二两三四五六七八九十百千万]+)';
function money(raw: string): number | null {
  if (/^[0-9]/.test(raw)) {
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kK千万]?)$/);
    return match ? Number(match[1]) * ({ k: 1000, K: 1000, 千: 1000, 万: 10000 }[match[2]] ?? 1) : null;
  }
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let result = 0, digit = 0, lastUnit = 1;
  for (const char of raw) {
    if (digits[char] !== undefined) digit = digits[char];
    else if (units[char]) { lastUnit = units[char]; result += (digit || 1) * lastUnit; digit = 0; }
    else return null;
  }
  // 常见口语“两千五/三千二”仅在无零占位且尾数为单个数字时解释为2500/3200。
  if (digit && lastUnit >= 100 && /^[一二两三四五六七八九][百千][一二两三四五六七八九]$/.test(raw)) return result + digit * (lastUnit / 10);
  return result + digit;
}
type Budget = { min?: number; max?: number; changed: boolean; clear: boolean; uncertain: boolean };
function budget(text: string): Budget {
  const clear = /预算不限|价格不限|月租不限|租金不限|不设预算|取消预算|清除预算|其他(?:条件)?(?:全部|都|暂时)?不限|只(?:限制|要求|指定)城市/u.test(text);
  const result: Budget = { changed: clear, clear, uncertain: false };
  const chunks = text.replace(/元\s*\/\s*月/g, '元').split(/[，。；！？\n,;]/u);
  const modifier = '(?:改成|改为|调到|调整为|为|是)?';
  const upper = new RegExp(`(?:不超过|不高于|最高|最多|至多|上限|低于|小于)${modifier}[\\s：:]*(${numberPattern})(?:元|块)?|(${numberPattern})(?:元|块)?(?:以内|以下|封顶)`, 'gu');
  const lower = new RegExp(`(?:不低于|最低|至少|下限|高于|大于)${modifier}[\\s：:]*(${numberPattern})(?:元|块)?|(${numberPattern})(?:元|块)?(?:以上|起租)`, 'gu');
  const range = new RegExp(`(${numberPattern})(?:元|块)?\\s*(?:到|至|[-—~～])\\s*(${numberPattern})(?:元|块)?`, 'gu');
  const bare = new RegExp(`预算(?:改成|改为|调到|调整为|控制在|是|为)?[\\s：:]*(${numberPattern})(?:元|块)?`, 'gu');
  for (const rawChunk of chunks) {
    // 输出字数、推荐套数、租期等不是月租。保留无单位的常见预算，但先剔除明确的非金额单位。
    const chunk = rawChunk.replace(new RegExp(`(?:不超过|不高于|最高|最多|至少|不低于)?\\s*${numberPattern}\\s*(?:个)?(?:字|条|段|行|页|套|张|分钟|小时|天|个月)`, 'gu'), '');
    if (/押金|保证金|总价|总付款|首付/u.test(chunk) && !/月租|租金|预算/u.test(chunk)) continue;
    if (/(?<!不)(?:低于|高于|小于|大于)|年租|年付预算|每年/u.test(chunk)) result.uncertain = true;
    if (/年租|年付预算|每年|左右|上下|大概|大约|差不多|或(?:者)?[\s\d一二两三四五六七八九]|[><≤≥=]|不是|并非/u.test(chunk) && /预算|租金|月租|元|[0-9].*(?:以内|以下|以上)/u.test(chunk)) result.uncertain = true;
    const ranges = [...chunk.matchAll(range)];
    for (const match of ranges) {
      const min = money(match[1]), max = money(match[2]);
      if (min == null || max == null || min > max) result.uncertain = true;
      else { result.min = min; result.max = max; result.changed = true; result.clear = true; }
    }
    if (ranges.length) continue;
    for (const match of chunk.matchAll(upper)) { const value = money(match[1] ?? match[2]); if (value != null) { result.max = result.max == null ? value : Math.min(result.max, value); result.changed = true; } }
    for (const match of chunk.matchAll(lower)) { const value = money(match[1] ?? match[2]); if (value != null) { result.min = result.min == null ? value : Math.max(result.min, value); result.changed = true; } }
    if (!result.changed) for (const match of chunk.matchAll(bare)) { const value = money(match[1]); if (value != null) { result.max = value; result.changed = true; } }
  }
  if (result.min != null && result.max != null && result.min > result.max) result.uncertain = true;
  return result;
}

export function checkSearchConditions(request: EvidenceRequest, args: SearchArguments): { ok: true; filters: HouseFilters; unavailable: string[] } | { ok: false; reason: string; filters: HouseFilters } {
  const empty: HouseFilters = { location: '', houseTypes: [] };
  const clarify = (reason: string) => ({ ok: false as const, reason, filters: empty });
  const city = evidenceCity(request);
  if (!city) return clarify('请明确一个城市；多个候选城市、模糊地名或排除旧城市时不会自动选择。预算、地段和房型也可一起说明。');
  if (normalizeHouseCity(args.city) !== city) return clarify('工具城市与用户最近明确城市不一致；请重新确认要查询的城市，本轮未执行查询。');
  let min: number | undefined, max: number | undefined;
  let types: string[] = [];
  for (const text of [...request.history.filter(item => item.role === 'user').map(item => item.content), request.message]) {
    const bounds = budget(text);
    if (bounds.uncertain) {
      // 历史模糊需求可以由本轮明确预算覆盖；当前表达模糊则必须询问。
      if (text === request.message) return clarify('预算存在模糊、冲突或暂不支持的表达，请明确月租下限/上限（例如“2000到3000元”或“不超过3000元”）。');
    }
    if (bounds.clear) { min = undefined; max = undefined; }
    if (bounds.min !== undefined) min = bounds.min;
    if (bounds.max !== undefined) max = bounds.max;
    if (/房型不限|户型不限|取消房型|清除房型|其他(?:条件)?(?:全部|都|暂时)?不限|只(?:限制|要求|指定)城市/u.test(text)) types = [];
    const corrections = text.split(/改成|改为|换成/u);
    const typeText = corrections.length > 1 && /一居|一室|1室|两居|二居|两室|二室|2室|三居|三室|3室|合租/u.test(corrections.at(-1)!) ? corrections.at(-1)! : text;
    const mentioned = [
      ['一居室', /一居(?:室)?|一室|1室/u], ['两居室', /两居(?:室)?|二居(?:室)?|两室|二室|2室/u],
      ['三居室', /三居(?:室)?|三室|3室/u], ['合租', /合租/u]
    ].filter(([, pattern]) => (pattern as RegExp).test(typeText)).map(([name]) => name as string);
    if (mentioned.length) {
      if (/不要|不考虑|排除|不接受|不想/u.test(typeText)) {
        if (text === request.message) return clarify('房型包含排除条件，请明确可接受的一居室、两居室、三居室或合租；本轮未查询。');
      } else types = mentioned;
    }
  }
  if (min != null && max != null && min > max) return clarify('月租下限高于上限，请确认预算范围；本轮未查询。');
  if ((args.minPrice ?? undefined) !== min || (args.maxPrice ?? undefined) !== max) return clarify('工具预算与可核对的月租硬条件不一致，请明确上下限后重试；没有放宽预算或执行查询。');
  if (JSON.stringify([...new Set(args.houseTypes)].sort()) !== JSON.stringify([...new Set(types)].sort())) return clarify('工具房型与用户明确房型不一致，请确认实际需求；本轮未查询。');
  let location = args.location ?? '';
  if (request.context.city && request.context.city !== city && location === request.context.location && !request.message.includes(location)) location = '';
  if (/地段不限|区域不限|位置不限|其他(?:条件)?(?:全部|都|暂时)?不限|只(?:限制|要求|指定)城市/u.test(request.message) && location) return clarify('用户已清除地段限制，但工具仍带有地段；请重新确认条件，本轮未查询。');
  const userTexts = [...request.history.filter(item => item.role === 'user').map(item => item.content), request.message];
  if (location && !userTexts.some(text => text.includes(location))) return clarify('工具地段无法从用户表达中核对，请明确区域或小区名称；本轮未查询。');
  const unavailable = [...new Set([...args.unavailablePreferences, ...(/地铁/u.test(request.message) ? ['地铁距离'] : []), ...(/通勤/u.test(request.message) ? ['通勤时间'] : []), ...(/宠物|养猫|养狗/u.test(request.message) ? ['宠物限制'] : []), ...(/学区/u.test(request.message) ? ['学区信息'] : [])])].slice(0, 6);
  return { ok: true, filters: { city, location, ...(min == null ? {} : { minPrice: min }), ...(max == null ? {} : { maxPrice: max }), houseTypes: types as (typeof HOUSE_TYPES)[number][] }, unavailable };
}
