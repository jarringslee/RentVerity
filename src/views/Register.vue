<template>
  <div class="register">
    <el-card class="register-card">
      <div class="card-header">
        <h2>用户注册</h2>
      </div>

      <el-form
        :model="registerForm"
        :rules="rules"
        ref="registerFormRef"
        label-width="90px"
      >
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="registerForm.username"
            placeholder="请输入用户名"
          />
        </el-form-item>

        <el-form-item label="手机号" prop="phone">
          <el-input
            v-model="registerForm.phone"
            placeholder="请输入手机号"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="registerForm.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="registerForm.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="registerForm.gender">
            <el-radio label="male">男</el-radio>
            <el-radio label="female">女</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="头像">
          <div class="register-avatar-row">
            <UserAvatar :avatar-url="avatarPreviewUrl" :size="72" />
            <div class="register-avatar-actions">
              <el-upload
                :auto-upload="false"
                :show-file-list="false"
                accept="image/jpeg,image/png,image/gif,image/webp"
                :on-change="onRegisterAvatarChange"
              >
                <el-button type="primary">选择头像</el-button>
              </el-upload>
              <el-button v-if="avatarFile" link type="danger" @click="clearRegisterAvatar">
                移除
              </el-button>
            </div>
          </div>
          <div class="avatar-hint">可选；不上传则使用默认头像</div>
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
          <el-checkbox-group v-model="registerForm.preferences" class="pref-group">
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
          <el-button type="primary" style="width: 100%" @click="handleRegister">
            注册
          </el-button>
        </el-form-item>

        <div class="form-footer">
          <el-link @click="$router.push('/login')">已有账号？立即登录</el-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, UploadFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import { register, uploadUserAvatar } from '../services/api'
import UserAvatar from '../components/UserAvatar.vue'
import { PERSONAL_PREFERENCE_OPTIONS } from '../constants/userPreferences'
import {
  provinceAndCityData,
  cityLabelFromCodes
} from '../utils/chinaRegion'

const router = useRouter()
const registerFormRef = ref<FormInstance>()
/** 省市区级联 value，与 element-china-area-data 一致 */
const regionCodes = ref<string[]>([])

const avatarFile = ref<File | null>(null)
const avatarObjectUrl = ref('')

const avatarPreviewUrl = computed(() => avatarObjectUrl.value || null)

function onRegisterAvatarChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw
  if (!raw) return
  if (avatarObjectUrl.value) URL.revokeObjectURL(avatarObjectUrl.value)
  avatarFile.value = raw
  avatarObjectUrl.value = URL.createObjectURL(raw)
}

function clearRegisterAvatar() {
  if (avatarObjectUrl.value) URL.revokeObjectURL(avatarObjectUrl.value)
  avatarObjectUrl.value = ''
  avatarFile.value = null
}

onUnmounted(() => {
  if (avatarObjectUrl.value) URL.revokeObjectURL(avatarObjectUrl.value)
})

const registerForm = reactive({
  username: '',
  phone: '',
  password: '',
  confirmPassword: '',
  gender: 'male' as 'male' | 'female',
  preferences: [] as string[]
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号格式',
      trigger: 'blur'
    }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (e?: Error) => void) => {
        if (value !== registerForm.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }]
}

const handleRegister = async () => {
  if (!registerFormRef.value) return

  await registerFormRef.value.validate(async (valid) => {
    if (!valid) return
    const res = await register({
      username: registerForm.username,
      phone: registerForm.phone,
      password: registerForm.password,
      preferences: registerForm.preferences,
      gender: registerForm.gender,
      city: cityLabelFromCodes(regionCodes.value) || null
    })
    if (res.success) {
      const data = res.data as { token?: string } | undefined
      if (avatarFile.value && data?.token) {
        const up = (await uploadUserAvatar(avatarFile.value, data.token)) as {
          success?: boolean
          message?: string
        }
        if (!up.success) {
          ElMessage.warning(
            up.message || '头像上传失败，可登录后在个人资料中重新上传'
          )
        }
      }
      ElMessage.success('注册成功，请登录')
      router.push('/login')
    } else {
      ElMessage.error((res as { message?: string }).message || '注册失败')
    }
  })
}
</script>

<style scoped>
.register {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 24px 12px;
  background-color: #f5f5f5;
}

.register-card {
  width: 100%;
  max-width: 480px;
}

.card-header {
  text-align: center;
  margin-bottom: 20px;
}

.form-footer {
  text-align: center;
}

.pref-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.register-avatar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.register-avatar-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.avatar-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
</style>
