<template>
  <div class="login">
    <el-card class="login-card">
      <div class="card-header">
        <h2>用户登录</h2>
      </div>
      
      <el-form :model="loginForm" :rules="rules" ref="loginFormRef" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="loginForm.username" placeholder="请输入用户名"></el-input>
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input 
            v-model="loginForm.password" 
            type="password" 
            placeholder="请输入密码"
            show-password>
          </el-input>
        </el-form-item>
        
        <el-form-item>
          <el-button type="primary" @click="handleLogin" style="width: 100%">登录</el-button>
        </el-form-item>
        
        <div class="form-footer">
          <el-link @click="$router.push('/register')">还没有账号？立即注册</el-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance } from 'element-plus'
import { login } from '../services/api'
import userStore from '../stores/userStore'

const router = useRouter()
const loginFormRef = ref<FormInstance>()

// 登录表单数据
const loginForm = reactive({
  username: '',
  password: ''
})

// 表单验证规则
const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ]
}

// 处理登录
const handleLogin = async () => {
  if (!loginFormRef.value) return
  
  await loginFormRef.value.validate(async (valid) => {
    if (valid) {
      // 调用登录API
      const res = await login(loginForm.username, loginForm.password)
      if (res.success) {
        // 保存用户信息到状态管理
        userStore.setCurrentUser(res.data)
        // 登录成功后跳转到首页
        router.push('/')
      } else {
        // 显示错误信息
        alert(res.message)
      }
    }
  })
}
</script>

<style scoped>
.login {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f5f5f5;
}

.login-card {
  width: 400px;
}

.card-header {
  text-align: center;
  margin-bottom: 20px;
}

.form-footer {
  text-align: center;
}
</style>