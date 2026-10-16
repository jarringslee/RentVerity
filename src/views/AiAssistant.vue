<template>
  <div class="assistant-page">
    <header class="assistant-header">
      <div class="brand"><span class="brand-mark">R</span><div><h1>AI 租房助手</h1><p>安心租 RentVerity · 先明确城市，再查真实房源</p></div></div>
      <div class="header-actions"><el-button @click="router.push('/')">返回首页</el-button><el-button @click="router.push('/contract-analysis')">合同分析</el-button><HeaderUserMenu v-if="isLoggedIn" /></div>
    </header>
    <main class="assistant-main">
      <el-alert v-if="!isLoggedIn" title="请先登录，再使用 AI 租房助手。" type="info" :closable="false" show-icon><el-button @click="router.push('/login')">前往登录</el-button></el-alert>
      <section class="intro"><span class="eyebrow">LESS SEARCHING, MORE CLARITY</span><h2>告诉我，你想在哪里安家？</h2><p>从一句话开始。城市是必需条件，预算与房型可以慢慢补充。</p><div class="capabilities"><span>真实数据库房源</span><span>每次最多 6 套</span><span>不自动放宽条件</span></div></section>
      <section class="chat-shell">
        <div class="chat-toolbar"><div><span class="online-dot" />找房与租房问答</div><el-button text :disabled="!messages.length && !input" @click="clearConversation">清空会话</el-button></div>
        <p v-if="restored" class="restore-note">已恢复本标签页历史；旧房源卡片未缓存，需要重新查询当前库存。</p>
        <div ref="messagesPanel" class="messages" role="log" aria-label="AI 对话" aria-live="off" @scroll="onScroll">
          <div v-if="!messages.length" class="welcome"><span class="welcome-icon">⌂</span><h3>先给一个城市，就能开始找房。</h3><p>例如：西安，月租 3000 以内的一居室。<br />也可以问：第一次看房，需要检查什么？</p><small>地铁距离、通勤时间等暂不能精确筛选，不会假装已经满足。</small></div>
          <article v-for="message in messages" :key="message.id" class="message" :class="[message.role, message.status]">
            <div class="message-author"><span>{{ message.role === 'user' ? '你' : 'RentVerity' }}</span><small v-if="message.status === 'cancelled'">已停止 · 非完整回答</small><small v-else-if="message.status === 'failed'">未完成 · 可重试</small><small v-else-if="message.status === 'pending' && message.role === 'assistant'">{{ stageLabel }}</small></div>
            <p v-if="message.role === 'user'" class="user-text">{{ message.content }}</p>
            <AiMarkdown v-else-if="message.content" :content="message.content" />
            <div v-else-if="message.status === 'pending'" class="thinking"><i /><i /><i /><span>{{ stageLabel }}</span></div>
            <p v-else class="interrupted-text">本次未生成正文。</p>
            <AssistantHouseCards v-if="message.search" :result="message.search" />
            <el-button v-if="message.intent === 'contract_review'" size="small" @click="router.push('/contract-analysis')">前往合同分析</el-button>
          </article>
        </div>
        <div v-if="newContent && !followLatest" class="latest-bar"><el-button size="small" round @click="scrollToLatest">有新内容，回到最新 ↓</el-button></div>
        <div class="composer">
          <p v-if="hasConditions" class="current-conditions"><span>最近识别条件</span>{{ describeHouseFilters(filters) }}</p>
          <div class="quick-actions"><el-button size="small" round :disabled="busy || !isLoggedIn" @click="sendMessage('帮我找西安的房子，其他条件暂时不限')">西安找房</el-button><el-button size="small" round :disabled="busy || !isLoggedIn" @click="sendMessage('看房前应该检查哪些事项？')">看房检查清单</el-button></div>
          <label class="sr-only" for="assistant-input">描述城市和找房偏好，或提出租房问题</label>
          <el-input id="assistant-input" v-model="input" type="textarea" :rows="3" :maxlength="1500" show-word-limit placeholder="例如：西安高新区，一居室，月租 3000 以内…" :disabled="busy || !isLoggedIn" @keydown="onComposerKeydown" />
          <div class="send-actions"><span role="status" aria-live="polite">{{ busy ? stageLabel : statusMessage || 'Enter 发送 · Shift + Enter 换行' }}</span><div><el-button v-if="lastFailedPrompt && !busy" @click="sendMessage(lastFailedPrompt)">重试本轮</el-button><el-button v-if="busy" @click="stopRequest">停止生成</el-button><el-button type="primary" :disabled="!input.trim() || !isLoggedIn || busy" @click="sendMessage()">发送 →</el-button></div></div>
          <el-alert v-if="errorMessage" class="error-alert" :title="errorMessage" type="error" :closable="false" show-icon />
        </div>
      </section>
      <p class="disclaimer">AI 可能理解有误，请核对查询条件与卡片。仅作租房信息辅助，不代表房源认证或法律意见；请勿输入密码、密钥及私人合同内容。</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HeaderUserMenu from '../components/HeaderUserMenu.vue'
import AiMarkdown from '../components/AiMarkdown.vue'
import AssistantHouseCards from '../components/AssistantHouseCards.vue'
import userStore from '../stores/userStore'
import { streamAssistantMessage } from '../services/assistant'
import { emptyHouseFilters, type HouseFilters } from '../types/houses'
import type { AssistantMessage } from '../types/assistant'
import { cloneHouseFilters, describeHouseFilters, houseQueryFromUrl } from '../utils/houseFilters'
import { assistantHistory, clearAssistantSession, readAssistantSession, saveAssistantSession } from '../utils/assistantSession'

const router = useRouter(), route = useRoute()
const userId = computed(() => Number(userStore.currentUser.value?.id) || 0)
const isLoggedIn = computed(() => userStore.isLoggedIn())
const messages = ref<AssistantMessage[]>([]), input = ref(''), filters = ref<HouseFilters>(emptyHouseFilters())
const messagesPanel = ref<HTMLElement | null>(null), stage = ref<'idle' | 'understanding' | 'searching' | 'responding'>('idle')
const busy = computed(() => stage.value !== 'idle'), restored = ref(false), followLatest = ref(true), newContent = ref(false)
const errorMessage = ref(''), statusMessage = ref(''), lastFailedPrompt = ref('')
const hasConditions = computed(() => !!filters.value.city || !!filters.value.location || filters.value.minPrice != null || filters.value.maxPrice != null || !!filters.value.houseTypes.length)
const stageLabel = computed(() => ({ idle: '', understanding: '正在理解需求…', searching: '正在查找房源…', responding: '正在生成回复…' })[stage.value])
let controller: AbortController | null = null, runVersion = 0, ownerId = 0
let pendingUser: AssistantMessage | null = null, pendingAnswer: AssistantMessage | null = null
let filtersBeforeRun: HouseFilters | null = null
let deltaBuffer = '', flushTimer: ReturnType<typeof setTimeout> | undefined

function persist() { saveAssistantSession(ownerId, messages.value, filters.value) }
function onScroll() { const panel = messagesPanel.value; if (panel) followLatest.value = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80; if (followLatest.value) newContent.value = false }
function scrollToLatest() { followLatest.value = true; newContent.value = false; void nextTick(() => { const panel = messagesPanel.value; if (panel) panel.scrollTop = panel.scrollHeight }) }
function contentChanged() { if (followLatest.value) scrollToLatest(); else newContent.value = true }
function flushText() {
  clearTimeout(flushTimer); flushTimer = undefined
  if (pendingAnswer && deltaBuffer) { pendingAnswer.content += deltaBuffer; deltaBuffer = ''; contentChanged() }
}
function stopRequest() {
  ++runVersion; flushText(); controller?.abort(); controller = null
  if (pendingAnswer?.status === 'pending') { pendingAnswer.status = 'cancelled'; if (pendingUser) { pendingUser.status = 'cancelled'; lastFailedPrompt.value = pendingUser.content } statusMessage.value = '已停止；不会自动重试。取消不能保证模型未计费。' }
  if (filtersBeforeRun) filters.value = filtersBeforeRun
  filtersBeforeRun = null
  pendingUser = null; pendingAnswer = null; deltaBuffer = ''; stage.value = 'idle'; persist()
}
watch(userId, id => {
  stopRequest(); ownerId = id
  const saved = readAssistantSession(id); messages.value = saved.messages; filters.value = saved.filters
  input.value = ''; errorMessage.value = ''; lastFailedPrompt.value = ''; statusMessage.value = ''; restored.value = !!saved.messages.length
  if (id && ['city', 'location', 'minPrice', 'maxPrice', 'houseTypes'].some(key => route.query[key] != null)) {
    const entrance = houseQueryFromUrl(route.query)
    // 入口只填入待发送文本，必须由用户发送，不把 URL 条件冒充既有对话证据。
    input.value = `帮我找房，${describeHouseFilters(entrance)}${entrance.city ? '' : '，我还需要补充城市'}`
    void router.replace({ path: '/ai-assistant' })
  }
  scrollToLatest()
}, { immediate: true })

async function sendMessage(text?: string) {
  const message = (text ?? input.value).trim()
  if (!message || message.length > 1500 || busy.value || !isLoggedIn.value) return
  const history = assistantHistory(messages.value), version = ++runVersion
  filtersBeforeRun = cloneHouseFilters(filters.value)
  const user = reactive<AssistantMessage>({ id: crypto.randomUUID(), role: 'user', content: message, status: 'pending' })
  const answer = reactive<AssistantMessage>({ id: crypto.randomUUID(), role: 'assistant', content: '', status: 'pending' })
  messages.value = [...messages.value.slice(-22), user, answer]; pendingUser = user; pendingAnswer = answer
  deltaBuffer = ''; input.value = ''; errorMessage.value = ''; statusMessage.value = ''; lastFailedPrompt.value = ''
  stage.value = 'understanding'; controller = new AbortController(); const signal = controller.signal
  scrollToLatest()
  try {
    await streamAssistantMessage({ message, history, context: cloneHouseFilters(filters.value) }, signal, event => {
      if (version !== runVersion) return
      if (event.event === 'status') stage.value = event.data.stage
      else if (event.event === 'context') { answer.intent = event.data.intent; if (event.data.filters) { filters.value = cloneHouseFilters(event.data.filters); answer.filters = cloneHouseFilters(event.data.filters) } if (event.data.needsClarification) statusMessage.value = '请补充明确城市后继续。' }
      else if (event.event === 'houses') { answer.search = event.data; contentChanged() }
      else if (event.event === 'delta') { deltaBuffer += event.data.text; if (!flushTimer) flushTimer = setTimeout(flushText, 40) }
      else if (event.event === 'done') flushText()
    })
    if (version !== runVersion) return
    flushText(); user.status = 'complete'; answer.status = 'complete'; filtersBeforeRun = null; statusMessage.value ||= '回答完成，可继续补充或修改条件。'; persist()
  } catch (error) {
    if (version !== runVersion || signal.aborted) return
    flushText(); user.status = 'failed'; answer.status = 'failed'; lastFailedPrompt.value = message
    if (filtersBeforeRun) filters.value = filtersBeforeRun
    filtersBeforeRun = null
    errorMessage.value = error instanceof Error ? error.message : '回答中断，可以手动重试。'
    statusMessage.value = '本轮未完成，半截回复不会进入后续模型上下文。'
  } finally { if (version === runVersion) { clearTimeout(flushTimer); flushTimer = undefined; deltaBuffer = ''; pendingUser = null; pendingAnswer = null; stage.value = 'idle'; controller = null } }
}
function onComposerKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void sendMessage() } }
function clearConversation() { stopRequest(); messages.value = []; input.value = ''; filters.value = emptyHouseFilters(); restored.value = false; errorMessage.value = ''; lastFailedPrompt.value = ''; statusMessage.value = ''; clearAssistantSession(ownerId); scrollToLatest() }
onBeforeUnmount(() => { stopRequest(); persist() })
</script>

<style scoped>
.assistant-page { height: 100%; min-height: 0; display: flex; flex-direction: column; text-align: left; color: #263f4d; background: #f3f6f7; --el-color-primary: #287b88; }
.assistant-header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 32px; background: #fff; border-bottom: 1px solid #e3eaed; }
.brand, .header-actions, .capabilities, .chat-toolbar, .send-actions, .quick-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }.brand-mark { display: grid; place-items: center; width: 42px; height: 42px; background: #287b88; color: white; border-radius: 13px; font-size: 25px; font-weight: 700; }
h1 { font-size: 21px; line-height: 1.5; margin: 0; }.brand p { font-size: 12px; color: #7c8d96; margin: 3px 0 0; }
.assistant-main { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; max-width: 1000px; padding: 0 24px 12px; margin: 0 auto; }.intro { flex: none; padding: 24px 0 20px; }.eyebrow { color: #4c8c94; letter-spacing: .15em; font-size: 10px; font-weight: 650; }.intro h2 { font-size: clamp(23px, 4vw, 31px); margin: 10px 0; line-height: 1.4; }.intro p { color: #74858f; font-size: 14px; margin: 10px 0 17px; }.capabilities { gap: 8px; }.capabilities span { color: #51767d; background: #e6eeef; padding: 5px 10px; border-radius: 5px; font-size: 11px; }
.chat-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid #e0e8eb; border-radius: 17px; background: #fff; overflow: hidden; box-shadow: 0 10px 35px #203b4e06; }.chat-toolbar { flex: none; justify-content: space-between; padding: 12px 22px; border-bottom: 1px solid #eef1f4; font-size: 13px; }.online-dot { display: inline-block; width: 7px; height: 7px; margin-right: 8px; background: #3c9b91; border-radius: 50%; }
.messages { flex: 1; min-height: 0; padding: 10px 24px 20px; overflow-y: auto; overscroll-behavior: contain; }.welcome { text-align: center; padding: 30px 12px; color: #7b8f98; }.welcome-icon { font-size: 35px; color: #528c92; }.welcome h3 { font-size: 17px; font-weight: 550; color: #3b5a68; }.welcome p { font-size: 14px; line-height: 1.9; }.welcome small { display: block; font-size: 12px; line-height: 1.8; }
.message { padding: 16px 18px; margin: 14px 0; border-radius: 12px; min-width: 0; }.message.user { margin-left: 15%; background: #edf5f5; }.message.assistant { margin-right: 4%; background: #f8fafb; border: 1px solid #edf1f3; }.message-author { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #65808d; font-size: 11px; margin-bottom: 7px; }.message-author small { font-size: 11px; color: #8b9399; }.user-text { font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }.interrupted-text { font-size: 13px; color: #8a969f; }.failed, .cancelled { border-color: #eadfd2 !important; }
.thinking { display: flex; gap: 5px; align-items: center; min-height: 24px; }.thinking i { width: 5px; height: 5px; background: #83a8af; border-radius: 50%; animation: pulse 1.2s infinite; }.thinking i:nth-child(2) { animation-delay: .15s; }.thinking i:nth-child(3) { animation-delay: .3s; }.thinking span { font-size: 12px; color: #81939c; margin-left: 7px; }@keyframes pulse { 50% { opacity: .3; } }
.composer { flex: none; padding: 17px 22px 20px; border-top: 1px solid #e7edf0; }.quick-actions { gap: 8px; margin-bottom: 12px; }.send-actions { justify-content: space-between; margin-top: 12px; gap: 10px; }.send-actions > span { color: #8b989f; font-size: 11px; }.send-actions > div { display: flex; gap: 8px; }.send-actions :deep(.el-button + .el-button) { margin-left: 0; }.error-alert { margin-top: 12px; }.current-conditions { font-size: 12px; line-height: 1.8; color: #50727b; overflow-wrap: anywhere; margin: 0 0 13px; }.current-conditions span { display: inline-block; color: #89969d; margin-right: 10px; }.restore-note { flex: none; padding: 10px 24px; color: #8b9298; background: #faf9f5; font-size: 12px; line-height: 1.7; margin: 0; }.latest-bar { flex: none; text-align: center; padding: 7px; }.disclaimer { flex: none; text-align: center; font-size: 11px; color: #92a0a8; line-height: 1.8; padding: 0 18px; margin: 8px 0 0; }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
@media (prefers-reduced-motion: reduce) { .thinking i { animation: none; } }
@media (max-width: 600px) { .assistant-header { padding: 12px; flex-wrap: wrap; gap: 10px; }.header-actions { gap: 7px; }.assistant-main { padding: 0 8px 8px; }.eyebrow { display: none; }.intro { padding: 10px 3px; }.intro h2 { font-size: 21px; margin: 5px 0; }.intro p { line-height: 1.6; font-size: 12px; margin: 5px 0 10px; }.messages { padding: 8px 10px 12px; }.message { padding: 11px; }.message.user { margin-left: 9%; }.message.assistant { margin-right: 0; }.composer { padding: 10px; }.chat-toolbar { padding: 7px 12px; }.send-actions { align-items: flex-end; }.send-actions > span { flex: 1; line-height: 1.8; min-width: 100px; }.message-author { align-items: flex-start; }.disclaimer { font-size: 10px; padding: 0 5px; } }
@media (max-height: 650px) { .intro, .disclaimer { display: none; }.assistant-header { padding: 8px 12px; }.brand p { display: none; } }
</style>
