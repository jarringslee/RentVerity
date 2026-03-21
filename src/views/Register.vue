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
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance } from 'element-plus'
import { register } from '../services/api'
import { PERSONAL_PREFERENCE_OPTIONS } from '../constants/userPreferences'
import {
  provinceAndCityData,
  cityLabelFromCodes
} from '../utils/chinaRegion'

const router = useRouter()
const registerFormRef = ref<FormInstance>()
/** 省市区级联 value，与 element-china-area-data 一致 */
const regionCodes = ref<string[]>([])

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
      router.push('/login')
    } else {
      alert(res.message)
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
</style>
