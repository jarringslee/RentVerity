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
              <el-card class="feature-card" @click="$router.push('/chat')">
                <h3>在线沟通</h3>
                <p>与房东直接交流</p>
              </el-card>
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
          <el-card>
            <h2>风险分析</h2>
            <p>上传您的租赁合同或相关文件，我们将为您分析潜在风险</p>
            <el-upload
              class="upload-demo"
              drag
              action="/api/upload"
              :auto-upload="false"
              :on-change="handleFileChange"
              :on-remove="handleFileRemove"
              multiple
            >
              <el-icon class="el-icon--upload"><upload-filled /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">
                  支持PDF、DOC、DOCX文件，大小不超过10MB
                </div>
              </template>
            </el-upload>
            <el-button
              type="primary"
              @click="analyzeRisk"
              :disabled="!selectedFiles.length"
              style="margin-top: 15px"
            >
              开始分析
            </el-button>
          </el-card>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { UploadFilled } from "@element-plus/icons-vue";
import userStore from "../stores/userStore";
import HeaderUserMenu from "../components/HeaderUserMenu.vue";

const router = useRouter();

// 检查用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn());

// 搜索表单数据
const searchForm = reactive({
  location: "",
  price: "",
  type: "",
});

// 已选择的文件
const selectedFiles = ref<any[]>([]);

// 搜索房源方法
const searchHouses = () => {
  // 实际项目中这里会调用API进行搜索
  router.push("/houses");
};

// 处理文件选择变化
const handleFileChange = (file: any, fileList: any[]) => {
  selectedFiles.value = fileList;
};

// 处理文件移除
const handleFileRemove = (file: any, fileList: any[]) => {
  selectedFiles.value = fileList;
};

// 风险分析
const analyzeRisk = () => {
  // 模拟风险分析过程
  alert(`已选择 ${selectedFiles.value.length} 个文件，开始分析风险...`);
  // 实际项目中这里会调用API进行风险分析
};

onMounted(() => {
  // 页面加载时检查用户登录状态
  console.log("用户登录状态:", isLoggedIn.value);
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