<template>
  <div class="favorites">
    <el-container class="full-height">
      <el-header class="header">
        <h1>我的收藏</h1>
        <div class="nav">
          <el-button @click="$router.go(-1)">返回</el-button>
          <HeaderUserMenu v-if="isLoggedIn" />
        </div>
      </el-header>
      
      <el-main>
        <el-card v-if="favorites.length === 0">
          <el-empty description="暂无收藏房源" />
        </el-card>
        
        <el-row :gutter="20" v-else>
          <el-col :span="24" v-for="house in favorites" :key="house.id" class="house-item">
            <el-card class="house-card">
              <el-row :gutter="20">
                <el-col :span="24" :md="8">
                  <img :src="house.image" :alt="house.title" class="house-image" loading="lazy" decoding="async" @error="handleImageError">
                </el-col>
                <el-col :span="24" :md="16">
                  <div class="house-info">
                    <h3>{{ house.title }}</h3>
                    <p class="price">{{ house.price }}元/月</p>
                    <p class="location">{{ house.location }}</p>
                    <p class="description">{{ house.description }}</p>
                    <div class="tags">
                      <el-tag v-for="tag in house.tags" :key="tag" size="small" style="margin-right: 5px;">
                        {{ tag }}
                      </el-tag>
                    </div>
                    <div class="actions" style="margin-top: 15px;">
                      <el-button type="primary" @click="viewHouseDetail(house.id)">查看详情</el-button>
                      <el-button @click="removeFromFavorites(house.id)">取消收藏</el-button>
                    </div>
                  </div>
                </el-col>
              </el-row>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { getUserFavorites, removeFavorite } from '../services/api'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const router = useRouter()
const isLoggedIn = computed(() => userStore.isLoggedIn())
const favorites = ref<any[]>([])

const viewHouseDetail = (houseId: number) => {
  router.push({ name: 'HouseDetail', params: { id: String(houseId) } })
}

// 处理图片加载错误
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  // 不再使用默认图片，保持原图片路径
  console.log('图片加载失败:', target.src)
}

// 移除收藏
const removeFromFavorites = async (houseId: number) => {
  if (!userStore.currentUser.value) return
  
  const res = await removeFavorite(houseId)
  if (res.success) {
    favorites.value = favorites.value.filter(house => house.id !== houseId)
  } else {
    alert('取消收藏失败')
  }
}

// 获取收藏列表
const fetchFavorites = async () => {
  if (!userStore.currentUser.value) {
    router.push('/login')
    return
  }
  
  const res = await getUserFavorites()
  if (res.success) {
    favorites.value = res.data
  }
}

onMounted(() => {
  fetchFavorites()
})
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

.house-item {
  margin-bottom: 20px;
}

.house-card {
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

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }
  
  .house-image {
    height: 200px;
    object-fit: cover;
  }
}
</style>
