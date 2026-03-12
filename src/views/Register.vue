<template>
  <div class="register">
    <el-card class="register-card">
      <div class="card-header">
        <h2>用户注册</h2>
      </div>
      
      <el-form :model="registerForm" :rules="rules" ref="registerFormRef" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="registerForm.username" placeholder="请输入用户名"></el-input>
        </el-form-item>
        
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="registerForm.phone" placeholder="请输入手机号"></el-input>
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input 
            v-model="registerForm.password" 
            type="password" 
            placeholder="请输入密码"
            show-password>
          </el-input>
        </el-form-item>
        
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input 
            v-model="registerForm.confirmPassword" 
            type="password" 
            placeholder="请再次输入密码"
            show-password>
          </el-input>
        </el-form-item>

        <el-form-item label="偏好设置">
          <el-select v-model="registerForm.preference" placeholder="请选择您的偏好" style="width: 100%;">
            <el-option label="孕妇" value="pregnant"></el-option>
            <el-option label="大学生" value="student"></el-option>
            <el-option label="打工人" value="worker"></el-option>
            <el-option label="老人" value="elderly"></el-option>
          </el-select>
        </el-form-item>
        
        <el-form-item>
          <el-button type="primary" @click="handleRegister" style="width: 100%">注册</el-button>
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

const router = useRouter()
const registerFormRef = ref<FormInstance>()

// 注册表单数据
const registerForm = reactive({
  username: '',
  phone: '',
  password: '',
  confirmPassword: '',
  preference: '' // 单选偏好
})

// 表单验证规则
const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (rule: any, value: string, callback: any) => {
        if (value !== registerForm.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  preference: [
    { required: true, message: '请选择您的偏好', trigger: 'change' }
  ]
}

// 处理注册
const handleRegister = async () => {
  if (!registerFormRef.value) return
  
  await registerFormRef.value.validate(async (valid) => {
    if (valid) {
      // 调用注册API，传递偏好设置
      const res = await register(
        registerForm.username, 
        registerForm.phone, 
        registerForm.password,
        [registerForm.preference] // 将单个偏好转换为数组形式传入
      )
      if (res.success) {
        // 注册成功后跳转到登录页
        router.push('/login')
      } else {
        // 显示错误信息
        alert(res.message)
      }
    }
  })
}
</script>

<style scoped>
.register {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f5f5f5;
}

.register-card {
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