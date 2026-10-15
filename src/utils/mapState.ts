import type { MapBounds } from '../types/houses'

export interface MapView { lng: number; lat: number; zoom: number }
export const DEFAULT_MAP_VIEW: MapView = { lng: 108.948024, lat: 34.263161, zoom: 12 }
export const roundCoordinate = (value: number) => Number(value.toFixed(6))
export function mapViewFromUrl(query: Record<string, unknown>, bounds?: MapBounds): MapView {
  const center = typeof query.center === 'string' ? query.center.split(',').map(Number) : []
  const zoom = typeof query.zoom === 'string' ? Number(query.zoom) : NaN
  const validCenter = center.length === 2 && Number.isFinite(center[0]) && Number.isFinite(center[1]) && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 85
  return {
    lng: validCenter ? center[0] : bounds ? (bounds.west + bounds.east) / 2 : DEFAULT_MAP_VIEW.lng,
    lat: validCenter ? center[1] : bounds ? (bounds.south + bounds.north) / 2 : DEFAULT_MAP_VIEW.lat,
    zoom: Number.isInteger(zoom) && zoom >= 3 && zoom <= 19 ? zoom : DEFAULT_MAP_VIEW.zoom
  }
}
export function mapViewToQuery(view: MapView): Record<string, string> {
  return { center: `${roundCoordinate(view.lng)},${roundCoordinate(view.lat)}`, zoom: String(view.zoom) }
}
export function mapMetaFromUrl(query: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {}
  for (const key of ['center', 'zoom', 'selected']) if (typeof query[key] === 'string') meta[key] = query[key]
  return meta
}
export function selectedHouseFromUrl(query: Record<string, unknown>): number | null {
  const id = typeof query.selected === 'string' ? Number(query.selected) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
