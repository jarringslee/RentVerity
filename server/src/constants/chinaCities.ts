import type { DataItem } from 'element-china-area-data';
import { provinceAndCityData } from 'element-china-area-data';

/** 省→市（直辖市为区）级联中所有可选叶子名称，用于校验 users.city */
function collectLeafLabels(nodes: DataItem[]): string[] {
  const out: string[] = [];
  for (const prov of nodes) {
    if (prov.children?.length) {
      for (const leaf of prov.children) {
        out.push(leaf.label);
      }
    } else {
      out.push(prov.label);
    }
  }
  return out;
}

export const CHINA_CITIES = collectLeafLabels(provinceAndCityData);

/** 旧版扁平下拉曾把直辖市整市作为一条；与级联叶子（区）并存，避免老数据无法通过校验 */
const LEGACY_MUNICIPALITY_NAMES = ['北京市', '上海市', '天津市', '重庆市'];

export const CHINA_CITY_SET = new Set([...CHINA_CITIES, ...LEGACY_MUNICIPALITY_NAMES]);
