import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';
import { pool } from '../config/db';

type JwtPayload = { userId: number };

const userSockets = new Map<number, Set<WebSocket>>();

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
  const wss = new WebSocketServer({ server, path: '/ws/chat' });

  wss.on('connection', (ws, req) => {
    let userId: number | null = null;
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'missing token');
        return;
      }
      const payload = jwt.verify(
        token,
        getJwtSecret()
      ) as JwtPayload;
      userId = payload.userId;
    } catch {
      ws.close(4002, 'invalid token');
      return;
    }

    addSocket(userId, ws);

    ws.on('message', async (data) => {
      let body: { type?: string; conversationId?: number; content?: string };
      try {
        body = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
        return;
      }

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

      const convId = Number(body.conversationId);
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
        if (conv.user_low !== userId && conv.user_high !== userId) {
          ws.send(JSON.stringify({ type: 'error', message: '无权在此会话发言' }));
          return;
        }

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

        broadcastToUsers([conv.user_low, conv.user_high], payload);
      } catch (e) {
        console.error(e);
        ws.send(JSON.stringify({ type: 'error', message: '发送失败' }));
      }
    });

    ws.on('close', () => {
      if (userId != null) removeSocket(userId, ws);
    });
  });

  return wss;
}
