<template>
  <el-dropdown trigger="click" @command="handleCommand">
    <div class="header-user-trigger" role="button" tabindex="0">
      <UserAvatar :avatar-url="user?.avatarUrl" :size="avatarSize" />
      <span class="header-user-name">{{ user?.username }}</span>
      <el-icon class="header-user-caret"><ArrowDown /></el-icon>
    </div>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="profile">个人信息</el-dropdown-item>
        <el-dropdown-item command="favorites">我的收藏</el-dropdown-item>
        <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
import userStore from '../stores/userStore'
import UserAvatar from './UserAvatar.vue'

const { size: avatarSize } = withDefaults(
  defineProps<{
    /** 顶栏头像直径，默认 36 */
    size?: number
  }>(),
  { size: 36 }
)

const router = useRouter()
const user = computed(() => userStore.currentUser.value)

function handleCommand(command: string) {
  switch (command) {
    case 'profile':
      router.push('/profile')
      break
    case 'favorites':
      router.push('/favorites')
      break
    case 'logout':
      userStore.clearCurrentUser()
      router.push('/')
      break
  }
}
</script>

<style scoped>
.header-user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  user-select: none;
}

.header-user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-user-caret {
  font-size: 12px;
}
</style>
