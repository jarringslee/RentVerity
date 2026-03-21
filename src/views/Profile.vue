<template>
  <div class="profile">
    <el-container class="full-height">
      <el-header class="header">
        <h1>个人信息</h1>
        <div class="nav">
          <el-button @click="$router.go(-1)" type="primary">返回</el-button>
        </div>
      </el-header>

      <el-main v-loading="pageLoading">
        <template v-if="currentUser">
          <el-card class="main-card" shadow="hover">
            <template #header>
              <div class="card-header-row">
                <span class="card-title">{{
                  isEditingBasic ? '编辑基本资料' : '个人信息'
                }}</span>
                <div class="card-header-actions">
                  <template v-if="!isEditingBasic">
                    <el-button type="primary" @click="enterEditBasic">
                      编辑信息
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button @click="exitEditBasic">取消编辑</el-button>
                  </template>
                </div>
              </div>
            </template>

            <!-- 仅展示 -->
            <div v-if="!isEditingBasic" class="view-section">
              <el-descriptions :column="1" border>
                <el-descriptions-item label="用户名">{{
                  currentUser.username
                }}</el-descriptions-item>
                <el-descriptions-item label="手机号">{{
                  currentUser.phone
                }}</el-descriptions-item>
                <el-descriptions-item label="性别">{{
                  genderDisplay
                }}</el-descriptions-item>
                <el-descriptions-item label="地区">{{
                  cityDisplay
                }}</el-descriptions-item>
                <el-descriptions-item label="注册时间">{{
                  formattedCreatedAt
                }}</el-descriptions-item>
                <el-descriptions-item label="个人偏好">
                  <template v-if="displayPreferences.length">
                    <el-tag
                      v-for="p in displayPreferences"
                      :key="p"
                      type="primary"
                      size="small"
                      class="pref-tag"
                    >
                      {{ preferenceLabel(p) }}
                    </el-tag>
                  </template>
                  <span v-else class="text-muted">暂无</span>
                </el-descriptions-item>
              </el-descriptions>
            </div>

            <!-- 编辑基本资料 -->
            <div v-else class="edit-section">
              <el-form
                ref="basicFormRef"
                :model="basicForm"
                :rules="basicRules"
                label-width="88px"
                class="basic-form"
              >
                <el-form-item label="用户名" prop="username">
                  <el-input
                    v-model="basicForm.username"
                    placeholder="用户名"
                    maxlength="50"
                    show-word-limit
                  />
                </el-form-item>
                <el-form-item label="手机号" prop="phone">
                  <el-input
                    v-model="basicForm.phone"
                    placeholder="11 位手机号"
                    maxlength="11"
                  />
                </el-form-item>
                <el-form-item label="性别" prop="gender">
                  <el-radio-group v-model="basicForm.gender">
                    <el-radio label="male">男</el-radio>
                    <el-radio label="female">女</el-radio>
                  </el-radio-group>
                </el-form-item>
                <el-form-item label="地区">
                  <el-cascader
                    v-model="regionCodes"
                    :options="provinceAndCityData"
                    :props="{ expandTrigger: 'hover' }"
                    placeholder="请先选省，再选市（区）"
                    filterable
                    clearable
                    style="width: 100%"
                  />
                </el-form-item>
                <el-form-item label="个人偏好">
                  <el-checkbox-group
                    v-model="basicForm.preferences"
                    class="pref-group"
                  >
                    <el-checkbox
                      v-for="opt in PERSONAL_PREFERENCE_OPTIONS"
                      :key="opt.value"
                      :label="opt.value"
                    >
                      {{ opt.label }}
                    </el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <el-form-item>
                  <el-button
                    type="primary"
                    :loading="basicSaving"
                    @click="submitBasic"
                  >
                    保存资料
                  </el-button>
                  <el-button
                    v-if="!showPasswordSection"
                    @click="openPasswordSection"
                  >
                    修改密码
                  </el-button>
                </el-form-item>
              </el-form>

              <template v-if="showPasswordSection">
                <el-divider content-position="left">修改密码</el-divider>
                <p class="pwd-tip">
                  修改前需验证原密码；新密码不能与旧密码相同。
                </p>
                <el-form
                  ref="pwdFormRef"
                  :model="pwdForm"
                  :rules="pwdRules"
                  label-width="100px"
                  class="pwd-form"
                >
                  <el-form-item label="原密码" prop="oldPassword">
                    <el-input
                      v-model="pwdForm.oldPassword"
                      type="password"
                      show-password
                      placeholder="请输入当前密码"
                      autocomplete="current-password"
                    />
                  </el-form-item>
                  <el-form-item label="新密码" prop="newPassword">
                    <el-input
                      v-model="pwdForm.newPassword"
                      type="password"
                      show-password
                      placeholder="至少 6 位"
                      autocomplete="new-password"
                    />
                  </el-form-item>
                  <el-form-item label="确认新密码" prop="confirmPassword">
                    <el-input
                      v-model="pwdForm.confirmPassword"
                      type="password"
                      show-password
                      placeholder="再次输入新密码"
                      autocomplete="new-password"
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button
                      type="primary"
                      :loading="pwdSaving"
                      @click="submitPassword"
                    >
                      确认修改密码
                    </el-button>
                    <el-button @click="cancelPasswordSection">
                      取消修改密码
                    </el-button>
                  </el-form-item>
                </el-form>
              </template>
            </div>
          </el-card>
        </template>

        <el-card v-else>
          <el-empty description="未找到用户信息，请先登录" />
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import userStore from '../stores/userStore'
import {
  fetchUserProfile,
  updateUserProfile,
  changeUserPassword
} from '../services/api'
import {
  provinceAndCityData,
  cityLabelFromCodes,
  findRegionCodesByCityLabel
} from '../utils/chinaRegion'
import {
  PERSONAL_PREFERENCE_OPTIONS,
  preferenceLabelMap
} from '../constants/userPreferences'

const router = useRouter()

const pageLoading = ref(false)
const basicSaving = ref(false)
const pwdSaving = ref(false)

const isEditingBasic = ref(false)
const showPasswordSection = ref(false)

const basicFormRef = ref<FormInstance>()
const pwdFormRef = ref<FormInstance>()

/** 编辑资料时省→市（区）级联 */
const regionCodes = ref<string[]>([])

const currentUser = computed(() => userStore.currentUser.value)

const serverCreatedAt = ref<string | null>(null)

const basicForm = reactive({
  username: '',
  phone: '',
  gender: 'male' as 'male' | 'female',
  preferences: [] as string[]
})

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const displayPreferences = computed((): string[] => {
  const prefs = currentUser.value?.preferences
  if (Array.isArray(prefs)) return [...prefs]
  return []
})

const genderDisplay = computed(() => {
  const g = currentUser.value?.gender
  if (g === 'female') return '女'
  return '男'
})

const cityDisplay = computed(() => {
  const c = currentUser.value?.city
  if (c && String(c).trim()) return c
  return '暂无'
})

const formattedCreatedAt = computed(() => {
  const raw = serverCreatedAt.value
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return d.toLocaleString('zh-CN')
})

const preferenceLabel = (key: string) => preferenceLabelMap[key] || key

const basicRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 50, message: '长度为 2～50 个字符', trigger: 'blur' }
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号',
      trigger: 'blur'
    }
  ],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }]
}

const validateNewNotSameAsOld = (
  _rule: unknown,
  value: string,
  callback: (e?: Error) => void
) => {
  if (!value) {
    callback(new Error('请输入新密码'))
    return
  }
  if (pwdForm.oldPassword && value === pwdForm.oldPassword) {
    callback(new Error('新密码不能与旧密码一致'))
    return
  }
  callback()
}

const validateConfirmPwd = (
  _rule: unknown,
  value: string,
  callback: (e?: Error) => void
) => {
  if (!value) {
    callback(new Error('请再次输入新密码'))
    return
  }
  if (value !== pwdForm.newPassword) {
    callback(new Error('两次输入的新密码不一致'))
    return
  }
  callback()
}

const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' },
    { validator: validateNewNotSameAsOld, trigger: 'blur' }
  ],
  confirmPassword: [{ validator: validateConfirmPwd, trigger: 'blur' }]
}

function prefsFromUser(): string[] {
  const u = userStore.currentUser.value
  if (u && Array.isArray(u.preferences)) return [...u.preferences]
  return []
}

const syncBasicFormFromStore = () => {
  const u = userStore.currentUser.value
  if (!u) return
  basicForm.username = u.username || ''
  basicForm.phone = u.phone || ''
  basicForm.gender = u.gender === 'female' ? 'female' : 'male'
  regionCodes.value = findRegionCodesByCityLabel(
    u.city && String(u.city).trim() ? String(u.city).trim() : ''
  )
  basicForm.preferences = prefsFromUser()
}

const enterEditBasic = () => {
  showPasswordSection.value = false
  resetPwdForm()
  syncBasicFormFromStore()
  isEditingBasic.value = true
}

const exitEditBasic = () => {
  isEditingBasic.value = false
  showPasswordSection.value = false
  resetPwdForm()
  basicFormRef.value?.clearValidate()
  syncBasicFormFromStore()
}

const openPasswordSection = () => {
  showPasswordSection.value = true
}

const cancelPasswordSection = () => {
  showPasswordSection.value = false
  resetPwdForm()
}

const mergeProfileToStore = (data: Record<string, unknown>) => {
  const token = userStore.getToken()
  userStore.mergeCurrentUser({
    id: data.id,
    username: data.username,
    phone: data.phone,
    gender: data.gender === 'female' ? 'female' : 'male',
    city: data.city ?? null,
    preferences: Array.isArray(data.preferences) ? data.preferences : [],
    ...(token ? { token } : {})
  })
}

const loadProfile = async () => {
  if (!userStore.isLoggedIn()) {
    router.push('/login')
    return
  }
  pageLoading.value = true
  try {
    const res = await fetchUserProfile()
    if (res.success && res.data) {
      serverCreatedAt.value = (res.data.createdAt as string) ?? null
      mergeProfileToStore(res.data as Record<string, unknown>)
      syncBasicFormFromStore()
    } else {
      ElMessage.error(res.message || '加载用户信息失败')
    }
  } finally {
    pageLoading.value = false
  }
}

const submitBasic = async () => {
  if (!basicFormRef.value) return
  await basicFormRef.value.validate(async (valid) => {
    if (!valid) return
    basicSaving.value = true
    try {
      const res = await updateUserProfile({
        username: basicForm.username.trim(),
        phone: basicForm.phone.trim(),
        gender: basicForm.gender,
        city: cityLabelFromCodes(regionCodes.value) || null,
        preferences: [...basicForm.preferences]
      })
      if (res.success && res.data) {
        mergeProfileToStore(res.data as Record<string, unknown>)
        if (res.data.createdAt) serverCreatedAt.value = res.data.createdAt as string
        ElMessage.success(res.message || '资料已更新')
        exitEditBasic()
      } else {
        ElMessage.error(res.message || '保存失败')
      }
    } finally {
      basicSaving.value = false
    }
  })
}

const resetPwdForm = () => {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirmPassword = ''
  pwdFormRef.value?.clearValidate()
}

const submitPassword = async () => {
  if (!pwdFormRef.value) return
  await pwdFormRef.value.validate(async (valid) => {
    if (!valid) return
    if (pwdForm.newPassword === pwdForm.oldPassword) {
      ElMessage.error('新密码不能与旧密码一致')
      return
    }
    pwdSaving.value = true
    try {
      const res = await changeUserPassword({
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword
      })
      if (res.success) {
        ElMessage.success(res.message || '密码已修改，请牢记新密码')
        resetPwdForm()
        showPasswordSection.value = false
      } else {
        ElMessage.error(res.message || '修改失败')
      }
    } finally {
      pwdSaving.value = false
    }
  })
}

onMounted(() => {
  if (!userStore.isLoggedIn()) {
    router.push('/login')
    return
  }
  syncBasicFormFromStore()
  loadProfile()
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

.main-card {
  max-width: 640px;
  margin: 0 auto;
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.card-title {
  font-weight: 600;
}

.view-section {
  padding-top: 4px;
}

.edit-section {
  padding-top: 8px;
}

.basic-form {
  max-width: 480px;
}

.pwd-form {
  max-width: 480px;
}

.pwd-tip {
  color: #909399;
  font-size: 13px;
  margin: 0 0 16px;
}

.text-muted {
  color: #909399;
}

.pref-tag {
  margin-right: 8px;
  margin-bottom: 4px;
}

.pref-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
