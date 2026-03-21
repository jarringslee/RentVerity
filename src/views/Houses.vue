<template>
  <div class="houses">
    <el-container class="full-height">
      <el-header class="header">
        <h1>房源列表</h1>
        <div class="nav">
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
          <el-dropdown v-if="isLoggedIn" @command="handleUserCommand">
            <el-button type="primary">
              {{ currentUser?.username
              }}<el-icon class="el-icon--right"><arrow-down /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人信息</el-dropdown-item>
                <el-dropdown-item command="favorites"
                  >我的收藏</el-dropdown-item
                >
                <el-dropdown-item divided command="logout"
                  >退出登录</el-dropdown-item
                >
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
                    v-model="filters.location"
                    placeholder="请输入位置"
                  ></el-input>
                </div>

                <div class="filter-section">
                  <h4>价格范围</h4>
                  <el-select
                    v-model="filters.price"
                    placeholder="请选择价格范围"
                    style="width: 100%"
                  >
                    <el-option label="不限" value=""></el-option>
                    <el-option label="1000元以下" value="0-1000"></el-option>
                    <el-option
                      label="1000-2000元"
                      value="1000-2000"
                    ></el-option>
                    <el-option
                      label="2000-3000元"
                      value="2000-3000"
                    ></el-option>
                    <el-option
                      label="3000-4000元"
                      value="3000-4000"
                    ></el-option>
                    <el-option label="4000元以上" value="4000-0"></el-option>
                  </el-select>
                </div>

                <div class="filter-section">
                  <h4>房型</h4>
                  <el-checkbox-group v-model="filters.houseTypes">
                    <el-checkbox label="一居室"></el-checkbox>
                    <el-checkbox label="两居室"></el-checkbox>
                    <el-checkbox label="三居室"></el-checkbox>
                    <el-checkbox label="合租"></el-checkbox>
                  </el-checkbox-group>
                </div>

                <div class="filter-section">
                  <h4>风险等级</h4>
                  <el-checkbox-group v-model="filters.riskLevels">
                    <el-checkbox label="low">低风险</el-checkbox>
                    <el-checkbox label="medium">中风险</el-checkbox>
                    <el-checkbox label="high">高风险</el-checkbox>
                  </el-checkbox-group>
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
                  <el-card class="house-list-card">
                    <div class="house-list">
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
                                    <div
                                      class="risk-tags"
                                      style="margin-top: 10px"
                                    >
                                      <el-tag
                                        :type="getRiskTagType(house.riskLevel)"
                                        size="small"
                                        effect="dark"
                                      >
                                        {{
                                          getRiskTagName(house.riskLevel)
                                        }}风险
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
import { reactive, ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { getHouseList, searchHouses, getUserFavorites } from "../services/api";
import userStore from "../stores/userStore";
import { ArrowDown } from "@element-plus/icons-vue";

const router = useRouter();

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn());

// 获取当前用户信息
const currentUser = computed(() => userStore.currentUser.value);

// 处理用户命令
const handleUserCommand = (command: string) => {
  switch (command) {
    case "profile":
      // 跳转到个人资料页面
      router.push("/profile");
      break;
    case "favorites":
      // 跳转到收藏房源页面
      router.push("/favorites");
      break;
    case "logout":
      // 退出登录
      userStore.clearCurrentUser();
      router.push("/");
      break;
  }
};

// 搜索关键词
const searchKeyword = computed({
  get: () => filters.location,
  set: (value) => {
    filters.location = value;
  },
});

// 清除搜索
const clearSearch = () => {
  filters.location = "";
  applyFilters();
};

// 执行搜索
const performSearch = () => {
  applyFilters();
};

// 重置筛选条件
const resetFilters = () => {
  filters.location = "";
  filters.price = "";
  filters.houseTypes = [];
  filters.riskLevels = [];
  pagination.currentPage = 1;
  fetchHouseList();
};

// 跳转到地图找房
const goToMap = () => {
  router.push("/map");
};

// 筛选条件
const filters = reactive({
  location: "",
  price: "",
  houseTypes: [] as string[],
  riskLevels: [] as string[],
});

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
  const res = await searchHouses(filters);
  if (res.success) {
    houseList.splice(0, houseList.length, ...res.data.list);
    pagination.total = res.data.total;
    pagination.currentPage = 1; // 重置到第一页
  }
};

// 页面切换
const handlePageChange = (page: number) => {
  pagination.currentPage = page;
  fetchHouseList();
};

// 页面大小切换
const handleSizeChange = (size: number) => {
  pagination.pageSize = size;
  pagination.currentPage = 1;
  fetchHouseList();
};

// 查看房源详情
const viewHouseDetail = (id: number) => {
  // 跳转到房源详情页
  router.push(`/house/${id}`);
};

// 获取风险标签类型
const getRiskTagType = (riskLevel: string) => {
  switch (riskLevel) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "success";
    default:
      return "info";
  }
};

// 获取风险标签名称
const getRiskTagName = (riskLevel: string) => {
  switch (riskLevel) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "未知";
  }
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
  const res = await getHouseList({
    page: pagination.currentPage,
    pageSize: pagination.pageSize,
  });

  if (res.success) {
    // 为每个房源设置正确的图片路径
    const processedList = res.data.list.map((house: any) => {
      return {
        ...house,
        image: getHouseImage(house.image),
      };
    });
    houseList.splice(0, houseList.length, ...processedList);
    pagination.total = res.data.total;
  }
};

onMounted(async () => {
  await fetchHouseList();
  await refreshFavoriteIds();
});
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

.filter-card {
  margin-bottom: 20px;
}

.filter-section {
  margin-bottom: 15px;
}

.filter-section h4 {
  margin-bottom: 10px;
}

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