// 百度地图API类型定义
declare global {
  interface Window {
    BMapGL: typeof BMapGL
  }

  const BMapGL: BMapGL
}

interface BMapGL {
  Map: BMapGL_MapConstructor
  Point: BMapGL_PointConstructor
  Marker: BMapGL_MarkerConstructor
  InfoWindow: BMapGL_InfoWindowConstructor
  Geocoder: BMapGL_GeocoderConstructor
  NavigationControl: BMapGL_NavigationControlConstructor
  ScaleControl: BMapGL_ScaleControlConstructor
}

interface BMapGL_MapConstructor {
  new (container: string | HTMLElement, opts?: BMapGL_MapOptions): BMapGL_Map
}

interface BMapGL_MapOptions {
  minZoom?: number
  maxZoom?: number
}

interface BMapGL_Map {
  centerAndZoom(point: BMapGL_Point, zoom: number): void
  enableScrollWheelZoom(flag: boolean): void
  addControl(control: any): void
  clearOverlays(): void
  addOverlay(overlay: any): void
  openInfoWindow(infoWnd: BMapGL_InfoWindow, point: BMapGL_Point): void
  zoomIn(): void
  zoomOut(): void
}

interface BMapGL_PointConstructor {
  new (lng: number, lat: number): BMapGL_Point
}

interface BMapGL_Point {
  lng: number
  lat: number
}

interface BMapGL_MarkerConstructor {
  new (point: BMapGL_Point): BMapGL_Marker
}

interface BMapGL_Marker {
  addEventListener(event: string, handler: Function): void
}

interface BMapGL_InfoWindowConstructor {
  new (content: string, opts?: BMapGL_InfoWindowOptions): BMapGL_InfoWindow
}

interface BMapGL_InfoWindowOptions {
  width?: number
  height?: number
  title?: string
}

interface BMapGL_InfoWindow {}

interface BMapGL_GeocoderConstructor {
  new (): BMapGL_Geocoder
}

interface BMapGL_Geocoder {
  getPoint(address: string, callback: (point: BMapGL_Point) => void, city: string): void
}

interface BMapGL_NavigationControlConstructor {
  new (): any
}

interface BMapGL_ScaleControlConstructor {
  new (): any
}

export {}