<template>
  <div class="assistant-page">
    <header class="assistant-header">
      <div><h1>AI 租房助手</h1><p>描述需求 · 确认条件 · 查看真实房源</p></div>
      <div class="header-actions"><el-button @click="router.push('/')">返回首页</el-button><el-button @click="router.push('/contract-analysis')">合同分析</el-button><HeaderUserMenu v-if="isLoggedIn" /></div>
    </header>
    <main class="assistant-main">
      <el-alert v-if="!isLoggedIn" title="请先登录后使用 AI 助手。" type="info" :closable="false" show-icon><el-button type="primary" @click="router.push('/login')">前往登录</el-button></el-alert>
      <div class="assistant-grid">
        <section class="conversation-column">
          <el-card>
            <div class="section-heading"><h2>聊聊租房需求</h2><el-button size="small" @click="clearConversation">清空会话</el-button></div>
            <p class="muted">会话仅在当前标签页临时保留，不读取上传合同、个人资料或与房东的聊天。</p>
            <div ref="messagesPanel" class="messages" aria-live="polite">
              <div v-if="!messages.length" class="welcome"><h3>你想找什么样的房子？</h3><p>例如：高新区一居室，月租不超过 3000 元。</p><p>也可以询问看房准备、租房流程或平台使用。</p></div>
              <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
                <div class="message-author">{{ message.role === 'user' ? '你' : '租房助手' }}<span v-if="message.status !== 'complete'"> · {{ message.status === 'pending' ? '处理中' : message.status === 'failed' ? '未完成' : '已停止' }}</span></div>
                <p>{{ message.content }}</p>
                <el-button v-if="message.intent === 'contract_review'" size="small" @click="router.push('/contract-analysis')">前往合同分析</el-button>
              </article>
            </div>
            <div class="quick-actions"><el-button size="small" :disabled="busy || !isLoggedIn" @click="sendMessage('帮我找房')">帮我找房</el-button><el-button size="small" :disabled="busy || !isLoggedIn" @click="sendMessage('看房前应该检查哪些事项？')">看房准备</el-button></div>
            <el-input id="assistant-input" v-model="input" type="textarea" :rows="3" :maxlength="1500" show-word-limit placeholder="描述区域、月租预算、房型，或提出租房问题…" :disabled="busy || !isLoggedIn" @keydown.enter.exact.prevent="sendMessage()" />
            <div class="send-actions"><el-button type="primary" :disabled="!input.trim() || !isLoggedIn || busy" @click="sendMessage()">发送</el-button><el-button v-if="busy" @click="stopRequest">停止请求</el-button><span role="status">{{ stage === 'message' ? '正在理解需求…' : stage === 'search' ? '正在查询房源…' : statusMessage }}</span></div>
            <el-alert v-if="errorMessage" class="error-alert" :title="errorMessage" type="error" :closable="false" show-icon />
          </el-card>

          <el-card v-if="searchResult" class="search-results">
            <h2>本次确认的房源</h2><p class="confirmed-filters">{{ describeHouseFilters(searchResult.filters) }}</p>
            <p class="muted">共 {{ searchResult.total }} 套符合条件，当前展示 {{ searchResult.list.length }} 套。{{ searchResult.notice }}</p>
            <el-alert v-if="draftChanged" title="筛选卡已修改；下方仍为上次确认结果，请再次点击确认找房。" type="info" :closable="false" />
            <el-empty v-if="!searchResult.list.length" description="没有匹配房源。可修改筛选卡后重新确认，不会自动放宽条件。" />
            <article v-for="house in searchResult.list" :key="house.id" class="matched-house">
              <img :src="house.image || '/images/houses/house-1.jpg'" :alt="house.title" @error="imageFallback" />
              <div class="matched-info"><h3>{{ house.title }}</h3><p class="price">{{ house.price }} 元/月</p><p>{{ house.location }}</p><ul><li v-for="reason in house.matchReasons" :key="reason">{{ reason }}</li></ul><el-button size="small" @click="router.push(`/house/${house.id}`)">查看详情</el-button></div>
            </article>
            <div class="result-actions"><el-button @click="applyToList(searchResult.filters)">在列表查看全部</el-button><el-button @click="applyToMap(searchResult.filters)">带条件去地图</el-button></div>
          </el-card>
        </section>

        <aside class="filter-column">
          <el-card>
            <h2>可编辑筛选卡</h2><p class="muted">未填写的条件为不限；点击确认后才查询房源。</p>
            <el-form label-position="top" :model="draft">
              <el-form-item label="区域 / 位置关键词"><el-input id="assistant-location" v-model="draft.location" :maxlength="80" placeholder="如：高新区；留空不限" :disabled="busy" /></el-form-item>
              <el-form-item label="最低月租（元）"><el-input-number id="assistant-min-price" v-model="draft.minPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" :disabled="busy" /></el-form-item>
              <el-form-item label="最高月租（元）"><el-input-number id="assistant-max-price" v-model="draft.maxPrice" :min="0" :max="1000000" controls-position="right" placeholder="不限" :disabled="busy" /></el-form-item>
              <el-form-item label="房型"><el-checkbox-group v-model="draft.houseTypes" :disabled="busy"><el-checkbox v-for="type in HOUSE_TYPES" :key="type" :value="type">{{ type }}</el-checkbox></el-checkbox-group></el-form-item>
            </el-form>
            <p class="muted">房型目前按标题关键词匹配，请在详情或看房时核实。</p>
            <el-button type="primary" class="confirm-search" :disabled="busy || !isLoggedIn || !hasCriteria" @click="confirmSearch">确认找房</el-button>
            <p v-if="!hasCriteria" class="muted">请先填写或描述至少一项找房条件。</p>
            <p v-else-if="!searchResult" class="muted">当前仅整理条件，尚未查询房源。</p>
          </el-card>
        </aside>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'
import userStore from '../stores/userStore'
import { confirmAssistantSearch, sendAssistantMessage } from '../services/assistant'
import { HOUSE_TYPES, emptyHouseFilters, type HouseFilters } from '../types/houses'
import type { AssistantMessage, AssistantSearchResult } from '../types/assistant'
import { cloneHouseFilters, describeHouseFilters, houseFiltersToQuery, houseQueryFromUrl, validateHouseFilters } from '../utils/houseFilters'
import { assistantHistory, clearAssistantSession, readAssistantSession, saveAssistantSession } from '../utils/assistantSession'

const router = useRouter()
const route = useRoute()
const userId = computed(() => Number(userStore.currentUser.value?.id) || 0)
const isLoggedIn = computed(() => userStore.isLoggedIn())
const messages = ref<AssistantMessage[]>([])
const input = ref('')
const draft = reactive<HouseFilters>(emptyHouseFilters())
const searchResult = ref<AssistantSearchResult | null>(null)
const messagesPanel = ref<HTMLElement | null>(null)
const stage = ref<'idle' | 'message' | 'search'>('idle')
const busy = computed(() => stage.value !== 'idle')
const errorMessage = ref('')
const statusMessage = ref('')
const hasCriteria = computed(() => !!draft.location.trim() || draft.minPrice != null || draft.maxPrice != null || draft.houseTypes.length > 0)
const draftChanged = computed(() => searchResult.value && JSON.stringify(cloneHouseFilters(draft)) !== JSON.stringify(cloneHouseFilters(searchResult.value.filters)))
let controller: AbortController | null = null
let runVersion = 0
let ownerId = 0
let pendingMessage: AssistantMessage | null = null

function assignDraft(filters: HouseFilters) {
  draft.location = filters.location
  draft.minPrice = filters.minPrice
  draft.maxPrice = filters.maxPrice
  draft.houseTypes = [...filters.houseTypes]
}
function scrollMessages() { void nextTick(() => { if (messagesPanel.value) messagesPanel.value.scrollTop = messagesPanel.value.scrollHeight }) }
function stopRequest() {
  ++runVersion
  controller?.abort()
  controller = null
  if (pendingMessage?.status === 'pending') pendingMessage.status = 'cancelled'
  pendingMessage = null
  stage.value = 'idle'
  statusMessage.value = '已停止请求；不会自动重试。'
}

watch(userId, id => {
  stopRequest()
  ownerId = id
  const saved = readAssistantSession(id)
  messages.value = saved.messages
  assignDraft(saved.filters)
  searchResult.value = null
  errorMessage.value = ''
  statusMessage.value = saved.messages.length ? '已恢复当前标签页会话；房源需重新确认查询。' : ''
  if (id && ['location', 'minPrice', 'maxPrice', 'houseTypes'].some(key => route.query[key] != null)) {
    assignDraft(houseQueryFromUrl(route.query))
    statusMessage.value = '已带入入口条件，可修改后直接确认找房。'
    void router.replace({ path: '/ai-assistant' })
  }
  scrollMessages()
}, { immediate: true })
watch([messages, draft], () => saveAssistantSession(ownerId, messages.value, draft), { deep: true })

async function sendMessage(text?: string) {
  const message = (text ?? input.value).trim()
  if (!message || message.length > 1500 || busy.value || !isLoggedIn.value) return
  const invalid = validateHouseFilters(draft)
  if (invalid) { errorMessage.value = invalid; return }
  const history = assistantHistory(messages.value)
  const version = ++runVersion
  const current = reactive<AssistantMessage>({ id: crypto.randomUUID(), role: 'user', content: message, status: 'pending' })
  messages.value.push(current)
  messages.value = messages.value.slice(-24)
  pendingMessage = current
  input.value = ''
  errorMessage.value = ''
  statusMessage.value = ''
  stage.value = 'message'
  controller = new AbortController()
  const signal = controller.signal
  scrollMessages()
  try {
    const reply = await sendAssistantMessage({ message, history, filters: cloneHouseFilters(draft) }, signal)
    if (version !== runVersion) return
    current.status = 'complete'
    messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: reply.reply, intent: reply.intent, status: 'complete' })
    if (reply.intent === 'house_search' && reply.filters) { assignDraft(reply.filters); searchResult.value = null }
    statusMessage.value = reply.needsClarification ? '还需补充至少一项条件。' : reply.intent === 'house_search' ? '请核对筛选卡后确认。' : ''
    scrollMessages()
  } catch (error) {
    if (version !== runVersion || signal.aborted) return
    current.status = 'failed'
    input.value = message
    errorMessage.value = error instanceof Error ? error.message : '助手回答失败，可以手动重试。'
  } finally {
    if (version === runVersion) { stage.value = 'idle'; controller = null; pendingMessage = null }
  }
}

async function confirmSearch() {
  if (busy.value || !isLoggedIn.value || !hasCriteria.value) return
  const invalid = validateHouseFilters(draft)
  if (invalid) { errorMessage.value = invalid; return }
  const version = ++runVersion
  stage.value = 'search'
  errorMessage.value = ''
  controller = new AbortController()
  const signal = controller.signal
  try {
    const result = await confirmAssistantSearch(cloneHouseFilters(draft), signal)
    if (version !== runVersion) return
    searchResult.value = result
    statusMessage.value = `查询完成，共 ${result.total} 套符合条件。`
  } catch (error) {
    if (version !== runVersion || signal.aborted) return
    errorMessage.value = error instanceof Error ? error.message : '查询失败，请重试。'
  } finally { if (version === runVersion) { stage.value = 'idle'; controller = null } }
}

function clearConversation() {
  stopRequest()
  messages.value = []
  input.value = ''
  assignDraft(emptyHouseFilters())
  searchResult.value = null
  errorMessage.value = ''
  statusMessage.value = ''
  clearAssistantSession(ownerId)
}
function applyToList(filters: HouseFilters) { router.push({ path: '/houses', query: houseFiltersToQuery({ ...filters, sort: 'price_asc' }) }) }
function applyToMap(filters: HouseFilters) { router.push({ path: '/map', query: houseFiltersToQuery(filters) }) }
function imageFallback(event: Event) {
  const target = event.target as HTMLImageElement
  if (!target.dataset.fallback) { target.dataset.fallback = 'true'; target.src = '/images/houses/house-1.jpg' }
}
onBeforeUnmount(() => { stopRequest(); saveAssistantSession(ownerId, messages.value, draft) })
</script>

<style scoped>
.assistant-page { min-height: 100%; color: #303133; background: #f5f7fa; text-align: left; }
.assistant-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 28px; background: white; border-bottom: 1px solid #e4e7ed; }
.assistant-header h1 { font-size: 24px; line-height: 1.4; margin: 0 0 6px; }
.assistant-header p, .muted { font-size: 13px; color: #606266; line-height: 1.7; }
.assistant-header p { margin: 0; }
.header-actions, .section-heading, .quick-actions, .send-actions, .result-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.section-heading { justify-content: space-between; }
.section-heading h2 { margin: 0; }
.assistant-main { max-width: 1280px; padding: 24px; margin: 0 auto; }
.assistant-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); gap: 24px; margin-top: 16px; align-items: start; }
.conversation-column, .filter-column { min-width: 0; }
.filter-column { position: sticky; top: 16px; }
h2 { font-size: 18px; margin: 0 0 12px; }
.messages { max-height: 480px; min-height: 200px; overflow-y: auto; padding: 8px 0 16px; }
.welcome { padding: 24px 12px; color: #606266; }
.welcome h3 { font-size: 18px; color: #303133; }
.message { border-radius: 10px; padding: 14px; margin: 10px 0; background: #f3f5f8; }
.message.user { margin-left: 10%; background: #ecf5ff; }
.message.assistant { margin-right: 6%; }
.message-author { font-size: 12px; color: #606266; }
.message p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin: 8px 0 0; font-size: 14px; }
.quick-actions { margin-bottom: 12px; }
.send-actions { margin-top: 12px; font-size: 13px; color: #606266; }
.error-alert { margin-top: 16px; }
.confirm-search, .filter-column :deep(.el-input-number) { width: 100%; }
.filter-column :deep(.el-checkbox-group) { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-column :deep(.el-checkbox) { margin-right: 10px; }
.search-results { margin-top: 24px; }
.confirmed-filters { color: #337ecc; font-size: 14px; overflow-wrap: anywhere; }
.matched-house { display: flex; gap: 16px; border-top: 1px solid #ebeef5; padding: 20px 0; }
.matched-house img { width: 140px; height: 110px; object-fit: cover; border-radius: 6px; }
.matched-info { min-width: 0; flex: 1; }
.matched-info h3 { margin: 0; font-size: 16px; }
.matched-info p { font-size: 13px; margin: 8px 0; overflow-wrap: anywhere; }
.matched-info .price { font-size: 18px; font-weight: 600; color: #e66a23; }
.matched-info ul { padding-left: 18px; color: #606266; font-size: 13px; line-height: 1.8; }
@media (max-width: 850px) { .assistant-grid { grid-template-columns: 1fr; } .filter-column { position: static; grid-row: 1; } .assistant-main { padding: 12px; } .assistant-header { padding: 16px; flex-wrap: wrap; } .matched-house { flex-direction: column; } .matched-house img { width: 100%; height: 160px; } }
</style>
