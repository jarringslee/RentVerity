import { logSafeError } from '../utils/logSafeError';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { verifySession, type SessionClaims } from '../auth/session';
import { hasTrustedSource } from '../middleware/csrf';
import { pool } from '../config/db';
import { chatFrameSchema } from '../utils/validation';
import { SerialTaskQueue } from '../utils/serialQueue';

const userSockets = new Map<number, Set<WebSocket>>();
const sessionSockets = new Map<string, Set<WebSocket>>();

export function closeSessionSockets(sessionId: string) {
  for (const socket of sessionSockets.get(sessionId) || []) socket.close(4001, 'session ended');
}

function addSocket(userId: number, ws: WebSocket) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(ws);
}

function removeSocket(userId: number, ws: WebSocket) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) userSockets.delete(userId);
}

export function broadcastToUsers(userIds: number[], payload: object) {
  const raw = JSON.stringify(payload);
  for (const uid of userIds) {
    const set = userSockets.get(uid);
    if (!set) continue;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }
}

export function attachChatWss(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, handleProtocols: protocols => protocols.has('rentverity-chat') ? 'rentverity-chat' : false });
  // Cookie 会自动携带；先校验来源/身份，再升级协议，不能依赖 HTTP CORS。
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {});
    const reject = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
    if (req.url !== '/ws/chat') { reject('404 Not Found'); return; }
    if (!hasTrustedSource(req.headers, false)) { reject('403 Forbidden'); return; }
    try {
      const session = verifySession(req.headers);
      const protocols = (req.headers['sec-websocket-protocol'] || '').split(',').map(item => item.trim());
      // 第二个子协议只传非凭证的会话 ID，避免切账号竞态连到另一个身份。
      if (!protocols.includes('rentverity-chat') || !protocols.includes(`session.${session.jti}`)) { reject('409 Conflict'); return; }
      (req as IncomingMessage & { session: SessionClaims }).session = session;
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { reject('401 Unauthorized'); }
  };
  server.on('upgrade', upgrade);
  wss.once('close', () => server.off('upgrade', upgrade));

  wss.on('connection', (ws, req) => {
    // 包括鉴权失败期间的协议错误，均不能成为未处理的 error 事件。
    ws.on('error', () => {});
    const session = (req as IncomingMessage & { session: SessionClaims }).session;
    const userId = session.userId;
    addSocket(userId, ws);
    const connections = sessionSockets.get(session.jti) || new Set<WebSocket>();
    connections.add(ws); sessionSockets.set(session.jti, connections);
    const expiryTimer = setTimeout(() => ws.close(4001, 'session expired'), Math.max(0, session.exp * 1000 - Date.now()));
    expiryTimer.unref();

    const queue = new SerialTaskQueue(32, logSafeError);
    const processMessage = async (data: RawData) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() >= session.exp * 1000) { ws.close(4001, 'session expired'); return; }
      let input: unknown;
      try {
        input = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
        return;
      }

      const parsed = chatFrameSchema.safeParse(input);
      if (!parsed.success) { ws.send(JSON.stringify({ type: 'error', message: '消息格式无效：会话 ID 须为正整数，正文为 1—2000 字符。' })); return; }
      const body = parsed.data;
      if (body.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (body.type !== 'send' || !body.conversationId || body.content == null) {
        ws.send(JSON.stringify({ type: 'error', message: '缺少 conversationId 或 content' }));
        return;
      }

      const content = String(body.content).trim();
      if (!content) {
        ws.send(JSON.stringify({ type: 'error', message: '消息不能为空' }));
        return;
      }
      if (content.length > 2000) {
        ws.send(JSON.stringify({ type: 'error', message: '消息过长' }));
        return;
      }

      const convId = body.conversationId;
      try {
        const [cRows] = await pool.query(
          'SELECT id, user_low, user_high FROM chat_conversations WHERE id = ? LIMIT 1',
          [convId]
        );
        const conv = Array.isArray(cRows) ? (cRows[0] as any) : null;
        if (!conv) {
          ws.send(JSON.stringify({ type: 'error', message: '会话不存在' }));
          return;
        }
        if (Number(conv.user_low) !== userId && Number(conv.user_high) !== userId) {
          ws.send(JSON.stringify({ type: 'error', message: '无权在此会话发言' }));
          return;
        }

        if (ws.readyState !== WebSocket.OPEN || Date.now() >= session.exp * 1000) return;
        const [ins] = await pool.query(
          `INSERT INTO chat_messages (conversation_id, sender_id, content) VALUES (?, ?, ?)`,
          [convId, userId, content]
        );
        const rawId = (ins as { insertId: number | bigint }).insertId;
        const msgId = typeof rawId === 'bigint' ? Number(rawId) : rawId;

        const preview = content.length > 200 ? `${content.slice(0, 200)}…` : content;
        await pool.query(
          `UPDATE chat_conversations SET last_message_at = CURRENT_TIMESTAMP(3), last_message_preview = ? WHERE id = ?`,
          [preview, convId]
        );

        const [mRows] = await pool.query(
          'SELECT id, conversation_id, sender_id, content, created_at FROM chat_messages WHERE id = ? LIMIT 1',
          [msgId]
        );
        const row = Array.isArray(mRows) ? (mRows[0] as any) : null;
        if (!row) {
          ws.send(JSON.stringify({ type: 'error', message: '保存失败' }));
          return;
        }

        const payload = {
          type: 'message' as const,
          message: {
            id: row.id,
            conversationId: row.conversation_id,
            senderId: row.sender_id,
            content: row.content,
            createdAt: row.created_at
          }
        };

        broadcastToUsers([Number(conv.user_low), Number(conv.user_high)], payload);
      } catch (e) {
        logSafeError(e);
        ws.send(JSON.stringify({ type: 'error', message: '发送失败' }));
      }
    };
    ws.on('message', data => {
      if (!queue.enqueue(() => processMessage(data)) && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: '发送过快，待处理消息已达上限；本条未接收，请稍后手动重发。' }));
      }
    });

    ws.on('close', () => {
      clearTimeout(expiryTimer);
      removeSocket(userId, ws);
      connections.delete(ws);
      if (!connections.size) sessionSockets.delete(session.jti);
    });
  });

  return wss;
}
