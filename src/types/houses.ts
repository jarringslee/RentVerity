export const HOUSE_TYPES = ['一居室', '两居室', '三居室', '合租'] as const
export type HouseType = typeof HOUSE_TYPES[number]
export interface HouseFilters { city?: string; location: string; minPrice?: number; maxPrice?: number; houseTypes: HouseType[] }
export interface MapBounds { west: number; south: number; east: number; north: number }
export interface HouseQuery extends HouseFilters { bounds?: MapBounds; page: number; pageSize: number; sort: 'latest' | 'price_asc' | 'price_desc' }
export const emptyHouseFilters = (): HouseFilters => ({ location: '', houseTypes: [] })
