import { provinceAndCityData } from 'element-china-area-data';

// 房源城市是地级市/直辖市，不复用个人资料中可能为“区”的叶子选项。
const municipalities = new Set(['北京市', '天津市', '上海市', '重庆市']);
export const HOUSE_CITIES = [...new Set(provinceAndCityData.flatMap(province =>
  municipalities.has(province.label) ? [province.label] : (province.children ?? []).map(city => city.label)
))].filter(name => name !== '市辖区' && name !== '县' && !name.includes('直辖县级'));
const aliases = new Map<string, string>();
for (const city of HOUSE_CITIES) {
  aliases.set(city, city);
  if (city.endsWith('市')) aliases.set(city.slice(0, -1), city);
}
export function normalizeHouseCity(value: unknown): string | null {
  return typeof value === 'string' ? aliases.get(value.trim()) ?? null : null;
}

/** 仅在用户自己的原话中找城市；助手回答/个人资料/模型参数不算城市证据。 */
export function citiesMentioned(text: string): string[] {
  const found = new Set<string>();
  for (const [alias, city] of aliases) {
    let offset = text.indexOf(alias);
    while (offset !== -1) {
      const suffix = text.slice(offset + alias.length);
      // “朝阳区/吉林省/西安路/北京大学”本身不能作为整市证据。
      if (alias === city || !/^(?:省|区|县|路|街|大道|大学)/u.test(suffix)) found.add(city);
      offset = text.indexOf(alias, offset + alias.length);
    }
  }
  return [...found];
}

export function inferLegacyHouse(row: { location: string; title: string }): { city: string | null; houseType: string | null } {
  // 旧数据仅接受地址里明确的完整城市名，不凭“高新区”或坐标猜城市。
  const cities = HOUSE_CITIES.filter(city => row.location.includes(city));
  const types = [
    ['一居室', /一居室|一室|1室|一居/u], ['两居室', /两居室|二居室|两室|二室|2室|两居|二居/u],
    ['三居室', /三居室|三室|3室|三居/u], ['合租', /合租/u]
  ].filter(([, pattern]) => (pattern as RegExp).test(row.title)).map(([type]) => type as string);
  return { city: cities.length === 1 ? cities[0] : null, houseType: types.length === 1 ? types[0] : null };
}
