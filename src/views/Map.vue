<template>
  <div class="map-page">
    <header class="map-header">
      <div><h1>地图找房</h1><p>移动地图筛选视野内房源，点击标记或卡片互相定位</p></div>
      <nav><el-button @click="router.push('/')">返回首页</el-button><el-button @click="goAssistant">AI 助手</el-button><el-button @click="goList">带条件去列表</el-button><HeaderUserMenu v-if="isLoggedIn" /></nav>
    </header>
    <main class="map-layout">
      <aside>
        <el-card>
          <h2>筛选房源</h2>
          <el-form label-position="top">
            <el-form-item label="地图定位（不改变房源关键词）"><el-input id="map-address" v-model="mapSearchKeyword" placeholder="区域、地标或地铁站" @keyup.enter="searchOnMap"><template #append><el-button :disabled="!mapReady" @click="searchOnMap">定位</el-button></template></el-input></el-form-item>
            <el-form-item label="房源关键词"><el-input id="map-location" v-model="draft.location" :maxlength="80" placeholder="标题或地址包含…" clearable /></el-form-item>
            <el-form-item label="最低月租（元）"><el-input-number id="map-min-price" v-model="draft.minPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" /></el-form-item>
            <el-form-item label="最高月租（元）"><el-input-number id="map-max-price" v-model="draft.maxPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" /></el-form-item>
            <el-form-item label="房型"><el-checkbox-group v-model="draft.houseTypes"><el-checkbox v-for="type in HOUSE_TYPES" :key="type" :value="type">{{ type }}</el-checkbox></el-checkbox-group></el-form-item>
          </el-form>
          <p class="muted">房型按标题关键词匹配。地图只展示有坐标的候选；旧数据中有演示坐标，并非核实过的实际地址。</p>
          <div class="filter-actions"><el-button type="primary" @click="applyFilters">应用筛选</el-button><el-button @click="resetFilters">重置条件</el-button><el-button @click="goListWithoutBounds">不限视野看列表</el-button></div>
        </el-card>
      </aside>
      <section class="map-and-results">
        <el-card>
          <el-alert v-if="mapError" :title="mapError" type="warning" :closable="false" show-icon><el-button size="small" @click="goList">带条件返回列表</el-button></el-alert>
          <div id="map-container" class="map-canvas" :aria-busy="dataLoading || viewPending"></div>
          <p class="map-status" role="status">{{ viewPending ? '视野变化中，等待地图稳定…' : dataLoading ? '正在查询房源…' : mapReady ? '拖动或缩放结束后自动查询，已保存到 URL。' : '正在加载地图；下方仍可查看房源。' }}</p>
        </el-card>
        <el-card class="map-results">
          <div class="results-heading"><h2>{{ applied.bounds ? '视野内房源' : '符合条件的房源' }}</h2><span>共 {{ total }} 套，展示 {{ houses.length }} 套（最多 100 套）</span></div>
          <p class="muted">{{ describeHouseFilters(applied) }}{{ applied.bounds ? ' · 已限制地图视野，无坐标房源不计入' : '' }}</p>
          <el-alert v-if="dataError" :title="dataError" type="error" :closable="false" show-icon><el-button size="small" @click="loadHouses">重试查询</el-button></el-alert>
          <el-empty v-else-if="!dataLoading && !viewPending && !houses.length" description="当前条件下没有房源。可移动地图或修改条件，不会自动放宽。" />
          <div class="map-house-list" :class="{ stale: dataLoading || viewPending }">
            <article v-for="house in houses" :key="house.id" :data-house-id="house.id" :class="['map-house', { selected: selectedId === house.id }]">
              <div><h3>{{ house.title }} <el-tag v-if="favoriteIds.has(house.id)" size="small" type="danger">已收藏</el-tag></h3><p class="price">{{ house.price }} 元/月</p><p>{{ house.location }}</p></div>
              <div class="house-actions"><el-button size="small" :disabled="!mapReady || !hasCoordinates(house) || dataLoading || viewPending" @click="selectHouse(house.id, true)">地图定位</el-button><el-button size="small" @click="router.push(`/house/${house.id}`)">查看详情</el-button><span v-if="!hasCoordinates(house)" class="muted">缺少坐标</span></div>
            </article>
          </div>
        </el-card>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'
import userStore from '../stores/userStore'
import { getHouseList, getUserFavorites } from '../services/api'
import { HOUSE_TYPES, emptyHouseFilters, type HouseQuery, type MapBounds } from '../types/houses'
import { cloneHouseFilters, describeHouseFilters, houseFiltersToQuery, houseQueryFromUrl, validateHouseFilters, validMapBounds } from '../utils/houseFilters'
import { mapMetaFromUrl, mapViewFromUrl, mapViewToQuery, roundCoordinate, selectedHouseFromUrl } from '../utils/mapState'

interface MapHouse { id: number; title: string; price: number; location: string; lng: number | null; lat: number | null }
type MapInstance = InstanceType<typeof BMapGL.Map>
type Marker = InstanceType<typeof BMapGL.Marker>
const router = useRouter(), route = useRoute()
const isLoggedIn = computed(() => userStore.isLoggedIn())
const draft = reactive(emptyHouseFilters())
const applied = ref<HouseQuery>(houseQueryFromUrl(route.query))
const mapSearchKeyword = ref('')
const mapReady = ref(false), mapError = ref(''), dataError = ref('')
const dataLoading = ref(false), viewPending = ref(false)
const houses = ref<MapHouse[]>([]), total = ref(0), selectedId = ref<number | null>(null)
const favoriteIds = ref(new Set<number>())
let map: MapInstance | null = null
let markers = new Map<number, Marker>()
let markerHandlers: { marker: Marker; handler: () => void }[] = []
let mapTimer: ReturnType<typeof setTimeout> | null = null
let viewportTimer: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null
let requestVersion = 0, geocodeVersion = 0, favoriteVersion = 0
let disposed = false, lastDataKey = ''
let firstTiles = true

function hasCoordinates(house: MapHouse) { return house.lng != null && house.lat != null && Number.isFinite(house.lng) && Number.isFinite(house.lat) && Math.abs(house.lng) <= 180 && Math.abs(house.lat) <= 85 }
function cancelQuery() { ++requestVersion; controller?.abort(); controller = null; dataLoading.value = false }
function clearMarkers() {
  for (const { marker, handler } of markerHandlers) marker.removeEventListener('click', handler)
  markerHandlers = []; markers.clear(); map?.clearOverlays()
}
function markerIcon(selected: boolean, favorited: boolean) {
  const color = selected ? '#e6a23c' : favorited ? '#e91e63' : '#409eff'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><path fill="${color}" d="M15 0C7 0 1 6 1 14c0 10 14 26 14 26s14-16 14-26C29 6 23 0 15 0z"/><circle cx="15" cy="13" r="5" fill="white"/></svg>`
  return new BMapGL.Icon(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, new BMapGL.Size(30, 40), { anchor: new BMapGL.Size(15, 40) })
}
function showSelection(scroll = false) {
  if (!map) return
  for (const [id, marker] of markers) marker.setIcon(markerIcon(id === selectedId.value, favoriteIds.value.has(id)))
  const house = houses.value.find(house => house.id === selectedId.value)
  if (!house || !hasCoordinates(house)) { map.closeInfoWindow(); return }
  // 不拼接房源 HTML，也不注册全局 onclick；数据库文本只能作为 textContent。
  const content = document.createElement('div'); content.className = 'map-info'
  for (const text of [house.title, `${house.price} 元/月`, house.location]) { const paragraph = document.createElement('p'); paragraph.textContent = text; content.append(paragraph) }
  const button = document.createElement('button'); button.textContent = '查看详情'; button.addEventListener('click', () => router.push(`/house/${house.id}`)); content.append(button)
  map.openInfoWindow(new BMapGL.InfoWindow(content, { width: 260, enableAutoPan: false }), new BMapGL.Point(house.lng!, house.lat!))
  if (scroll) void nextTick(() => document.querySelector(`[data-house-id="${house.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function renderMarkers() {
  if (!map) return
  clearMarkers()
  for (const house of houses.value.filter(hasCoordinates)) {
    const marker = new BMapGL.Marker(new BMapGL.Point(house.lng!, house.lat!), { icon: markerIcon(house.id === selectedId.value, favoriteIds.value.has(house.id)) })
    const handler = () => selectHouse(house.id, false)
    marker.addEventListener('click', handler); markerHandlers.push({ marker, handler }); markers.set(house.id, marker); map.addOverlay(marker)
  }
  // 查询结果绝不自动 setViewport，否则会形成移动→查询→重新取景的循环。
  showSelection()
}
function selectHouse(id: number, pan: boolean) {
  const house = houses.value.find(house => house.id === id)
  if (!house || !hasCoordinates(house) || !map || viewPending.value || dataLoading.value) return
  selectedId.value = id
  void router.replace({ path: '/map', query: { ...route.query, selected: String(id) } })
  showSelection(!pan)
  if (pan) map.panTo(new BMapGL.Point(house.lng!, house.lat!))
}
async function loadHouses() {
  cancelQuery()
  const invalid = validateHouseFilters(applied.value)
  if (invalid || !validMapBounds(applied.value.bounds)) {
    dataError.value = invalid || 'URL 视野边界无效，请重置条件。'; houses.value = []; total.value = 0; clearMarkers(); return
  }
  controller = new AbortController()
  const signal = controller.signal, version = requestVersion
  dataLoading.value = true; dataError.value = ''
  try {
    const result = await getHouseList({ ...applied.value, page: 1, pageSize: 100 }, signal)
    if (version !== requestVersion || disposed) return
    if (!result.success) throw new Error(result.message || '查询失败，请重试。')
    houses.value = result.data.list; total.value = Number(result.data.total); renderMarkers()
  } catch (error) {
    if (signal.aborted || version !== requestVersion || disposed) return
    houses.value = []; total.value = 0; clearMarkers(); dataError.value = error instanceof Error ? error.message : '查询失败，请重试。'
  } finally { if (version === requestVersion) dataLoading.value = false }
}
function navigate(query: Record<string, string>, push = false) {
  const target = { path: '/map', query }
  if (router.resolve(target).fullPath === route.fullPath) { viewPending.value = false; void loadHouses() }
  else void (push ? router.push(target) : router.replace(target))
}
function applyFilters() {
  const invalid = validateHouseFilters(draft)
  if (invalid) { ElMessage.error(invalid); return }
  navigate({ ...houseFiltersToQuery({ ...applied.value, ...cloneHouseFilters(draft), minPrice: draft.minPrice ?? undefined, maxPrice: draft.maxPrice ?? undefined, page: 1 }), ...mapMetaFromUrl(route.query) }, true)
}
function resetFilters() {
  Object.assign(draft, emptyHouseFilters(), { minPrice: undefined, maxPrice: undefined })
  navigate({ ...mapMetaFromUrl(route.query), ...houseFiltersToQuery({ ...emptyHouseFilters(), bounds: validMapBounds(applied.value.bounds) ? applied.value.bounds : undefined }) }, true)
}
function goList() { router.push({ path: '/houses', query: { ...houseFiltersToQuery({ ...applied.value, page: 1, pageSize: 10 }), ...mapMetaFromUrl(route.query) } }) }
function goListWithoutBounds() { router.push({ path: '/houses', query: houseFiltersToQuery({ ...applied.value, bounds: undefined, page: 1, pageSize: 10 }) }) }
function goAssistant() { router.push({ path: '/ai-assistant', query: houseFiltersToQuery(cloneHouseFilters(applied.value)) }) }
function readViewport() {
  if (!map) return null
  const bounds = map.getBounds(), sw = bounds.getSouthWest(), ne = bounds.getNorthEast(), center = map.getCenter()
  if (!sw || !ne || !center) return null
  const box: MapBounds = { west: roundCoordinate(sw.lng), south: roundCoordinate(sw.lat), east: roundCoordinate(ne.lng), north: roundCoordinate(ne.lat) }
  return validMapBounds(box) ? { bounds: box, view: { lng: center.lng, lat: center.lat, zoom: map.getZoom() } } : null
}
function viewportStart() { if (disposed) return; cancelQuery(); viewPending.value = true; if (viewportTimer) clearTimeout(viewportTimer) }
function viewportEnd() {
  if (disposed) return
  if (viewportTimer) clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    if (disposed || !map) return
    const current = readViewport()
    if (!current) { viewPending.value = false; dataError.value = '无法读取当前视野，暂不支持跨日期变更线的范围；请缩小地图后重试。'; return }
    navigate({ ...houseFiltersToQuery({ ...applied.value, bounds: current.bounds, page: 1 }), ...mapViewToQuery(current.view), ...(selectedId.value ? { selected: String(selectedId.value) } : {}) })
  }, 300)
}
function onTilesLoaded() { if (firstTiles) { firstTiles = false; viewportEnd() } }
const eventHandlers: [string, () => void][] = [['movestart', viewportStart], ['zoomstart', viewportStart], ['moveend', viewportEnd], ['zoomend', viewportEnd], ['resize', viewportEnd], ['tilesloaded', onTilesLoaded]]
function initMap(attempt = 0) {
  if (disposed) return
  if (typeof BMapGL === 'undefined') {
    if (attempt >= 20) { mapError.value = '百度地图 SDK 未能加载（网络或 AK 配置问题），可返回列表继续找房。'; return }
    mapTimer = setTimeout(() => initMap(attempt + 1), 500); return
  }
  try {
    map = new BMapGL.Map('map-container', { minZoom: 3, maxZoom: 19 })
    for (const [event, handler] of eventHandlers) map.addEventListener(event, handler)
    const view = mapViewFromUrl(route.query, validMapBounds(applied.value.bounds) ? applied.value.bounds : undefined)
    map.centerAndZoom(new BMapGL.Point(view.lng, view.lat), view.zoom)
    map.enableScrollWheelZoom(true); map.addControl(new BMapGL.ScaleControl())
    mapReady.value = true; renderMarkers(); viewportEnd()
  } catch { mapError.value = '地图初始化失败，请检查 WebGL 支持、网络或 AK 权限；可继续使用列表。'; mapReady.value = false }
}
function searchOnMap() {
  if (!map || !mapSearchKeyword.value.trim()) return
  const version = ++geocodeVersion
  new BMapGL.Geocoder().getPoint(mapSearchKeyword.value.trim(), point => {
    if (disposed || version !== geocodeVersion || !map) return
    if (point && Number.isFinite(point.lng) && Number.isFinite(point.lat)) map.centerAndZoom(point, 15)
    else ElMessage.warning('未能定位该地址，请换关键词；当前房源条件未改变。')
  }, '西安市')
}
watch(() => route.query, (query, previous) => {
  if (route.path !== '/map') return
  const next = houseQueryFromUrl(query)
  applied.value = next
  if (!previous || JSON.stringify(cloneHouseFilters(next)) !== JSON.stringify(cloneHouseFilters(houseQueryFromUrl(previous)))) Object.assign(draft, emptyHouseFilters(), cloneHouseFilters(next), { minPrice: next.minPrice, maxPrice: next.maxPrice })
  selectedId.value = selectedHouseFromUrl(query)
  if (map && (!previous || query.center !== previous.center || query.zoom !== previous.zoom || (!query.center && query.bounds !== previous.bounds))) {
    const target = mapViewFromUrl(query, validMapBounds(next.bounds) ? next.bounds : undefined), current = map.getCenter()
    if (Math.abs(current.lng - target.lng) > 0.000002 || Math.abs(current.lat - target.lat) > 0.000002 || map.getZoom() !== target.zoom) map.centerAndZoom(new BMapGL.Point(target.lng, target.lat), target.zoom)
  }
  const key = JSON.stringify(houseFiltersToQuery({ ...next, page: 1, pageSize: 100 }))
  if (key !== lastDataKey) { lastDataKey = key; viewPending.value = false; void loadHouses() }
  else showSelection()
}, { immediate: true })
watch(() => userStore.currentUser.value?.id, async () => {
  const version = ++favoriteVersion; favoriteIds.value = new Set()
  if (isLoggedIn.value) {
    try { const result = await getUserFavorites(); if (version !== favoriteVersion || disposed) return; if (result.success) favoriteIds.value = new Set(result.data.map((house: { id: number }) => Number(house.id))) } catch { /* 收藏失败不阻塞公开查询 */ }
  }
  if (!disposed) renderMarkers()
}, { immediate: true })
onMounted(() => initMap())
onBeforeUnmount(() => {
  disposed = true; ++geocodeVersion; ++favoriteVersion; cancelQuery()
  if (mapTimer) clearTimeout(mapTimer)
  if (viewportTimer) clearTimeout(viewportTimer)
  for (const [event, handler] of eventHandlers) map?.removeEventListener(event, handler)
  clearMarkers(); map?.closeInfoWindow(); map?.destroy(); map = null
})
</script>

<style scoped>
.map-page { background: #f5f7fa; min-height: 100vh; color: #303133; text-align: left; }
.map-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 28px; background: white; border-bottom: 1px solid #e4e7ed; }
h1 { font-size: 24px; margin: 0 0 6px; } h2 { font-size: 18px; margin: 0 0 12px; } h3 { font-size: 15px; margin: 0; } p { line-height: 1.6; }
.map-header p { margin: 0; color: #606266; font-size: 13px; } nav, .filter-actions, .house-actions { display: flex; gap: 8px; flex-wrap: wrap; } nav :deep(.el-button), .filter-actions :deep(.el-button), .house-actions :deep(.el-button) { margin-left: 0; }
.map-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; max-width: 1500px; padding: 20px; margin: auto; }
.map-layout > *, .map-and-results { min-width: 0; } .map-layout :deep(.el-input-number) { width: 100%; }
.map-canvas { height: 480px; width: 100%; background: #eef1f5; } .map-status, .muted { color: #606266; font-size: 12px; } .map-status { margin: 10px 0 0; }
.map-results { margin-top: 16px; } .results-heading { display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline; } .results-heading span { font-size: 13px; }
.map-house-list { max-height: 440px; overflow-y: auto; } .map-house-list.stale { opacity: .55; } .map-house { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px; margin: 8px 0; border: 2px solid #ebeef5; border-radius: 8px; }
.map-house.selected { border-color: #e6a23c; background: #fdf6ec; } .map-house p { margin: 5px 0; } .price { color: #e66b00; font-weight: 600; }
@media (max-width: 850px) { .map-layout { grid-template-columns: minmax(0, 1fr); padding: 12px; } .map-header { flex-wrap: wrap; padding: 16px; } .map-canvas { height: 360px; } .map-house { flex-direction: column; align-items: flex-start; } }
</style>
<style>
.map-info { font-size: 13px; color: #303133; padding: 4px; } .map-info p { margin: 8px 0; } .map-info button { border: none; border-radius: 4px; background: #409eff; color: white; padding: 8px 14px; cursor: pointer; }
</style>
