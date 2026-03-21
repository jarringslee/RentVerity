<template>
  <div class="house-detail">
    <el-container class="full-height">
      <el-header class="header">
        <h1>房源详情</h1>
        <div class="nav">
          <HeaderUserMenu v-if="isLoggedIn" />
          <el-button @click="goBack">返回</el-button>
          <el-button 
            v-if="isLoggedIn"
            :type="isFavorited ? 'danger' : 'primary'" 
            @click="toggleFavorite"
            :loading="favoriteLoading">
            {{ isFavorited ? '取消收藏' : '收藏房源' }}
          </el-button>
          <el-button 
            v-else 
            type="primary" 
            @click="$router.push('/login')">
            登录后收藏
          </el-button>
          <el-button type="primary" @click="contactLandlord">联系房东</el-button>
        </div>
      </el-header>
      
      <el-main v-loading="loading">
        <el-row :gutter="20">
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

                <div class="risk-tags" style="margin: 10px 0;">
                  <el-tag 
                    :type="getRiskTagType(houseDetail.riskLevel)" 
                    size="small" 
                    effect="dark">
                    {{ getRiskTagName(houseDetail.riskLevel) }}风险
                  </el-tag>
                </div>
                
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
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getHouseDetail, isFavorite, addFavorite, removeFavorite } from '../services/api'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const route = useRoute()
const router = useRouter()

// 加载状态
const loading = ref(false)
const favoriteLoading = ref(false)

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
  loading.value = true
  try {
    const res = await getHouseDetail(id)
    if (res.success) {
      houseDetail.value = res.data
      // 检查是否已收藏
      checkFavoriteStatus(id)
    }
  } finally {
    loading.value = false
  }
}

// 检查收藏状态
const checkFavoriteStatus = async (houseId: number) => {
  if (!currentUser.value) return
  
  const res = await isFavorite(houseId)
  if (res.success) {
    isFavorited.value = res.data
  }
}

// 切换收藏状态
const toggleFavorite = async () => {
  if (!currentUser.value) {
    router.push('/login')
    return
  }
  
  favoriteLoading.value = true
  try {
    if (isFavorited.value) {
      // 取消收藏
      const res = await removeFavorite(houseDetail.value.id)
      if (res.success) {
        isFavorited.value = false
      }
    } else {
      // 添加收藏
      const res = await addFavorite(houseDetail.value.id)
      if (res.success) {
        isFavorited.value = true
      }
    }
  } finally {
    favoriteLoading.value = false
  }
}

// 获取风险标签类型
const getRiskTagType = (riskLevel: string) => {
  switch (riskLevel) {
    case 'high': return 'danger'
    case 'medium': return 'warning'
    case 'low': return 'success'
    default: return 'info'
  }
}

// 获取风险标签名称
const getRiskTagName = (riskLevel: string) => {
  switch (riskLevel) {
    case 'high': return '高'
    case 'medium': return '中'
    case 'low': return '低'
    default: return '未知'
  }
}

// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 联系房东
const contactLandlord = () => {
  if (!currentUser.value) {
    router.push('/login')
    return
  }
  
  if (houseDetail.value.landlord) {
    router.push(`/chat/${houseDetail.value.landlord.id}`)
  }
}

// 处理图片加载错误
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.src = '/images/houses/default-house.jpg' // 设置默认图片
}

onMounted(() => {
  const houseId = Number(route.params.id)
  if (houseId) {
    fetchHouseDetail(houseId)
  }
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