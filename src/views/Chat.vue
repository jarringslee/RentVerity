<template>
  <div class="chat-page">
    <el-container class="full-height">
      <el-header class="header">
        <h1>在线沟通</h1>
        <div class="nav">
          <el-button @click="$router.go(-1)">返回</el-button>
          <HeaderUserMenu v-if="isLoggedIn" />
        </div>
      </el-header>
      
      <el-main>
        <el-row :gutter="20" style="height: 100%;">
          <!-- 联系人列表 -->
          <el-col :span="24" :md="6">
            <el-card class="contacts-card" style="height: 100%;">
              <div slot="header">
                <h3>联系人</h3>
              </div>
              
              <div class="contacts-list">
                <div 
                  v-for="contact in contacts" 
                  :key="contact.id" 
                  class="contact-item"
                  :class="{ active: activeContact === contact.id }"
                  @click="selectContact(contact)">
                  <el-avatar :src="contact.avatar" size="small"></el-avatar>
                  <div class="contact-info">
                    <div class="contact-name">{{ contact.name }}</div>
                    <div class="last-message">{{ contact.lastMessage }}</div>
                  </div>
                  <div class="contact-time">{{ contact.time }}</div>
                </div>
              </div>
            </el-card>
          </el-col>
          
          <!-- 聊天窗口 -->
          <el-col :span="24" :md="18">
            <el-card class="chat-card" style="height: 100%;">
              <div class="chat-header">
                <div class="chat-partner">
                  <el-avatar :src="activeContactData?.avatar" size="small"></el-avatar>
                  <span>{{ activeContactData?.name }}</span>
                </div>
              </div>
              
              <div class="messages-container">
                <div 
                  v-for="message in messages" 
                  :key="message.id"
                  class="message"
                  :class="{ 'message-mine': message.sender === 'me' }">
                  <div class="message-content">
                    {{ message.text }}
                    <div class="message-time">{{ message.time }}</div>
                  </div>
                </div>
              </div>
              
              <div class="input-area">
                <el-input
                  v-model="newMessage"
                  type="textarea"
                  :rows="3"
                  placeholder="请输入消息...">
                </el-input>
                <div class="send-button">
                  <el-button type="primary" @click="handleSendMessage">发送</el-button>
                </div>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getMessages, sendMessage } from '../services/api'
import { ElInput } from 'element-plus'
import userStore from '../stores/userStore'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'

const isLoggedIn = computed(() => userStore.isLoggedIn())

// 当前激活的联系人
const activeContact = ref(1)

// 路由参数
const route = useRoute()

// 新消息内容
const newMessage = ref('')

// 获取当前激活的联系人数据
const activeContactData = computed(() => {
  return contacts.find(contact => contact.id === activeContact.value)
})

// 选择联系人
const selectContact = (contact: any) => {
  activeContact.value = contact.id
}

// 发送消息
const handleSendMessage = async () => {
  if (newMessage.value.trim() === '') return
  
  const res = await sendMessage(activeContact.value, newMessage.value)
  if (res.success) {
    messages.push(res.data)
    newMessage.value = ''
  }
}

// 联系人列表（模拟数据）
const contacts = reactive([
  {
    id: 1,
    name: '张房东',
    avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
    lastMessage: '您好，请问房子还...',
    time: '10:30'
  },
  {
    id: 2,
    name: '李经理',
    avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
    lastMessage: '欢迎咨询我们的房...',
    time: '昨天'
  },
  {
    id: 3,
    name: '王客户',
    avatar: 'https://fuss10.elemecdn.com/e/5d/4a731a90594a4af544c0c25941171jpeg.jpeg',
    lastMessage: '这个房子我很满意',
    time: '前天'
  }
])

// 消息记录（模拟数据）
const messages = reactive([
  {
    id: 1,
    sender: 1,
    text: '您好，请问这套房子还在吗？',
    time: '10:25'
  },
  {
    id: 2,
    sender: 'me',
    text: '您好，房子还在的，请问您什么时候想看房？',
    time: '10:26'
  },
  {
    id: 3,
    sender: 1,
    text: '我这周末有时间，周六下午可以吗？',
    time: '10:28'
  }
])

onMounted(() => {
  // 页面加载时默认选择第一个联系人
  activeContact.value = 1
  
  // 如果路由中有房东ID，则选择对应的联系人
  const landlordId = route.params.landlordId
  if (landlordId) {
    activeContact.value = Number(landlordId)
  }
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

.nav {
  display: flex;
  align-items: center;
  gap: 12px;
}

.contacts-card, .chat-card {
  height: calc(100vh - 120px);
}

.chat-header {
  display: flex;
  align-items: center;
}

.chat-partner {
  display: flex;
  align-items: center;
}

.chat-partner span {
  margin-left: 10px;
  font-weight: bold;
}

.contacts-list {
  height: calc(100% - 50px);
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  padding: 10px;
  cursor: pointer;
  border-radius: 4px;
}

.contact-item:hover {
  background-color: #f5f5f5;
}

.contact-item.active {
  background-color: #ecf5ff;
}

.contact-info {
  flex: 1;
  margin: 0 10px;
}

.contact-name {
  font-weight: bold;
}

.last-message {
  font-size: 12px;
  color: #999;
  margin-top: 3px;
}

.contact-time {
  font-size: 12px;
  color: #999;
}

.messages-container {
  height: calc(100% - 150px);
  overflow-y: auto;
  padding: 20px 0;
}

.message {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 15px;
  padding: 0 20px;
}

.my-message {
  justify-content: flex-end;
}

.message-content {
  max-width: 70%;
}

.message-text {
  padding: 10px 15px;
  border-radius: 8px;
  background-color: #f0f0f0;
  word-wrap: break-word;
}

.my-message .message-text {
  background-color: #409eff;
  color: white;
}

.message-time {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
  text-align: right;
}

.input-area {
  margin-top: 20px;
}

.send-button {
  margin-top: 10px;
  text-align: right;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .el-col {
    margin-bottom: 15px;
  }
  
  .contacts-card, .chat-card {
    height: auto;
    min-height: 300px;
  }
  
  .messages-container {
    height: 300px;
  }
  
  .message-content {
    max-width: 90%;
  }
}
</style>