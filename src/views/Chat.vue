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
        <el-row :gutter="20" class="chat-row">
          <el-col :span="24" :md="6">
            <el-card class="contacts-card" shadow="never">
              <template #header>
                <h3 class="card-title">会话</h3>
              </template>

              <div v-if="convLoading" class="list-loading">加载中…</div>
              <div v-else-if="conversationError" class="list-empty" role="alert">{{ conversationError }}<el-button text @click="loadConversations">重新加载会话</el-button></div>
              <div v-else-if="conversations.length === 0" class="list-empty">
                暂无会话，在房源详情页联系房东开始聊天
              </div>
              <div v-else class="contacts-list">
                <div
                  v-for="c in conversations"
                  :key="c.id"
                  :data-conversation-id="c.id"
                  class="contact-item"
                  :class="{ active: activeConversationId === c.id }"
                  @click="selectConversation(c)"
                >
                  <el-avatar :src="peerAvatar(c)" :size="40" />
                  <div class="contact-info">
                    <div class="contact-name-row">
                      <span class="contact-name">{{ c.peer_username }}</span>
                      <el-badge
                        v-if="convUnreadCount(c) > 0"
                        :value="convUnreadCount(c)"
                        :max="99"
                        class="contact-unread-badge"
                      />
                    </div>
                    <div class="last-message">
                      <span v-if="c.house_title" class="house-tag">{{
                        c.house_title
                      }}</span>
                      {{ c.last_message_preview || "暂无消息" }}
                    </div>
                  </div>
                  <div class="contact-time">
                    {{ formatShortTime(c.last_message_at) }}
                  </div>
                </div>
              </div>
            </el-card>
          </el-col>

          <el-col :span="24" :md="18">
            <el-card class="chat-card" shadow="never">
              <div v-if="!activeConversationId" class="chat-placeholder">
                <p>请选择左侧会话</p>
              </div>
              <template v-else>
                <div class="chat-header">
                  <div class="chat-partner">
                    <el-avatar :src="peerAvatar(activeConv)" :size="40" />
                    <div class="partner-meta">
                      <span class="partner-name">{{
                        activeConv?.peer_username
                      }}</span>
                      <span
                        v-if="activeConv?.house_title"
                        class="partner-house"
                        >{{ activeConv.house_title }}</span
                      >
                    </div>
                  </div>
                  <el-tag
                    v-if="wsConnected"
                    type="success"
                    size="small"
                    effect="plain"
                    >已连接</el-tag
                  >
                  <el-tag v-else type="info" size="small" effect="plain"
                    >{{ wsConnecting ? '连接中…' : '已断开' }}</el-tag
                  >
                  <el-button v-if="!wsConnected && !wsConnecting" size="small" @click="connectWs">重新连接</el-button>
                </div>

                <div ref="messagesEl" class="messages-container" @scroll="scheduleRead">
                  <div class="history-controls">
                    <el-button v-if="hasOlder" size="small" :loading="historyLoading" :disabled="latestLoading || messages.length >= CHAT_RENDER_LIMIT" @click="loadHistory(true)">加载更早消息</el-button>
                    <span v-else-if="messages.length">已到最早记录</span>
                    <span v-if="messages.length >= CHAT_RENDER_LIMIT">当前最多展示 {{ CHAT_RENDER_LIMIT }} 条；重新选择会话可回到最新。</span>
                    <span v-if="latestLoading" role="status">正在同步最近消息…</span>
                    <el-button v-if="historyError" text type="danger" @click="loadHistory(failedOlder)">{{ historyError }}，点击重试</el-button>
                  </div>
                  <div
                    v-for="m in messages"
                    :key="m.id"
                    :data-message-id="m.id"
                    class="message"
                    :class="{ 'message-mine': isMine(m) }"
                  >
                    <div class="message-bubble">
                      <div class="message-text">{{ m.content }}</div>
                      <div class="message-time">
                        {{ formatMsgTime(m.createdAt) }}
                      </div>
                    </div>
                  </div>
                </div>

                <div class="input-area">
                  <el-input
                    v-model="newMessage"
                    type="textarea"
                    :rows="3"
                    :maxlength="2000"
                    placeholder="输入消息后发送"
                    @keydown.enter.exact.prevent="handleSendMessage"
                  />
                  <div class="send-button">
                    <el-button
                      type="primary"
                      :disabled="!wsConnected || latestLoading"
                      @click="handleSendMessage"
                    >
                      发送
                    </el-button>
                  </div>
                </div>
                <p v-if="connectionNote" class="connection-note" role="status">{{ connectionNote }}</p>
              </template>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import userStore from "../stores/userStore";
import HeaderUserMenu from "../components/HeaderUserMenu.vue";
import {
  getChatWsUrl,
  ensureChatConversation,
  fetchChatConversations,
  fetchChatMessages,
  markChatConversationRead,
} from "../services/api";
import { resolveAvatarSrc } from "../utils/avatarUrl";
import { CHAT_PAGE_SIZE, CHAT_RENDER_LIMIT, mergeChatMessages, parseChatMessage, type ChatMessage } from '../utils/chatMessages';

interface ConversationRow {
  id: number;
  house_id: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  peer_user_id: number;
  peer_username: string;
  peer_avatar_url: string | null;
  house_title: string | null;
  unread_count?: number;
}

const route = useRoute();
const router = useRouter();
const isLoggedIn = computed(() => userStore.isLoggedIn());
const currentUserId = computed(
  () => Number(userStore.currentUser.value?.id) || 0
);

const conversations = reactive<ConversationRow[]>([]);
const convLoading = ref(false);
const activeConversationId = ref<number | null>(null);
const messages = reactive<ChatMessage[]>([]);
const newMessage = ref("");
const messagesEl = ref<HTMLElement | null>(null);

const wsConnected = ref(false);
const wsConnecting = ref(false);
let disposed = false, selectionVersion = 0;
let socket: WebSocket | null = null;
const conversationError = ref(''), historyError = ref(''), connectionNote = ref('');
const historyLoading = ref(false), latestLoading = ref(false), hasOlder = ref(false);
let beforeId: number | undefined, failedOlder = false, connectedOnce = false;
let historyController: AbortController | null = null;
let readTimer: ReturnType<typeof setTimeout> | undefined;
const readSent = new Map<number, number>();
const seenEvents = new Set<number>(), previewIds = new Map<number, number>();

const activeConv = computed(() =>
  conversations.find((c) => c.id === activeConversationId.value)
);

function peerAvatar(c: ConversationRow | undefined) {
  if (!c) return resolveAvatarSrc(null);
  return resolveAvatarSrc(c.peer_avatar_url);
}

function isMine(m: ChatMessage) {
  return m.sender_id === currentUserId.value;
}

function convUnreadCount(c: ConversationRow) {
  const n = Number(c.unread_count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatShortTime(raw: string | null) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (now.getTime() - d.getTime() < 86400000) {
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatMsgTime(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scrollToBottom() {
  nextTick(() => {
    if (disposed) return;
    const el = messagesEl.value;
    if (el) el.scrollTop = el.scrollHeight;
    scheduleRead();
  });
}

function nearBottom() { const el = messagesEl.value; return !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 60; }
function scheduleRead() {
  clearTimeout(readTimer);
  if (disposed || latestLoading.value || document.visibilityState !== 'visible' || !nearBottom()) return;
  const id = activeConversationId.value, cursor = messages[messages.length - 1]?.id;
  if (!id || !cursor || cursor <= (readSent.get(id) ?? 0)) return;
  readTimer = setTimeout(async () => {
    if (disposed || activeConversationId.value !== id || document.visibilityState !== 'visible' || !nearBottom()) return;
    const previous = readSent.get(id) ?? 0;
    readSent.set(id, cursor);
    try {
      const res = await markChatConversationRead(id, cursor);
      if (!res.success) throw new Error();
      const conv = conversations.find(c => c.id === id);
      if (!disposed && activeConversationId.value === id && (messages[messages.length - 1]?.id ?? 0) <= cursor && conv) conv.unread_count = 0;
    } catch { if (readSent.get(id) === cursor) readSent.set(id, previous); }
  }, 150);
}

function mergeMessages(incoming: ChatMessage[]) {
  messages.splice(0, messages.length, ...mergeChatMessages(messages, incoming));
}

async function loadHistory(older = false) {
  const id = activeConversationId.value;
  if (!id || (older && (historyLoading.value || latestLoading.value || !beforeId || messages.length >= CHAT_RENDER_LIMIT))) return;
  historyController?.abort();
  const controller = new AbortController(); historyController = controller;
  const deadline = AbortSignal.timeout(15000);
  const signal = AbortSignal.any([controller.signal, deadline]);
  const version = selectionVersion;
  const container = messagesEl.value, oldHeight = container?.scrollHeight ?? 0, oldTop = container?.scrollTop ?? 0;
  latestLoading.value = !older; historyLoading.value = older; historyError.value = ''; failedOlder = older;
  const limit = older ? Math.min(CHAT_PAGE_SIZE, CHAT_RENDER_LIMIT - messages.length) : CHAT_PAGE_SIZE;
  try {
    const res = await fetchChatMessages(id, { limit, ...(older ? { beforeId } : {}) }, signal);
    if (disposed || version !== selectionVersion || activeConversationId.value !== id || controller.signal.aborted) return;
    if (!res.success || !Array.isArray(res.data)) throw new Error(res.message || '消息加载失败');
    const rows = (res.data as Record<string, unknown>[]).map(parseChatMessage).sort((a,b) => a.id-b.id);
    mergeMessages(rows);
    beforeId = rows[0]?.id;
    hasOlder.value = rows.length === limit;
    for (const row of rows) seenEvents.add(row.id);
    if (seenEvents.size > 2000) { seenEvents.clear(); for (const row of messages) seenEvents.add(row.id); }
    await nextTick();
    if (disposed || version !== selectionVersion) return;
    if (older && container) container.scrollTop = oldTop + container.scrollHeight - oldHeight;
    else scrollToBottom();
  } catch (error) {
    if (disposed || controller.signal.aborted || version !== selectionVersion) return;
    historyError.value = deadline.aborted ? '消息加载超时' : error instanceof Error ? error.message : '消息加载失败';
  } finally {
    if (historyController === controller) { latestLoading.value = false; historyLoading.value = false; historyController = null; scheduleRead(); }
  }
}

async function loadConversations() {
  convLoading.value = true;
  conversationError.value = '';
  try {
    const res = await fetchChatConversations();
    if (disposed) return;
    if (res.success && Array.isArray(res.data)) {
      const rows: ConversationRow[] = (res.data as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id),
        house_id: r.house_id == null ? null : Number(r.house_id),
        last_message_at: r.last_message_at == null ? null : String(r.last_message_at),
        last_message_preview: r.last_message_preview == null ? null : String(r.last_message_preview),
        created_at: String(r.created_at ?? ''),
        peer_user_id: Number(r.peer_user_id),
        peer_username: String(r.peer_username ?? ''),
        peer_avatar_url: r.peer_avatar_url == null ? null : String(r.peer_avatar_url),
        house_title: r.house_title == null ? null : String(r.house_title),
        unread_count: Number(r.unread_count) || 0,
      }));
      conversations.splice(0, conversations.length, ...rows);
    } else {
      throw new Error((res as { message?: string }).message || "加载会话失败");
    }
  } catch (error) { if (!disposed) conversationError.value = error instanceof Error ? error.message : '会话加载失败';
  } finally {
    convLoading.value = false;
  }
}

function applyIncomingMessage(payload: {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
}) {
  if (seenEvents.has(payload.id)) return;
  seenEvents.add(payload.id);
  if (seenEvents.size > 2000) { seenEvents.clear(); seenEvents.add(payload.id); }
  const follow = nearBottom();
  const fromPeer = payload.senderId !== currentUserId.value;
  const conv = conversations.find((c) => c.id === payload.conversationId);
  if (conv) {
    if (payload.id >= (previewIds.get(payload.conversationId) ?? 0)) {
      previewIds.set(payload.conversationId, payload.id);
      conv.last_message_at = payload.createdAt;
      conv.last_message_preview = payload.content;
    }
    if (fromPeer && payload.id > (readSent.get(payload.conversationId) ?? 0)) {
      conv.unread_count = convUnreadCount(conv) + 1;
    }
    conversations.sort(
      (a, b) =>
        new Date(b.last_message_at || b.created_at).getTime() -
        new Date(a.last_message_at || a.created_at).getTime()
    );
  }

  if (payload.conversationId === activeConversationId.value) {
      mergeMessages([{
        id: payload.id,
        conversation_id: payload.conversationId,
        sender_id: payload.senderId,
        content: payload.content,
        createdAt: payload.createdAt,
      }]);
      if (follow || !fromPeer) scrollToBottom();
  }
}

function connectWs() {
  const url = getChatWsUrl();
  if (!url) return;
  socket?.close();
  const connection = new WebSocket(url);
  socket = connection;
  wsConnected.value = false;
  wsConnecting.value = true;

  socket.onopen = () => {
    if (socket !== connection || disposed) return;
    wsConnected.value = true;
    wsConnecting.value = false;
    if (connectedOnce) {
      connectionNote.value = '已重新连接，正在同步最近消息；更早记录可分页查看。';
      const current = activeConv.value;
      void loadConversations();
      if (current) void selectConversation(current);
    }
    connectedOnce = true;
  };

  socket.onclose = () => {
    if (socket !== connection || disposed) return;
    wsConnected.value = false;
    wsConnecting.value = false;
    connectionNote.value = '连接已断开，草稿保留；重新连接后同步历史，不会自动重发消息。';
  };

  socket.onerror = () => {
    if (socket !== connection || disposed) return;
    wsConnected.value = false;
    wsConnecting.value = false;
  };

  socket.onmessage = (ev) => {
    if (socket !== connection || disposed) return;
    try {
      const data = JSON.parse(ev.data as string);
      if (data.type === "message" && data.message) {
        const m = data.message;
        applyIncomingMessage({
          id: Number(m.id),
          conversationId: Number(m.conversationId),
          senderId: Number(m.senderId),
          content: String(m.content),
          createdAt:
            typeof m.createdAt === "string"
              ? m.createdAt
              : new Date(m.createdAt).toISOString(),
        });
      } else if (data.type === "error") {
        ElMessage.error(data.message || "聊天错误");
      }
    } catch {
      /* ignore */
    }
  };
}

async function selectConversation(c: ConversationRow) {
  ++selectionVersion;
  activeConversationId.value = c.id;
  if (String(route.query.c) !== String(c.id)) {
    router.replace({ path: "/chat", query: { c: String(c.id) } });
  }
  messages.splice(0, messages.length);
  hasOlder.value = false; beforeId = undefined;
  clearTimeout(readTimer);
  await loadHistory();
}

async function selectConversationById(id: number) {
  const c = conversations.find((x) => x.id === id);
  if (c) {
    await selectConversation(c);
    return;
  }
  await loadConversations();
  const again = conversations.find((x) => x.id === id);
  if (again) await selectConversation(again);
}

async function openFromQuery() {
  const c = route.query.c ? Number(route.query.c) : NaN;
  if (!Number.isNaN(c) && c > 0) {
    await selectConversationById(c);
    return;
  }

  const peerId = route.query.peerId ? Number(route.query.peerId) : NaN;
  const houseId = route.query.houseId ? Number(route.query.houseId) : NaN;
  if (!Number.isNaN(peerId) && peerId > 0) {
    const res = await ensureChatConversation({
      peerUserId: peerId,
      houseId: !Number.isNaN(houseId) && houseId > 0 ? houseId : null,
    });
    if (res.success && (res as { data?: { id: number } }).data?.id) {
      const id = (res as { data: { id: number } }).data.id;
      await loadConversations();
      router.replace({ path: "/chat", query: { c: String(id) } });
      await selectConversationById(id);
    } else {
      ElMessage.error((res as { message?: string }).message || "无法打开会话");
    }
  }
}

function handleSendMessage() {
  const text = newMessage.value.trim();
  if (
    !text ||
    latestLoading.value ||
    !activeConversationId.value ||
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: "send",
      conversationId: activeConversationId.value,
      content: text,
    })
  );
  newMessage.value = "";
}

onMounted(async () => {
  document.addEventListener('visibilitychange', scheduleRead);
  if (!isLoggedIn.value) {
    router.push("/login");
    return;
  }
  await loadConversations();
  if (disposed) return;
  connectWs();
  await openFromQuery();
});

onUnmounted(() => {
  disposed = true; ++selectionVersion;
  clearTimeout(readTimer); historyController?.abort();
  document.removeEventListener('visibilitychange', scheduleRead);
  socket?.close();
  socket = null;
});
</script>

<style scoped>
.history-controls { display: grid; justify-items: center; gap: 8px; font-size: 12px; color: #77838e; margin: 8px 0 16px; }
.connection-note { font-size: 12px; color: #677b8b; margin: 10px 0 0; }
.full-height {
  height: 100vh;
}

.header {
  height: auto;
  min-height: 60px;
  padding: 12px 20px;
  gap: 12px;
  flex-wrap: wrap;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #409eff;
  color: white;
}
.header h1 { font-size: 24px; line-height: 1.3; margin: 0; }

.nav {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-row {
  height: calc(100vh - 120px);
}

.contacts-card,
.chat-card {
  height: 100%;
  min-height: 480px;
}

.card-title {
  margin: 0;
  font-size: 16px;
}

.list-loading,
.list-empty {
  padding: 16px;
  color: #909399;
  font-size: 13px;
}

.contacts-list {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: flex-start;
  padding: 10px 8px;
  cursor: pointer;
  border-radius: 8px;
  gap: 10px;
}

.contact-item:hover {
  background-color: #f5f7fa;
}

.contact-item.active {
  background-color: #ecf5ff;
}

.contact-info {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.contact-name-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.contact-name {
  font-weight: 600;
  font-size: 14px;
  text-align: left;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-unread-badge :deep(.el-badge__content) {
  border: none;
}

.last-message {
  text-align: left;
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.house-tag {
  color: #409eff;
  margin-right: 4px;
}

.contact-time {
  font-size: 11px;
  color: #c0c4cc;
  flex-shrink: 0;
}

.chat-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: #909399;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 8px;
}

.chat-partner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.partner-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.partner-name {
  font-weight: 600;
  font-size: 15px;
}

.partner-house {
  font-size: 12px;
  color: #909399;
}

.messages-container {
  height: calc(100vh - 320px);
  min-height: 240px;
  overflow-y: auto;
  padding: 12px 0;
}

.message {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 12px;
}

.message-mine {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 12px;
  background: #f0f2f5;
}

.message-mine .message-bubble {
  background: #409eff;
  color: #fff;
}

.message-text {
  word-break: break-word;
  line-height: 1.5;
  font-size: 14px;
}

.message-time {
  font-size: 11px;
  margin-top: 6px;
  opacity: 0.85;
}

.message-mine .message-time {
  text-align: right;
}

.input-area {
  /* resize: none; */
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.send-button {
  margin-top: 10px;
  text-align: right;
}

@media (max-width: 768px) {
  .chat-row {
    height: auto;
  }

  .contacts-card,
  .chat-card {
    min-height: 320px;
  }

  .messages-container {
    height: 280px;
  }
}
</style>
