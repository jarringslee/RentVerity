import { provinceAndCityData } from 'element-china-area-data'
import type { DataItem } from 'element-china-area-data'

export { provinceAndCityData }

/** 根据省、市（区）编码得到叶子地区名称，与后端 city 字段一致 */
export function cityLabelFromCodes(codes: string[] | null | undefined): string {
  if (!codes?.length) return ''
  const pCode = codes[0]
  const cCode = codes[codes.length - 1]
  const prov = provinceAndCityData.find((p: DataItem) => p.value === pCode)
  const city = prov?.children?.find((c: DataItem) => c.value === cCode)
  return city?.label ?? ''
}

/** 由已保存的地区名反查级联 value（同名地区取数据中的第一条） */
export function findRegionCodesByCityLabel(name: string | null | undefined): string[] {
  const n = name && String(name).trim()
  if (!n) return []
  for (const prov of provinceAndCityData) {
    const hit = prov.children?.find((c: DataItem) => c.label === n)
    if (hit) return [prov.value, hit.value]
  }
  return []
}

/** 与后端兼容的旧数据：曾把直辖市整市存为一条 */
const LEGACY_MUNICIPALITY_NAMES = new Set([
  '北京市',
  '上海市',
  '天津市',
  '重庆市'
])

/**
 * 展示用：「省-市」或「直辖市-区」；旧数据仅直辖市名则原样展示
 */
export function formatRegionDisplay(storedLeafLabel: string | null | undefined): string {
  const raw = storedLeafLabel && String(storedLeafLabel).trim()
  if (!raw) return ''
  if (LEGACY_MUNICIPALITY_NAMES.has(raw)) return raw
  for (const prov of provinceAndCityData) {
    const hit = prov.children?.find((c: DataItem) => c.label === raw)
    if (hit) return `${prov.label}-${raw}`
  }
  return raw
}
