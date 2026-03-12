<template>
  <div class="house-compare">
    <el-container class="full-height">
      <el-header class="header">
        <h1>房源对比</h1>
        <div>
          <el-button @click="$router.go(-1)">返回</el-button>
        </div>
      </el-header>
      
      <el-main v-loading="loading">
        <el-alert
          v-if="!isLoggedIn"
          title="请先登录以使用房源对比功能"
          type="warning"
          show-icon
          closable
          style="margin-bottom: 20px;"
        >
          <template #default>
            <p>房源对比功能仅对登录用户开放，请先登录。</p>
            <el-button type="primary" @click="$router.push('/login')" style="margin-top: 10px;">前往登录</el-button>
          </template>
        </el-alert>
        
        <el-card v-if="isLoggedIn">
          <h2>选择要对比的房源</h2>
          <el-form :model="compareForm" label-width="120px">
            <el-row :gutter="20">
              <el-col :span="24" :md="12">
                <el-form-item label="房源1">
                  <el-select 
                    v-model="compareForm.house1Id" 
                    placeholder="请选择第一个房源" 
                    style="width: 100%"
                    @change="loadHouseDetail(1, compareForm.house1Id)"
                  >
                    <el-option
                      v-for="house in favoriteHouses"
                      :key="house.id"
                      :label="house.title"
                      :value="house.id">
                    </el-option>
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="24" :md="12">
                <el-form-item label="房源2">
                  <el-select 
                    v-model="compareForm.house2Id" 
                    placeholder="请选择第二个房源" 
                    style="width: 100%"
                    @change="loadHouseDetail(2, compareForm.house2Id)"
                  >
                    <el-option
                      v-for="house in favoriteHouses"
                      :key="house.id"
                      :label="house.title"
                      :value="house.id">
                    </el-option>
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            
            <el-form-item>
              <el-button 
                type="primary" 
                @click="compareHouses" 
                :disabled="!compareForm.house1Id || !compareForm.house2Id">
                开始对比
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
        
        <!-- 对比结果 -->
        <el-card v-if="comparisonResult.length > 0" style="margin-top: 20px;">
          <h2>对比结果</h2>
          <el-table :data="comparisonResult" style="width: 100%" stripe>
            <el-table-column prop="attribute" label="属性" width="180"></el-table-column>
            <el-table-column prop="house1" label="房源1" width="200"></el-table-column>
            <el-table-column prop="house2" label="房源2" width="200"></el-table-column>
            <el-table-column prop="better" label="更优">
              <template #default="scope">
                <el-tag v-if="scope.row.better === 1" type="success">房源1更优</el-tag>
                <el-tag v-else-if="scope.row.better === 2" type="success">房源2更优</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { getHouseDetail, getUserFavorites } from '../services/api'
import userStore from '../stores/userStore'

const router = useRouter()
const loading = ref(false)

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn())

// 获取当前用户信息
const currentUser = computed(() => userStore.currentUser.value)

// 表单数据
const compareForm = reactive({
  house1Id: null as number | null,
  house2Id: null as number | null
})

// 收藏的房源列表
const favoriteHouses = ref<any[]>([])

// 房源详情
const house1 = ref<any>({})
const house2 = ref<any>({})

// 对比结果
const comparisonResult = ref<any[]>([])

// 获取收藏房源列表
const fetchFavoriteHouses = async () => {
  if (!currentUser.value) return
  
  const res = await getUserFavorites(currentUser.value.id)
  if (res.success) {
    favoriteHouses.value = res.data
  }
}

// 加载房源详情
const loadHouseDetail = async (index: number, houseId: number | null) => {
  if (!houseId) return
  
  loading.value = true
  try {
    const res = await getHouseDetail(houseId)
    if (res.success) {
      if (index === 1) {
        house1.value = res.data
      } else {
        house2.value = res.data
      }
    }
  } finally {
    loading.value = false
  }
}

// 对比房源
const compareHouses = () => {
  if (!house1.value || !house2.value) return
  
  comparisonResult.value = [
    {
      attribute: '标题',
      house1: house1.value.title,
      house2: house2.value.title,
      better: 0
    },
    {
      attribute: '价格',
      house1: `${house1.value.price}元/月`,
      house2: `${house2.value.price}元/月`,
      better: house1.value.price < house2.value.price ? 1 : 
              house1.value.price > house2.value.price ? 2 : 0
    },
    {
      attribute: '面积',
      house1: `${house1.value.area}㎡`,
      house2: `${house2.value.area}㎡`,
      better: house1.value.area > house2.value.area ? 1 : 
              house1.value.area < house2.value.area ? 2 : 0
    },
    {
      attribute: '风险等级',
      house1: getRiskTagName(house1.value.riskLevel),
      house2: getRiskTagName(house2.value.riskLevel),
      better: house1.value.riskLevel === 'low' && house2.value.riskLevel !== 'low' ? 1 :
              house1.value.riskLevel === 'high' && house2.value.riskLevel !== 'high' ? 2 :
              house1.value.riskLevel === 'medium' && house2.value.riskLevel === 'high' ? 1 :
              house1.value.riskLevel === 'medium' && house2.value.riskLevel === 'low' ? 2 : 0
    },
    {
      attribute: '朝向',
      house1: house1.value.orientation,
      house2: house2.value.orientation,
      better: 0 // 朝向无法简单比较
    },
    {
      attribute: '楼层',
      house1: house1.value.floor,
      house2: house2.value.floor,
      better: 0 // 楼层无法简单比较
    },
    {
      attribute: '标签',
      house1: house1.value.tags.join(', '),
      house2: house2.value.tags.join(', '),
      better: 0 // 标签无法简单比较
    }
  ]
}

// 获取风险标签名称
const getRiskTagName = (riskLevel: string) => {
  switch (riskLevel) {
    case 'high': return '高风险'
    case 'medium': return '中风险'
    case 'low': return '低风险'
    default: return '未知'
  }
}

onMounted(() => {
  if (isLoggedIn.value) {
    fetchFavoriteHouses()
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

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }
}
</style>