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
        <el-row :gutter="20" style="height: 100%;">
          <!-- 筛选栏 -->
          <el-col :span="24" :md="6">
            <el-card class="filter-card">
              <div class="search-box">
                <el-input 
                  placeholder="请输入区域、地标或地铁站" 
                  v-model="searchKeyword">
                  <template #append>
                    <el-button :icon="Search" @click="searchOnMap" />
                  </template>
                </el-input>
              </div>
              
              <div class="filter-section">
                <h4>租金范围</h4>
                <el-slider
                  v-model="priceRange"
                  range
                  :min="0"
                  :max="10000"
                  :step="500"
                  :marks="{ 0: '0元', 5000: '5000元', 10000: '10000元' }">
                </el-slider>
                <p>当前选择：{{ priceRange[0] }} - {{ priceRange[1] }} 元/月</p>
              </div>
              
              <div class="filter-section">
                <h4>房型</h4>
                <el-checkbox-group v-model="houseTypes">
                  <el-checkbox label="一居室"></el-checkbox>
                  <el-checkbox label="两居室"></el-checkbox>
                  <el-checkbox label="三居室"></el-checkbox>
                  <el-checkbox label="合租"></el-checkbox>
                </el-checkbox-group>
              </div>
              
              <el-button type="primary" @click="applyFilters" style="width: 100%">应用筛选</el-button>
            </el-card>
          </el-col>
          
          <!-- 地图区域 -->
          <el-col :span="24" :md="18">
            <el-card class="map-container">
              <div id="map-container" class="map-wrapper"></div>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { getHouseList } from '../services/api'
import { Search } from '@element-plus/icons-vue'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const router = useRouter()
const isLoggedIn = computed(() => userStore.isLoggedIn())

// 搜索关键词
const searchKeyword = ref('西安')

// 价格范围
const priceRange = ref([0, 5000])

// 房型筛选
const houseTypes = ref([] as string[])

// 百度地图实例
let map: any = null

// 初始化地图
const initMap = () => {
  // 确保百度地图API已经加载
  if (typeof BMapGL !== 'undefined') {
    // 创建地图实例
    map = new BMapGL.Map("map-container")
    
    // 设置中心点坐标和缩放级别
    const point = new BMapGL.Point(108.948024, 34.263161) // 西安中心点
    map.centerAndZoom(point, 12)
    
    // 启用滚轮缩放
    map.enableScrollWheelZoom(true)
    
    // 添加地图控件
    map.addControl(new BMapGL.NavigationControl())
    map.addControl(new BMapGL.ScaleControl())
    
    // 添加一些示例标记点
    addSamplePoints()
  } else {
    console.error('百度地图API加载失败')
    setTimeout(initMap, 1000) // 如果API还没加载完成，等待1秒后重试
  }
}

// 添加示例标记点
const addSamplePoints = () => {
  if (!map) return
  
  // 清除现有标记
  map.clearOverlays()
  
  // 示例房源点
  const points = [
    { lng: 108.948024, lat: 34.263161, title: '高新区房源', price: '2800元/月' },
    { lng: 108.960, lat: 34.220, title: '曲江新区房源', price: '4800元/月' },
    { lng: 108.980, lat: 34.300, title: '浐灞生态区房源', price: '3500元/月' },
    { lng: 108.940, lat: 34.230, title: '雁塔区房源', price: '3200元/月' }
  ]
  
  points.forEach(p => {
    const point = new BMapGL.Point(p.lng, p.lat)
    const marker = new BMapGL.Marker(point)
    map.addOverlay(marker)
    
    // 添加信息窗口
    const opts = {
      width: 200,
      height: 80,
      title: p.title
    }
    const infoWindow = new BMapGL.InfoWindow(`价格: ${p.price}<br>精装修，交通便利`, opts)
    marker.addEventListener('click', function() {
      map.openInfoWindow(infoWindow, point)
    })
  })
}

// 搜索地图
const searchOnMap = () => {
  if (!map || !searchKeyword.value) return
  
  // 创建地址解析器实例
  const myGeo = new BMapGL.Geocoder()
  
  // 将地址解析结果显示在地图上
  myGeo.getPoint(searchKeyword.value, function(point: any) {
    if (point) {
      map.centerAndZoom(point, 14)
      map.clearOverlays()
      const marker = new BMapGL.Marker(point)
      map.addOverlay(marker)
      
      // 添加信息窗口
      const infoWindow = new BMapGL.InfoWindow(`搜索位置: ${searchKeyword.value}`, {
        width: 200,
        height: 60
      })
      map.openInfoWindow(infoWindow, point)
    } else {
      alert('未能找到该地址')
    }
  }, "西安市")
}

// 应用筛选
const applyFilters = () => {
  console.log('价格范围:', priceRange.value)
  console.log('房型:', houseTypes.value)
  // 实际项目中这里会根据筛选条件更新地图上的标记点
}

// 放大地图
const zoomIn = () => {
  if (map) {
    map.zoomIn()
  }
}

// 缩小地图
const zoomOut = () => {
  if (map) {
    map.zoomOut()
  }
}

// 在地图上选择房源
const selectHouseOnMap = (house: any) => {
  console.log('在地图上选中房源:', house)
  // 实际项目中这里会在地图上高亮显示该房源
}

// 打开AI聊天
const openAIChat = () => {
  router.push('/chat')
}

onMounted(() => {
  // 初始化地图
  initMap()
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

.map-wrapper {
  height: 600px;
  width: 100%;
}

.filter-panel {
  margin-bottom: 20px;
}

.search-box {
  margin-bottom: 20px;
}

.filter-section {
  margin-bottom: 20px;
}

.filter-section h4 {
  margin-bottom: 10px;
}

.nearby-houses {
  max-height: 400px;
  overflow-y: auto;
}

.house-item {
  padding: 10px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}

.house-item:hover {
  background-color: #f5f5f5;
}

.price {
  color: #ff6600;
  font-weight: bold;
  margin: 5px 0;
}

.location {
  color: #666;
  font-size: 12px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .map-wrapper {
    height: 400px;
  }
  
  .el-col {
    margin-bottom: 15px;
  }
  
  .nearby-houses {
    max-height: 200px;
  }
}
</style>