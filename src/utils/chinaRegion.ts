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
