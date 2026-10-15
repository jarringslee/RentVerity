import { HOUSE_TYPES, type HouseFilters, type HouseQuery, type HouseType, type MapBounds } from '../types/houses'

const scalar = (value: unknown) => typeof value === 'string' ? value : undefined
const amount = (value: unknown) => {
  if (value === '' || value === undefined || value === null) return undefined
  const number = Number(value)
  // 已填写但非法的价格不能悄悄变成“不限”，交给表单/服务端明确拒绝。
  return Number.isFinite(number) && number >= 0 && number <= 1000000 ? number : NaN
}

export function houseQueryFromUrl(query: Record<string, unknown>): HouseQuery {
  const sort = scalar(query.sort)
  return {
    location: (scalar(query.location) || '').trim().slice(0, 80),
    minPrice: amount(scalar(query.minPrice)), maxPrice: amount(scalar(query.maxPrice)),
    houseTypes: [...new Set((scalar(query.houseTypes) || '').split(',').filter(Boolean))] as HouseType[],
    ...(query.bounds === undefined ? {} : { bounds: boundsFromUrl(query.bounds) }),
    page: Math.max(1, Math.min(100000, Math.trunc(Number(scalar(query.page)) || 1))),
    pageSize: Math.max(1, Math.min(100, Math.trunc(Number(scalar(query.pageSize)) || 10))),
    sort: sort === 'price_asc' || sort === 'price_desc' ? sort : 'latest'
  }
}

export function houseFiltersToQuery(filters: Partial<HouseQuery>): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.location?.trim()) query.location = filters.location.trim()
  if (filters.minPrice !== undefined && filters.minPrice !== null) query.minPrice = String(filters.minPrice)
  if (filters.maxPrice !== undefined && filters.maxPrice !== null) query.maxPrice = String(filters.maxPrice)
  if (filters.houseTypes?.length) query.houseTypes = filters.houseTypes.join(',')
  if (filters.page && filters.page !== 1) query.page = String(filters.page)
  if (filters.pageSize && filters.pageSize !== 10) query.pageSize = String(filters.pageSize)
  if (filters.sort && filters.sort !== 'latest') query.sort = filters.sort
  if (filters.bounds) query.bounds = [filters.bounds.west, filters.bounds.south, filters.bounds.east, filters.bounds.north].join(',')
  return query
}

function boundsFromUrl(value: unknown): MapBounds {
  const parts = typeof value === 'string' ? value.split(',') : []
  const values = parts.length === 4 && parts.every(part => part.trim()) ? parts.map(Number) : [NaN, NaN, NaN, NaN]
  return { west: values[0], south: values[1], east: values[2], north: values[3] }
}

export function validMapBounds(bounds?: MapBounds): boolean {
  return !bounds || [bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)
    && bounds.west >= -180 && bounds.east <= 180 && bounds.south >= -90 && bounds.north <= 90
    && bounds.west < bounds.east && bounds.south < bounds.north
}

export function validateHouseFilters(filters: HouseFilters): string | null {
  for (const value of [filters.minPrice, filters.maxPrice]) {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || value > 1000000)) return '租金应为 0—1000000 之间的数字。'
  }
  if (filters.minPrice != null && filters.maxPrice != null && filters.minPrice > filters.maxPrice) return '最低租金不能高于最高租金。'
  if (filters.location.length > 80 || filters.houseTypes.some(type => !HOUSE_TYPES.includes(type))) return '位置或房型格式不正确。'
  return null
}

export function cloneHouseFilters(filters: HouseFilters): HouseFilters {
  return { location: filters.location, ...(filters.minPrice == null ? {} : { minPrice: filters.minPrice }), ...(filters.maxPrice == null ? {} : { maxPrice: filters.maxPrice }), houseTypes: [...filters.houseTypes] }
}

export function describeHouseFilters(filters: HouseFilters): string {
  const price = filters.minPrice == null && filters.maxPrice == null ? '租金不限' : `${filters.minPrice ?? 0}—${filters.maxPrice ?? '不限'} 元/月`
  return `${filters.location || '区域不限'} · ${price} · ${filters.houseTypes.join('、') || '房型不限'}`
}
