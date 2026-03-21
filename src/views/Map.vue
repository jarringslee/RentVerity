<template>
  <div class="map">
    <el-container class="full-height">
      <el-header class="header">
        <h1>地图找房</h1>
        <div class="nav">
          <el-button @click="$router.push('/')">返回主页</el-button>
          <HeaderUserMenu v-if="isLoggedIn" />
        </div>
      </el-header>

      <el-main>
        <el-row :gutter="20" class="map-main-row">
          <el-col :span="24" :md="6">
            <el-card class="filter-card">
              <div class="search-box">
                <div class="field-label">地图定位</div>
                <el-input
                  v-model="mapSearchKeyword"
                  placeholder="区域、地标或地铁站"
                  clearable
                >
                  <template #append>
                    <el-button :icon="Search" @click="searchOnMap" />
                  </template>
                </el-input>
                <p class="field-hint">仅移动地图中心，不清除房源标记</p>
              </div>

              <div class="filter-section">
                <div class="field-label">房源关键词</div>
                <el-input
                  v-model="textFilter"
                  placeholder="标题或地址包含…"
                  clearable
                />
              </div>

              <div class="filter-section">
                <h4>租金范围（元/月）</h4>
                <el-slider
                  v-model="priceRange"
                  range
                  class="price-slider"
                  :min="0"
                  :max="10000"
                  :step="500"
                  :marks="{ 0: '0', 5000: '5000', 10000: '10000' }"
                />
                <div class="range-summary">
                  {{ priceRange[0] }} — {{ priceRange[1] }} 元 / 月
                </div>
              </div>

              <div class="filter-section">
                <h4>房型</h4>
                <el-checkbox-group v-model="houseTypes">
                  <el-checkbox label="一居室" />
                  <el-checkbox label="两居室" />
                  <el-checkbox label="三居室" />
                  <el-checkbox label="合租" />
                </el-checkbox-group>
              </div>

              <div class="filter-actions">
                <el-button
                  type="primary"
                  class="filter-btn"
                  :loading="dataLoading"
                  @click="applyFilters"
                >
                  应用筛选
                </el-button>
                <el-button class="filter-btn" @click="resetFilters">
                  重置筛选
                </el-button>
              </div>
            </el-card>
          </el-col>

          <el-col :span="24" :md="18">
            <el-card class="map-container" v-loading="dataLoading">
              <div id="map-container" class="map-wrapper"></div>
              <p v-if="mapHint" class="map-hint">{{ mapHint }}</p>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { getHouseList, getUserFavorites } from "../services/api";
import { Search } from "@element-plus/icons-vue";
import userStore from "../stores/userStore";
import HeaderUserMenu from "../components/HeaderUserMenu.vue";

const router = useRouter();
const isLoggedIn = computed(() => userStore.isLoggedIn());

/** 后端 + transform 后的房源（含 lng/lat） */
interface MapHouse {
  id: number;
  title: string;
  price: number;
  location: string;
  lng: number | null;
  lat: number | null;
  description?: string;
}

const mapSearchKeyword = ref("西安");
const textFilter = ref("");
const priceRange = ref<[number, number]>([0, 10000]);
const houseTypes = ref<string[]>([]);

const dataLoading = ref(false);
const mapHint = ref("");
const allHouses = ref<MapHouse[]>([]);
const favoriteIds = ref<Set<number>>(new Set());

let map: any = null;
let favIcon: any = null;

function escHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function filterHouses(list: MapHouse[]): MapHouse[] {
  const [pMin, pMax] = priceRange.value;
  const kw = textFilter.value.trim();
  const types = houseTypes.value;

  return list.filter((h) => {
    if (h.price < pMin || h.price > pMax) return false;
    if (kw) {
      const t = `${h.title} ${h.location}`;
      if (!t.includes(kw)) return false;
    }
    if (types.length > 0) {
      const ok = types.some((type) => h.title.includes(type));
      if (!ok) return false;
    }
    return true;
  });
}

function buildInfoHtml(house: MapHouse, favorited: boolean) {
  const favBadge = favorited ? '<span class="map-iw-fav">已收藏</span>' : "";
  return `
<div class="map-iw">
  <div class="map-iw-title">${escHtml(house.title)}</div>
  ${favBadge}
  <div class="map-iw-price">${house.price} 元/月</div>
  <div class="map-iw-loc">${escHtml(house.location)}</div>
  <button type="button" class="map-iw-btn" onclick="window.__mapOpenHouseDetail(${
    house.id
  })">查看详情</button>
</div>`;
}

function renderMarkers(houses: MapHouse[]) {
  if (!map || typeof BMapGL === "undefined") return;

  map.clearOverlays();

  const withCoord = houses.filter(
    (h) =>
      h.lng != null &&
      h.lat != null &&
      !Number.isNaN(Number(h.lng)) &&
      !Number.isNaN(Number(h.lat))
  );

  if (withCoord.length === 0) {
    mapHint.value =
      houses.length === 0
        ? "当前筛选条件下没有房源。"
        : "没有可展示的坐标：请为房源补充经纬度或执行数据库迁移 004。";
    return;
  }

  mapHint.value = `共 ${withCoord.length} 套房源`;
  const points: any[] = [];

  for (const house of withCoord) {
    const lng = Number(house.lng);
    const lat = Number(house.lat);
    const point = new BMapGL.Point(lng, lat);
    points.push(point);

    const favorited = favoriteIds.value.has(house.id);
    const marker =
      favorited && favIcon
        ? new BMapGL.Marker(point, { icon: favIcon })
        : new BMapGL.Marker(point);

    const infoWindow = new BMapGL.InfoWindow(buildInfoHtml(house, favorited), {
      width: 260,
      title: "",
    });

    marker.addEventListener("click", () => {
      map!.openInfoWindow(infoWindow, point);
    });

    map.addOverlay(marker);
  }

  if (points.length === 1) {
    map.centerAndZoom(points[0], 15);
  } else if (typeof map.setViewport === "function") {
    try {
      map.setViewport(points);
    } catch {
      map.centerAndZoom(points[0], 12);
    }
  } else {
    map.centerAndZoom(points[0], 12);
  }
}

async function loadFavorites() {
  favoriteIds.value = new Set();
  if (!isLoggedIn.value) return;
  try {
    const res = await getUserFavorites();
    if (res.success && Array.isArray(res.data)) {
      favoriteIds.value = new Set(
        (res.data as { id: number }[]).map((h) => h.id)
      );
    }
  } catch {
    /* ignore */
  }
}

async function loadHousesAndRender() {
  dataLoading.value = true;
  mapHint.value = "";
  try {
    await loadFavorites();
    const res = await getHouseList({ page: 1, pageSize: 2000 });
    if (!res.success || !res.data?.list) {
      mapHint.value = (res as { message?: string }).message || "加载房源失败";
      allHouses.value = [];
      if (map) renderMarkers([]);
      return;
    }
    allHouses.value = res.data.list as MapHouse[];
    applyFilters();
  } finally {
    dataLoading.value = false;
  }
}

function applyFilters() {
  const filtered = filterHouses(allHouses.value);
  renderMarkers(filtered);
}

function resetFilters() {
  textFilter.value = "";
  priceRange.value = [0, 10000];
  houseTypes.value = [];
  applyFilters();
}

function searchOnMap() {
  if (!map || !mapSearchKeyword.value.trim()) return;
  const myGeo = new BMapGL.Geocoder();
  myGeo.getPoint(
    mapSearchKeyword.value.trim(),
    (point: { lng: number; lat: number } | null) => {
      if (point && typeof point.lng === "number") {
        map!.centerAndZoom(point, 15);
        if (typeof map!.panTo === "function") {
          map!.panTo(point);
        }
      } else {
        alert("未能找到该地址，请换关键词试试");
      }
    },
    "西安市"
  );
}

function initFavIcon() {
  if (typeof BMapGL === "undefined" || favIcon) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path fill="#e91e63" d="M16 0C8 0 2 6 2 13c0 10 14 27 14 27s14-17 14-27C30 6 24 0 16 0z"/>
    <circle cx="16" cy="12" r="4.5" fill="#fff"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  const size = new BMapGL.Size(32, 40);
  favIcon = new BMapGL.Icon(url, size, { anchor: new BMapGL.Size(16, 40) });
}

function initMap() {
  if (typeof BMapGL === "undefined") {
    setTimeout(initMap, 500);
    return;
  }
  initFavIcon();
  map = new BMapGL.Map("map-container");
  const point = new BMapGL.Point(108.948024, 34.263161);
  map.centerAndZoom(point, 12);
  map.enableScrollWheelZoom(true);
  map.addControl(new BMapGL.NavigationControl());
  map.addControl(new BMapGL.ScaleControl());
  void loadHousesAndRender();
}

onMounted(() => {
  (
    window as unknown as { __mapOpenHouseDetail?: (id: number) => void }
  ).__mapOpenHouseDetail = (id: number) => {
    router.push({ name: "HouseDetail", params: { id: String(id) } });
  };
  initMap();
});

onUnmounted(() => {
  delete (window as unknown as { __mapOpenHouseDetail?: unknown })
    .__mapOpenHouseDetail;
  map = null;
});
</script>

<style scoped>
.full-height {
  height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #409eff;
  color: white;
}

.nav {
  display: flex;
  align-items: center;
  gap: 12px;
}

.map-main-row {
  min-height: calc(100vh - 120px);
}

.map-wrapper {
  height: 600px;
  width: 100%;
}

.map-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: #606266;
}

.search-box {
  margin-bottom: 16px;
}

.field-label {
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}

.filter-section {
  margin-bottom: 18px;
}

.filter-section h4 {
  margin: 0 0 10px;
  font-size: 14px;
}

.price-slider {
  margin-bottom: 4px;
}

.range-summary {
  margin-top: 20px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  text-align: center;
  line-height: 1.4;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
  box-sizing: border-box;
}

.filter-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.filter-btn {
  width: 100%;
  margin: 0;
}

@media (max-width: 768px) {
  .map-wrapper {
    height: 420px;
  }
}
</style>

<style>
/* InfoWindow 内联 HTML 样式（非 scoped） */
.map-iw {
  padding: 4px 2px 8px;
  font-size: 13px;
}
.map-iw-title {
  font-weight: 600;
  margin-bottom: 6px;
  line-height: 1.35;
}
.map-iw-fav {
  display: inline-block;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
}
.map-iw-price {
  color: #ff6600;
  font-weight: bold;
  margin-bottom: 4px;
}
.map-iw-loc {
  color: #666;
  font-size: 12px;
  margin-bottom: 10px;
  line-height: 1.4;
}
.map-iw-btn {
  width: 100%;
  padding: 8px 12px;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.map-iw-btn:hover {
  background: #66b1ff;
}
</style>
