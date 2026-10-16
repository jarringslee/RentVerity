<template>
  <div class="houses">
    <el-container class="full-height">
      <el-header class="header">
        <h1>房源列表</h1>
        <div class="nav">
          <el-button
            @click="goAssistant"
            type="primary"
            >AI 助手</el-button
          >
          <el-button
            @click="$router.push('/')"
            type="primary"
            style="margin-right: 10px"
            >返回主页</el-button
          >
          <el-button
            @click="$router.push('/favorites')"
            type="primary"
            style="margin-right: 10px"
            >收藏夹</el-button
          >
          <el-button
            @click="$router.push('/house-compare')"
            type="primary"
            style="margin-right: 10px"
            >房源对比</el-button
          >
          <HeaderUserMenu v-if="isLoggedIn" />
          <div v-else>
            <el-button type="primary" @click="$router.push('/login')"
              >登录</el-button
            >
            <el-button @click="$router.push('/register')">注册</el-button>
          </div>
        </div>
      </el-header>

      <el-main class="main-content">
        <div class="houses-inner">
          <el-row :gutter="20" class="houses-row">
            <!-- 筛选栏 -->
            <el-col :span="24" :md="6" class="filter-sidebar">
              <el-card class="filter-card">
                <div class="filter-section">
                  <h2>筛选房源</h2>
                  <h4>位置</h4>
                  <el-input
                    id="house-location"
                    v-model="filters.location"
                    placeholder="请输入位置"
                  ></el-input>
                </div>

                <div class="filter-section">
                  <h4>价格范围</h4>
                  <label class="price-label" for="house-min-price">最低月租</label>
                  <el-input-number id="house-min-price" v-model="filters.minPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" style="width: 100%" />
                  <label class="price-label" for="house-max-price">最高月租</label>
                  <el-input-number id="house-max-price" v-model="filters.maxPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" style="width: 100%" />
                </div>

                <div class="filter-section">
                  <h4>房型</h4>
                  <el-checkbox-group v-model="filters.houseTypes">
                    <el-checkbox v-for="type in HOUSE_TYPES" :key="type" :value="type">{{ type }}</el-checkbox>
                  </el-checkbox-group>
                </div>

                <div class="filter-section">
                  <h4>排序</h4>
                  <el-select v-model="filters.sort" style="width: 100%"><el-option label="最新发布" value="latest" /><el-option label="租金从低到高" value="price_asc" /><el-option label="租金从高到低" value="price_desc" /></el-select>
                  <p class="filter-hint">{{ filters.city ? '当前城市：' + filters.city + '；' : '' }}房型使用结构化字段，旧数据未知房型不计入限定房型结果；实际情况请看房核实。</p>
                </div>

                <el-button
                  type="primary"
                  @click="applyFilters"
                  style="width: 100%; margin-top: 20px"
                >
                  应用筛选
                </el-button>
                <el-button
                  @click="resetFilters"
                  style="width: 100%; margin-top: 10px; margin-left: 0"
                >
                  重置筛选
                </el-button>
              </el-card>
            </el-col>

            <!-- 房源列表 -->
            <el-col :span="24" :md="18" class="house-list-container">
              <div class="house-list-wrapper">
                <div class="house-list-content">
                  <el-card class="house-list-card" v-loading="loading">
                    <div class="list-toolbar"><el-button @click="goToMap">带条件去地图</el-button><span v-if="applied.bounds">已限制地图视野（无坐标房源不计入）</span><el-button v-if="applied.bounds" size="small" @click="clearBounds">取消视野限制</el-button></div>
                    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon><el-button size="small" @click="fetchHouseList">重试</el-button></el-alert>
                    <div v-else class="house-list">
                      <template v-if="houseList.length > 0">
                        <el-row :gutter="20">
                          <el-col
                            :span="24"
                            v-for="house in houseList"
                            :key="house.id"
                            class="house-item"
                          >
                            <el-card
                              class="house-card"
                              @click="viewHouseDetail(house.id)"
                            >
                              <el-tag
                                v-if="isHouseFavorited(house.id)"
                                size="small"
                                type="danger"
                                class="favorite-badge"
                              >
                                已收藏
                              </el-tag>
                              <el-row :gutter="20">
                                <el-col :span="24" :md="8">
                                  <img
                                    :src="getHouseImage(house.image)"
                                    :alt="house.title"
                                    class="house-image"
                                    loading="lazy"
                                    decoding="async"
                                    @error="handleImageError"
                                  />
                                </el-col>
                                <el-col :span="24" :md="16">
                                  <div class="house-info">
                                    <h3>{{ house.title }}</h3>
                                    <p class="price">{{ house.price }}元/月</p>
                                    <p class="location">{{ house.location }}</p>
                                    <p class="description">
                                      {{ house.description }}
                                    </p>
                                    <el-button size="small" :disabled="!hasCoordinates(house)" @click.stop="locateOnMap(house)">在地图定位</el-button>
                                    <div class="tags">
                                      <el-tag
                                        v-for="tag in house.tags"
                                        :key="tag"
                                        size="small"
                                        style="margin-right: 5px"
                                      >
                                        {{ tag }}
                                      </el-tag>
                                    </div>
                                  </div>
                                </el-col>
                              </el-row>
                            </el-card>
                          </el-col>
                        </el-row>
                      </template>
                      <template v-else>
                        <div class="empty-wrapper">
                          <el-empty
                            description="目前还没有符合条件的房源，试试放宽筛选条件吧～"
                          />
                          <div class="empty-actions">
                            <el-button
                              type="primary"
                              @click="resetFilters"
                              style="margin-right: 8px"
                            >
                              重置筛选
                            </el-button>
                            <el-button @click="goToMap"> 去地图找房 </el-button>
                          </div>
                        </div>
                      </template>
                    </div>
                  </el-card>
                </div>

                <!-- 底部分页器 -->
                <div class="pagination-bottom">
                  <el-pagination
                    layout="total, prev, pager, next, jumper"
                    :total="pagination.total"
                    :page-size="pagination.pageSize"
                    :current-page="pagination.currentPage"
                    :page-sizes="[10, 20, 30]"
                    @current-change="handlePageChange"
                    @size-change="handleSizeChange"
                    background
                    :pager-count="5"
                    small
                    :locale="paginationLocale"
                  >
                  </el-pagination>
                </div>
              </div>
            </el-col>
          </el-row>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed, watch, onBeforeUnmount } from "vue";
import { useRouter, useRoute } from "vue-router";
import { getHouseList, getUserFavorites } from "../services/api";
import { ElMessage } from 'element-plus';
import { HOUSE_TYPES, emptyHouseFilters, type HouseQuery } from '../types/houses';
import { cloneHouseFilters, houseFiltersToQuery, houseQueryFromUrl, validateHouseFilters, validMapBounds } from '../utils/houseFilters';
import { mapMetaFromUrl, mapViewToQuery } from '../utils/mapState';
import userStore from "../stores/userStore";
import HeaderUserMenu from "../components/HeaderUserMenu.vue";

const router = useRouter();
const route = useRoute();

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn());

// 重置筛选条件
const resetFilters = () => {
  const next: HouseQuery = { ...emptyHouseFilters(), page: 1, pageSize: pagination.pageSize, sort: 'latest' };
  syncDraft(next);
  navigate(next);
};

// 跳转到地图找房
const goToMap = () => {
  router.push({ path: '/map', query: { ...houseFiltersToQuery(applied.value), ...mapMetaFromUrl(route.query) } });
};
function hasCoordinates(house: { lng: number | null; lat: number | null }) { return house.lng != null && house.lat != null && Number.isFinite(house.lng) && Number.isFinite(house.lat) && Math.abs(house.lng) <= 180 && Math.abs(house.lat) <= 85; }
function locateOnMap(house: { id: number; lng: number; lat: number }) { router.push({ path: '/map', query: { ...houseFiltersToQuery(applied.value), ...mapViewToQuery({ lng: house.lng, lat: house.lat, zoom: 16 }), selected: String(house.id) } }); }
function clearBounds() { navigate({ ...applied.value, bounds: undefined, page: 1 }); }

const goAssistant = () => {
  const invalid = validateHouseFilters(filters);
  if (invalid) { ElMessage.error(invalid); return; }
  router.push({ path: '/ai-assistant', query: houseFiltersToQuery(filters) });
};

// 筛选条件
const filters = reactive<HouseQuery>({ ...emptyHouseFilters(), page: 1, pageSize: 10, sort: 'latest' });
const applied = ref<HouseQuery>(houseQueryFromUrl(route.query));
const loading = ref(false);
const errorMessage = ref('');
let controller: AbortController | null = null;
let requestVersion = 0;

function syncDraft(query: HouseQuery) {
  filters.city = query.city;
  filters.location = query.location;
  filters.minPrice = query.minPrice;
  filters.maxPrice = query.maxPrice;
  filters.houseTypes = [...query.houseTypes];
  filters.sort = query.sort;
}

function navigate(query: HouseQuery) {
  const target = { path: '/houses', query: { ...houseFiltersToQuery(query), ...(query.bounds ? mapMetaFromUrl(route.query) : {}) } };
  if (router.resolve(target).fullPath === route.fullPath) { applied.value = query; void fetchHouseList(); }
  else void router.push(target);
}

// 分页器本地化配置
const paginationLocale = {
  total: "共 {total} 条",
  goto: "跳转到",
  pagesize: "条/页",
  pageClassifier: "页",
  prev: "上一页",
  next: "下一页",
  jumper: "跳转",
};

// 应用筛选
const applyFilters = async () => {
  const invalid = validateHouseFilters(filters);
  if (invalid) { ElMessage.error(invalid); return; }
  navigate({ ...cloneHouseFilters(filters), bounds: applied.value.bounds, sort: filters.sort, page: 1, pageSize: pagination.pageSize });
};

// 页面切换
const handlePageChange = (page: number) => {
  navigate({ ...applied.value, page });
};

// 页面大小切换
const handleSizeChange = (size: number) => {
  navigate({ ...applied.value, pageSize: size, page: 1 });
};

// 查看房源详情
const viewHouseDetail = (id: number) => {
  // 跳转到房源详情页
  router.push(`/house/${id}`);
};

// 处理图片加载错误
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement;
  // 不再使用默认图片，保持原图片路径
  console.log("图片加载失败:", target.src);
};

// 获取房源图片
const getHouseImage = (imagePath: string) => {
  return imagePath;
};

// 房源列表数据
const houseList = reactive<any[]>([]);

// 当前用户已收藏的房源ID列表
const favoriteIds = ref<number[]>([]);

const isHouseFavorited = (houseId: number) => {
  return favoriteIds.value.includes(houseId);
};

const refreshFavoriteIds = async () => {
  if (!isLoggedIn.value) {
    favoriteIds.value = [];
    return;
  }
  const res = await getUserFavorites();
  if (res.success && Array.isArray(res.data)) {
    favoriteIds.value = res.data.map((h: any) => h.id);
  }
};

// 分页数据
const pagination = reactive({
  currentPage: 1,
  pageSize: 10,
  total: 0,
});

// 获取房源列表
const fetchHouseList = async () => {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const version = ++requestVersion;
  loading.value = true;
  errorMessage.value = '';
  try {
    if (!validMapBounds(applied.value.bounds)) throw new Error('URL 视野边界无效，请取消视野限制或重置条件。');
    const res = await getHouseList(applied.value, signal);
    if (version !== requestVersion) return;
    if (!res.success) throw new Error(res.message || '加载房源失败');
    houseList.splice(0, houseList.length, ...res.data.list);
    pagination.total = Number(res.data.total);
  } catch (error) {
    if (signal.aborted || version !== requestVersion) return;
    houseList.splice(0, houseList.length);
    pagination.total = 0;
    errorMessage.value = error instanceof Error ? error.message : '加载失败，请重试。';
  } finally { if (version === requestVersion) loading.value = false; }
};

watch(() => route.query, query => {
  if (route.path !== '/houses') return;
  applied.value = houseQueryFromUrl(query);
  syncDraft(applied.value);
  pagination.currentPage = applied.value.page;
  pagination.pageSize = applied.value.pageSize;
  void fetchHouseList();
}, { immediate: true });
onMounted(() => { void refreshFavoriteIds().catch(() => {}); });
watch(isLoggedIn, () => { void refreshFavoriteIds().catch(() => {}); });
onBeforeUnmount(() => { ++requestVersion; controller?.abort(); });
</script>

<style scoped>
.full-height {
  height: 100vh;
}

.main-content {
  height: calc(100vh - 60px); /* 减去 header 的高度 */
  overflow: hidden; /* 去掉与列表区重复的外层竖向滚动条 */
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.houses-inner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.houses-row {
  flex: 1;
  min-height: 0;
}

.filter-sidebar {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.house-list-container {
  height: 100%;
  min-height: 0;
  display: flex;
}

.house-list-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.pagination-top,
.pagination-bottom {
  padding: 10px 0;
  padding-left: 30px;
  background-color: white;
  position: sticky;
  z-index: 10;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.pagination-top {
  top: 0;
}

.pagination-bottom {
  bottom: 0;
  margin-top: auto;
  border-top: 1px solid #eee;
}

.house-list-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 避免 el-card 撑满高度后再叠一层滚动，只保留列表区域滚动 */
.house-list-card {
  height: auto;
  max-height: none;
}

.house-list-card :deep(.el-card__body) {
  overflow: visible;
}

.house-list {
  padding: 10px 0;
}
.list-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; font-size: 12px; color: #606266; }

.empty-wrapper {
  padding: 40px 0;
  text-align: center;
}

.empty-actions {
  margin-top: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #409eff;
  color: white;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-card {
  margin-bottom: 20px;
}

.filter-section {
  margin-bottom: 15px;
}

.filter-section h4 {
  margin-bottom: 10px;
}

.price-label { display: block; font-size: 13px; color: #606266; margin: 10px 0 6px; }
.filter-hint { color: #606266; font-size: 12px; line-height: 1.7; }

.house-item {
  margin-bottom: 20px;
}

.house-card {
  position: relative;
  cursor: pointer;
  transition: all 0.3s ease;
}

.house-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.house-image {
  width: 100%;
  height: 150px;
  object-fit: cover;
  border-radius: 4px;
}

.house-info h3 {
  margin-top: 0;
  color: #333;
}

.price {
  font-size: 18px;
  color: #ff6600;
  font-weight: bold;
}

.location {
  color: #666;
  margin: 5px 0;
}

.description {
  color: #999;
  margin: 5px 0;
}

.favorite-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }

  .house-image {
    height: 200px;
    object-fit: cover;
  }

  .main-content {
    height: auto;
    overflow: visible;
    display: block;
    min-height: 0;
  }

  .filter-sidebar,
  .house-list-container {
    height: auto;
  }

  .house-list-content {
    height: auto;
  }

  .header {
    flex-direction: column;
    padding: 10px;
  }

  .nav {
    margin-top: 10px;
  }

  .nav button {
    margin: 0 5px;
  }
}
</style>
