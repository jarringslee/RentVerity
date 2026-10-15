<template>
  <div class="home">
    <el-container class="full-height">
      <el-header class="header">
        <h1>安心租</h1>
        <div class="nav">
          <HeaderUserMenu v-if="isLoggedIn" />
          <div v-else>
            <el-button type="primary" @click="$router.push('/login')"
              >登录</el-button
            >
            <el-button @click="$router.push('/register')">注册</el-button>
          </div>
        </div>
      </el-header>

      <el-main>
        <div class="features">
          <el-row :gutter="20">
            <el-col :span="24" :md="12">
              <el-card class="feature-card" @click="$router.push('/houses')">
                <h3>房源浏览</h3>
                <p>海量真实房源信息</p>
              </el-card>
            </el-col>
            <el-col :span="24" :md="12">
              <el-card class="feature-card" @click="$router.push('/map')">
                <h3>地图找房</h3>
                <p>直观的地图找房体验</p>
              </el-card>
            </el-col>
            <el-col :span="24" :md="12">
              <el-badge
                :value="chatUnreadTotal"
                :hidden="!isLoggedIn || chatUnreadTotal <= 0"
                :max="99"
                class="chat-entry-badge"
              >
                <el-card class="feature-card" @click="goChat">
                  <h3>在线沟通</h3>
                  <p>与房东直接交流</p>
                </el-card>
              </el-badge>
            </el-col>
            <el-col :span="24" :md="12">
              <el-card class="feature-card" @click="$router.push('/publish')">
                <h3>发布房源</h3>
                <p>房东一键发布出租信息</p>
              </el-card>
            </el-col>
          </el-row>
        </div>

        <div
          class="risk-analysis-section"
          style="margin-bottom: 30px; padding-top: 10px"
        >
          <el-card style="margin-bottom: 20px">
            <h2>AI 租房助手</h2>
            <p>用一句话描述预算、区域和房型，确认条件后检索真实房源；也可咨询看房准备与租房流程。</p>
            <el-button type="primary" @click="router.push('/ai-assistant')">进入 AI 助手</el-button>
          </el-card>
          <el-card>
            <h2>合同 AI 风险分析</h2>
            <p>上传文字型 PDF，查看带原文和页码的风险提示，点击提示定位合同页面。</p>
            <p>单份文件不超过 10 MB / 40 页，暂不支持扫描件及 DOC/DOCX。</p>
            <el-button
              type="primary"
              @click="router.push('/contract-analysis')"
              style="margin-top: 15px"
            >
              进入合同分析
            </el-button>
          </el-card>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import userStore from "../stores/userStore";
import HeaderUserMenu from "../components/HeaderUserMenu.vue";
import { fetchChatUnreadTotal } from "../services/api";

const router = useRouter();
const route = useRoute();

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn());

const chatUnreadTotal = ref(0);
let unreadPollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshChatUnread() {
  if (!isLoggedIn.value) {
    chatUnreadTotal.value = 0;
    return;
  }
  try {
    const res = (await fetchChatUnreadTotal()) as {
      success?: boolean;
      data?: { total?: number };
    };
    if (res.success && res.data && typeof res.data.total === "number") {
      chatUnreadTotal.value = res.data.total;
    }
  } catch {
    /* 忽略 */
  }
}

function goChat() {
  router.push("/chat");
}

function startUnreadPoll() {
  stopUnreadPoll();
  if (!isLoggedIn.value) return;
  void refreshChatUnread();
  unreadPollTimer = setInterval(refreshChatUnread, 25000);
}

function stopUnreadPoll() {
  if (unreadPollTimer != null) {
    clearInterval(unreadPollTimer);
    unreadPollTimer = null;
  }
}

watch(
  () => [route.path, isLoggedIn.value] as const,
  ([path, logged]) => {
    if (path === "/" && logged) {
      startUnreadPoll();
    } else {
      stopUnreadPoll();
      if (!logged) chatUnreadTotal.value = 0;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  stopUnreadPoll();
});
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

.nav button {
  margin-left: 10px;
}

.search-section {
  margin-bottom: 30px;
}

.features {
  margin-top: 30px;
}

.el-col {
  padding-top: 10px;
}

.chat-entry-badge {
  display: block;
  width: 100%;
}

.chat-entry-badge :deep(.el-badge__content) {
  border: none;
}

.feature-card {
  text-align: center;
  background-color: aliceblue;
  cursor: pointer;
  transition: all 0.3s ease;
  height: 100%;
}

.feature-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }

  .header {
    flex-direction: column;
    padding: 10px 0;
  }

  .nav {
    margin-top: 10px;
  }

  .nav button {
    margin: 0 5px;
  }
}
</style>
