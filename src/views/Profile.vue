<template>
  <div class="profile">
    <el-container class="full-height">
      <el-header class="header">
        <h1>个人信息</h1>
        <div class="nav">
          <el-button @click="$router.go(-1)" type="primary">返回</el-button>
        </div>
      </el-header>
      
      <el-main>
        <el-card v-if="currentUser">
          <div class="profile-info">
            <el-descriptions title="基本信息" :column="1" border>
              <el-descriptions-item label="用户名">{{ currentUser.username }}</el-descriptions-item>
              <el-descriptions-item label="手机号">{{ currentUser.phone }}</el-descriptions-item>
              <el-descriptions-item label="注册时间">2025-01-01</el-descriptions-item>
            </el-descriptions>
          </div>
          
          <div class="preference-section" style="margin-top: 30px;">
            <h3>偏好设置</h3>
            <el-tag v-if="currentUser.preference" type="primary">{{ getPreferenceLabel(currentUser.preference) }}</el-tag>
            <p v-else>暂未设置偏好</p>
          </div>
        </el-card>
        
        <el-card v-else>
          <el-empty description="未找到用户信息" />
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import userStore from '../stores/userStore'

const router = useRouter()

// 获取当前用户信息
const currentUser = computed(() => userStore.currentUser.value)

// 偏好标签映射
const preferenceLabels: Record<string, string> = {
  'price': '价格优先',
  'location': '地段优先',
  'environment': '环境优先',
  'traffic': '交通优先'
}

// 获取偏好标签文本
const getPreferenceLabel = (preference: string) => {
  return preferenceLabels[preference] || preference
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

.profile-info {
  margin-bottom: 20px;
}
</style>