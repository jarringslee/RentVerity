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
  Icon: BMapGL_IconConstructor
  Size: BMapGL_SizeConstructor
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
  setViewport?(points: BMapGL_Point[]): void
  panTo?(point: BMapGL_Point): void
  getBounds(): { getSouthWest(): BMapGL_Point; getNorthEast(): BMapGL_Point }
  getCenter(): BMapGL_Point
  getZoom(): number
  addEventListener(event: string, handler: () => void): void
  removeEventListener(event: string, handler: () => void): void
  closeInfoWindow(): void
  destroy(): void
}

interface BMapGL_PointConstructor {
  new (lng: number, lat: number): BMapGL_Point
}

interface BMapGL_Point {
  lng: number
  lat: number
}

interface BMapGL_MarkerConstructor {
  new (point: BMapGL_Point, opts?: { icon?: BMapGL_Icon }): BMapGL_Marker
}

interface BMapGL_Marker {
  addEventListener(event: string, handler: Function): void
  removeEventListener(event: string, handler: Function): void
  setIcon(icon: BMapGL_Icon): void
}

interface BMapGL_SizeConstructor {
  new (width: number, height: number): BMapGL_Size
}

interface BMapGL_Size {
  width: number
  height: number
}

interface BMapGL_IconConstructor {
  new (url: string, size: BMapGL_Size, opts?: { anchor?: BMapGL_Size }): BMapGL_Icon
}

interface BMapGL_Icon {}

interface BMapGL_InfoWindowConstructor {
  new (content: string | HTMLElement, opts?: BMapGL_InfoWindowOptions): BMapGL_InfoWindow
}

interface BMapGL_InfoWindowOptions {
  width?: number
  height?: number
  title?: string
  enableAutoPan?: boolean
}

interface BMapGL_InfoWindow {}

interface BMapGL_GeocoderConstructor {
  new (): BMapGL_Geocoder
}

interface BMapGL_Geocoder {
  getPoint(
    address: string,
    callback: (point: BMapGL_Point | null) => void,
    city: string
  ): void
}

interface BMapGL_NavigationControlConstructor {
  new (): any
}

interface BMapGL_ScaleControlConstructor {
  new (): any
}

export {}
