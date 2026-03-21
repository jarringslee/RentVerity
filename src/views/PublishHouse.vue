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
                :min="0"
                :step="100"
                style="width: 100%"
              />
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

            <el-form-item label="风险等级">
              <el-select v-model="form.riskLevel" placeholder="请选择风险等级">
                <el-option label="低风险" value="low" />
                <el-option label="中风险" value="medium" />
                <el-option label="高风险" value="high" />
              </el-select>
            </el-form-item>

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
import { reactive, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { publishHouse } from '../services/api'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const router = useRouter()
const formRef = ref<FormInstance>()
const submitting = ref(false)

const isLoggedIn = computed(() => userStore.isLoggedIn())

const form = reactive({
  title: '',
  price: 0,
  location: '',
  description: '',
  image: '',
  tags: [] as string[],
  riskLevel: 'low',
  area: undefined as number | undefined,
  floor: '',
  orientation: '',
  landlordName: '',
  landlordPhone: ''
})

const rules: FormRules = {
  title: [{ required: true, message: '请输入房源标题', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'change' }],
  location: [{ required: true, message: '请输入位置', trigger: 'blur' }]
}

function geocodeLocation(address: string): Promise<{ lng: number; lat: number } | null> {
  return new Promise((resolve) => {
    if (typeof BMapGL === 'undefined') {
      resolve(null)
      return
    }
    const geo = new BMapGL.Geocoder()
    geo.getPoint(
      address.trim(),
      (point: { lng: number; lat: number } | null) => {
        if (point && typeof point.lng === 'number' && typeof point.lat === 'number') {
          resolve({ lng: point.lng, lat: point.lat })
        } else {
          resolve(null)
        }
      },
      '西安市'
    )
  })
}

const handleSubmit = async () => {
  if (!isLoggedIn.value) {
    router.push('/login')
    return
  }

  if (!formRef.value) return

  await formRef.value.validate(async valid => {
    if (!valid) return

    submitting.value = true
    try {
      const coords = await geocodeLocation(form.location)
      if (!coords) {
        ElMessage.warning('未能解析地址坐标，房源仍可发布，但地图页可能不显示该点')
      }
      const res = await publishHouse({
        ...form,
        lng: coords?.lng ?? null,
        lat: coords?.lat ?? null
      })
      if (res.success) {
        router.push('/houses')
      } else {
        ElMessage.error((res as { message?: string }).message || '发布失败')
      }
    } finally {
      submitting.value = false
    }
  })
}
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

.form-card {
  max-width: 600px;
  margin: 20px auto;
}
</style>

