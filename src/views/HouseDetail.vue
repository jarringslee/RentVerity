<template>
  <div class="house-detail">
    <el-container class="full-height">
      <el-header class="header">
        <h1>房源详情</h1>
        <div class="nav">
          <HeaderUserMenu v-if="isLoggedIn" />
          <el-button @click="goBack">返回</el-button>
          <el-button 
            v-if="isLoggedIn && houseDetail.id"
            :type="isFavorited ? 'danger' : 'primary'" 
            @click="toggleFavorite"
            :loading="favoriteLoading">
            {{ isFavorited ? '取消收藏' : '收藏房源' }}
          </el-button>
          <el-button 
            v-else-if="!isLoggedIn"
            type="primary" 
            @click="$router.push('/login')">
            登录后收藏
          </el-button>
          <el-button type="primary" :disabled="!houseDetail.id" @click="contactLandlord">联系房东</el-button>
        </div>
      </el-header>
      
      <el-main v-loading="loading">
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon />
        <el-row v-else-if="houseDetail.id" :gutter="20">
          <el-col :span="24" :md="16">
            <el-card>
              <div class="house-basic-info">
                <h2>{{ houseDetail.title }}</h2>
                <div class="price">{{ houseDetail.price }}元/月</div>
                <div class="location">{{ houseDetail.location }}</div>
                
                <div class="house-images">
                  <el-carousel height="400px">
                    <el-carousel-item>
                      <img :src="houseDetail.image" alt="房源图片" class="carousel-image" @error="handleImageError">
                    </el-carousel-item>
                  </el-carousel>
                </div>
                
                <div class="tags">
                  <el-tag v-for="tag in houseDetail.tags" :key="tag" size="small" style="margin-right: 10px;">
                    {{ tag }}
                  </el-tag>
                </div>

                <el-alert title="房源信息由发布者填写，平台未进行风险评分或资质认证。" type="info" :closable="false" style="margin: 12px 0" />
                
                <div class="house-description">
                  <h3>房源描述</h3>
                  <p>{{ houseDetail.description }}</p>
                </div>
              </div>
            </el-card>
            
            <el-card style="margin-top: 20px;">
              <div class="house-detail-info">
                <h3>房屋信息</h3>
                <el-descriptions :column="1" border>
                  <el-descriptions-item label="面积">{{ houseDetail.area }}平方米</el-descriptions-item>
                  <el-descriptions-item label="楼层">{{ houseDetail.floor }}</el-descriptions-item>
                  <el-descriptions-item label="朝向">{{ houseDetail.orientation }}</el-descriptions-item>
                </el-descriptions>
              </div>
            </el-card>
          </el-col>
          
          <el-col :span="24" :md="8">
            <el-card class="landlord-card">
              <div class="landlord-info">
                <el-avatar :src="houseDetail.landlord?.avatar" :size="80"></el-avatar>
                <h3>{{ houseDetail.landlord?.name }}</h3>
                <p>房东</p>
                <el-button type="primary" @click="contactLandlord">立即联系</el-button>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getHouseDetail, isFavorite, addFavorite, removeFavorite } from '../services/api'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()

// 加载状态
const loading = ref(false)
const favoriteLoading = ref(false)
const errorMessage = ref('')
let controller: AbortController | null = null
let requestVersion = 0

// 房源详情
const houseDetail = ref<any>({})

// 是否已收藏
const isFavorited = ref(false)

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn())

// 获取当前用户信息
const currentUser = computed(() => userStore.currentUser.value)

// 获取房源详情
const fetchHouseDetail = async (id: number) => {
  controller?.abort()
  controller = new AbortController()
  const version = ++requestVersion, signal = controller.signal
  loading.value = true
  houseDetail.value = {}
  isFavorited.value = false
  errorMessage.value = ''
  try {
    const res = await getHouseDetail(id, signal)
    if (version !== requestVersion) return
    if (res.success) {
      houseDetail.value = res.data
      // 检查是否已收藏
      void checkFavoriteStatus(id)
    } else errorMessage.value = res.message || '房源不存在或加载失败'
  } catch (error) {
    if (!signal.aborted && version === requestVersion) errorMessage.value = error instanceof Error ? error.message : '房源加载失败'
  } finally { if (version === requestVersion) loading.value = false }
}

// 检查收藏状态
const checkFavoriteStatus = async (houseId: number) => {
  if (!currentUser.value) return
  
  const owner = currentUser.value.id
  try {
    const res = await isFavorite(houseId)
    if (res.success && houseDetail.value.id === houseId && currentUser.value?.id === owner) isFavorited.value = res.data
  } catch { ElMessage.warning('收藏状态加载失败，可重试') }
}

// 切换收藏状态
const toggleFavorite = async () => {
  if (!currentUser.value) {
    router.push('/login')
    return
  }
  
  if (favoriteLoading.value || !houseDetail.value.id) return
  favoriteLoading.value = true
  try {
    if (isFavorited.value) {
      // 取消收藏
      const res = await removeFavorite(houseDetail.value.id)
      if (res.success) {
        isFavorited.value = false
      } else ElMessage.error(res.message || '取消收藏失败')
    } else {
      // 添加收藏
      const res = await addFavorite(houseDetail.value.id)
      if (res.success) {
        isFavorited.value = true
      } else ElMessage.error(res.message || '收藏失败')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '收藏操作失败')
  } finally {
    favoriteLoading.value = false
  }
}


// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 联系房东（与发布者用户在线沟通，需房源有 owner_user_id）
const contactLandlord = () => {
  if (!currentUser.value) {
    router.push('/login')
    return
  }

  const ownerId = houseDetail.value.ownerUserId ?? houseDetail.value.landlord?.id
  if (!ownerId) {
    ElMessage.warning('该房源未绑定发布者账号，暂无法在线沟通')
    return
  }
  if (Number(ownerId) === Number(currentUser.value.id)) {
    ElMessage.info('这是您自己发布的房源')
    return
  }

  router.push({
    path: '/chat',
    query: {
      houseId: String(houseDetail.value.id),
      peerId: String(ownerId)
    }
  })
}

// 处理图片加载错误
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  if (!target.dataset.fallback) { target.dataset.fallback = 'true'; target.src = '/images/houses/house-1.jpg' }
}

watch(() => route.params.id, () => {
  const houseId = Number(route.params.id)
  if (Number.isSafeInteger(houseId) && houseId > 0) {
    fetchHouseDetail(houseId)
  } else { controller?.abort(); ++requestVersion; houseDetail.value = {}; loading.value = false; errorMessage.value = '无效的房源 ID' }
}, { immediate: true })
watch(() => currentUser.value?.id, () => { isFavorited.value = false; if (houseDetail.value.id) void checkFavoriteStatus(houseDetail.value.id) })
onBeforeUnmount(() => { ++requestVersion; controller?.abort() })
</script>

<style scoped>
.full-height {
  height: 100vh;
}

.header {
  height: auto;
  min-height: 60px;
  padding: 12px 20px;
  gap: 12px;
  flex-wrap: wrap;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #409eff;
  color: white;
}
.header h1 { font-size: 24px; line-height: 1.3; margin: 0; }

.nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.carousel-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.price {
  font-size: 24px;
  color: #ff6600;
  font-weight: bold;
  margin: 10px 0;
}

.location {
  color: #666;
  margin-bottom: 20px;
}

.house-description {
  margin-top: 20px;
}

.house-description h3 {
  margin-top: 0;
}

.tags {
  margin: 20px 0;
}

.landlord-card {
  text-align: center;
}

.landlord-info h3 {
  margin: 10px 0 5px 0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }
}
</style>
