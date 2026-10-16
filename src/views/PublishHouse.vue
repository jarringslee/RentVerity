<template>
  <div class="publish-house">
    <el-container class="full-height">
      <el-header class="header">
        <h1>发布房源</h1>
        <div class="nav">
          <el-button @click="$router.go(-1)">返回</el-button>
          <HeaderUserMenu v-if="isLoggedIn" />
        </div>
      </el-header>

      <el-main>
        <el-card class="form-card">
          <el-form
            :model="form"
            :rules="rules"
            ref="formRef"
            label-width="100px"
          >
            <el-form-item label="标题" prop="title">
              <el-input v-model="form.title" placeholder="请输入房源标题" />
            </el-form-item>

            <el-form-item label="价格" prop="price">
              <el-input-number
                v-model="form.price"
                :min="1"
                :precision="0"
                :step="100"
                style="width: 100%"
              />
            </el-form-item>

            <el-form-item label="城市" prop="city">
              <el-select id="publish-city" v-model="form.city" filterable placeholder="请选择房源所在城市" style="width: 100%" :loading="citiesLoading"><el-option v-for="city in cities" :key="city" :label="city" :value="city" /></el-select>
              <el-button v-if="citiesError" link type="danger" @click="loadCities">城市列表加载失败，点击重试</el-button>
            </el-form-item>
            <el-form-item label="房型" prop="houseType">
              <el-select id="publish-house-type" v-model="form.houseType" placeholder="请选择实际房型" style="width: 100%"><el-option v-for="type in HOUSE_TYPES" :key="type" :label="type" :value="type" /></el-select>
            </el-form-item>
            <el-form-item label="位置" prop="location">
              <el-input
                v-model="form.location"
                placeholder="例如：西安市高新区xxx小区（将自动解析地图坐标）"
              />
            </el-form-item>

            <el-form-item label="面积">
              <el-input-number
                v-model="form.area"
                :min="0"
                :step="5"
                :precision="0"
                style="width: 100%"
                placeholder="平方米"
              />
            </el-form-item>

            <el-form-item label="楼层">
              <el-input v-model="form.floor" placeholder="例如：5/12层" />
            </el-form-item>

            <el-form-item label="朝向">
              <el-input v-model="form.orientation" placeholder="例如：朝南、南北通透" />
            </el-form-item>

            <el-alert title="平台不提供房源风险评分或资质认证；合同风险请使用独立合同分析功能。" type="info" :closable="false" style="margin-bottom: 16px" />

            <el-form-item label="标签">
              <el-select
                v-model="form.tags"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入标签"
              >
                <el-option label="近地铁" value="近地铁" />
                <el-option label="精装修" value="精装修" />
                <el-option label="拎包入住" value="拎包入住" />
                <el-option label="学区房" value="学区房" />
              </el-select>
            </el-form-item>

            <el-form-item label="图片地址">
              <el-input
                v-model="form.image"
                placeholder="例如：/images/houses/house-1.jpg"
              />
            </el-form-item>

            <el-form-item label="房源描述">
              <el-input
                type="textarea"
                v-model="form.description"
                :rows="4"
                placeholder="请输入房源详细描述"
              />
            </el-form-item>

            <el-form-item label="房东姓名">
              <el-input v-model="form.landlordName" placeholder="房东姓名" />
            </el-form-item>

            <el-form-item label="房东电话">
              <el-input v-model="form.landlordPhone" placeholder="房东联系电话" />
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                :loading="submitting"
                @click="handleSubmit"
                style="width: 100%"
              >
                发布房源
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { publishHouse, getHouseCities } from '../services/api'
import { HOUSE_TYPES } from '../types/houses'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const router = useRouter()
const formRef = ref<FormInstance>()
const submitting = ref(false)
let disposed = false
onBeforeUnmount(() => { disposed = true })
const cities = ref<string[]>([]), citiesLoading = ref(false), citiesError = ref(false)
async function loadCities() {
  citiesLoading.value = true; citiesError.value = false
  try { const response = await getHouseCities(); if (!response.success || !Array.isArray(response.data)) throw new Error(); cities.value = response.data }
  catch { citiesError.value = true }
  finally { citiesLoading.value = false }
}
onMounted(loadCities)

const isLoggedIn = computed(() => userStore.isLoggedIn())

const form = reactive({
  title: '',
  city: '',
  houseType: '',
  price: 1000,
  location: '',
  description: '',
  image: '',
  tags: [] as string[],
  area: undefined as number | undefined,
  floor: '',
  orientation: '',
  landlordName: '',
  landlordPhone: ''
})

const rules: FormRules = {
  city: [{ required: true, message: '请选择城市', trigger: 'change' }],
  houseType: [{ required: true, message: '请选择实际房型', trigger: 'change' }],
  title: [{ required: true, message: '请输入房源标题', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'change' }],
  location: [{ required: true, message: '请输入位置', trigger: 'blur' }]
}

function geocodeLocation(address: string, city: string): Promise<{ lng: number; lat: number } | null> {
  return new Promise((resolve) => {
    // SDK 回调未返回也不能永久卡住发布；超时后不伪造坐标。
    const timer = setTimeout(() => resolve(null), 5000)
    const finish = (point: { lng: number; lat: number } | null) => { clearTimeout(timer); resolve(point) }
    if (typeof BMapGL === 'undefined') {
      finish(null)
      return
    }
    const geo = new BMapGL.Geocoder()
    geo.getPoint(
      address.trim(),
      (point: { lng: number; lat: number } | null) => {
        if (point && typeof point.lng === 'number' && typeof point.lat === 'number') {
          finish({ lng: point.lng, lat: point.lat })
        } else {
          finish(null)
        }
      },
      city
    )
  })
}

const handleSubmit = async () => {
  if (!isLoggedIn.value) {
    router.push('/login')
    return
  }

  if (!formRef.value || submitting.value) return
  // 校验也可能异步，先占位，不能等 validate 回调后再防重复。
  submitting.value = true
  const ownerToken = userStore.getToken()
  try {
    if (!await formRef.value.validate().catch(() => false)) return
    const payload = { ...form, tags: [...form.tags] }
    const coords = await geocodeLocation(payload.location, payload.city)
    if (disposed || !ownerToken || userStore.getToken() !== ownerToken) return
    if (!coords) {
      ElMessage.warning('未能解析地址坐标，房源仍可发布，但地图页可能不显示该点')
    }
    const res = await publishHouse({
      ...payload,
      lng: coords?.lng ?? null,
      lat: coords?.lat ?? null
    })
    if (disposed || userStore.getToken() !== ownerToken) return
    if (res.success) {
      router.push('/houses')
    } else {
      ElMessage.error((res as { message?: string }).message || '发布失败')
    }
  } catch (error) {
    if (disposed) return
    ElMessage.error(error instanceof Error ? error.message : '发布失败，请重试')
  } finally {
    submitting.value = false
  }
}
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
  gap: 12px;
}

.form-card {
  max-width: 600px;
  margin: 20px auto;
}
</style>

