import { Router } from 'express';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';

const router = Router();

function normalizePair(me: number, peer: number) {
  const low = Math.min(me, peer);
  const high = Math.max(me, peer);
  return { low, high };
}

/** 创建或获取会话：需登录；若带 houseId，对方必须是该房源 owner_user_id */
router.post('/conversations', requireAuth, async (req, res) => {
  try {
    const me = (req as any).userId as number;
    const peerUserId = Number((req.body as { peerUserId?: number }).peerUserId);
    const houseIdRaw = (req.body as { houseId?: number | null | string }).houseId;

    if (!peerUserId || Number.isNaN(peerUserId) || peerUserId === me) {
      return res.status(400).json({ success: false, message: '无效的对方用户' });
    }

    const [peerRows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [peerUserId]);
    if (!Array.isArray(peerRows) || peerRows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    let houseId: number | null = null;
    let houseIdKey = 0;

    if (houseIdRaw !== undefined && houseIdRaw !== null && houseIdRaw !== '') {
      houseId = Number(houseIdRaw);
      if (Number.isNaN(houseId)) {
        return res.status(400).json({ success: false, message: '无效的房源' });
      }
      const [hRows] = await pool.query(
        'SELECT id, owner_user_id FROM houses WHERE id = ? LIMIT 1',
        [houseId]
      );
      const house = Array.isArray(hRows) ? (hRows[0] as any) : null;
      if (!house) {
        return res.status(404).json({ success: false, message: '房源不存在' });
      }
      if (house.owner_user_id == null || Number(house.owner_user_id) !== peerUserId) {
        return res.status(403).json({ success: false, message: '仅可与房源发布者就该房源沟通' });
      }
      houseIdKey = houseId;
    }

    const { low, high } = normalizePair(me, peerUserId);

    const [exist] = await pool.query(
      'SELECT id FROM chat_conversations WHERE user_low = ? AND user_high = ? AND house_id_key = ? LIMIT 1',
      [low, high, houseIdKey]
    );
    if (Array.isArray(exist) && exist.length > 0) {
      return res.json({
        success: true,
        message: 'ok',
        data: { id: (exist[0] as any).id }
      });
    }

    const [ins] = await pool.query(
      `INSERT INTO chat_conversations (house_id, house_id_key, user_low, user_high) VALUES (?, ?, ?, ?)`,
      [houseId, houseIdKey, low, high]
    );
    const insertId = (ins as { insertId: number }).insertId;

    await pool.query(
      `INSERT IGNORE INTO chat_user_state (user_id, conversation_id, last_read_message_id) VALUES (?, ?, 0), (?, ?, 0)`,
      [low, insertId, high, insertId]
    );

    return res.json({
      success: true,
      message: '已创建会话',
      data: { id: insertId }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '创建会话失败（若表不存在请执行 migrations/005_chat.sql）'
    });
  }
});

/** 我的会话列表 */
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const me = (req as any).userId as number;

    const [rows] = await pool.query(
      `
      SELECT
        c.id,
        c.house_id,
        c.last_message_at,
        c.last_message_preview,
        c.created_at,
        CASE WHEN c.user_low = ? THEN c.user_high ELSE c.user_low END AS peer_user_id,
        u.username AS peer_username,
        u.avatar_url AS peer_avatar_url,
        h.title AS house_title,
        (
          SELECT COUNT(*)
          FROM chat_messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id <> ?
            AND m.id > COALESCE(
              (SELECT s.last_read_message_id FROM chat_user_state s
               WHERE s.user_id = ? AND s.conversation_id = c.id),
              0
            )
        ) AS unread_count
      FROM chat_conversations c
      JOIN users u ON u.id = CASE WHEN c.user_low = ? THEN c.user_high ELSE c.user_low END
      LEFT JOIN houses h ON h.id = c.house_id
      WHERE c.user_low = ? OR c.user_high = ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      `,
      [me, me, me, me, me, me]
    );

    return res.json({
      success: true,
      message: 'ok',
      data: Array.isArray(rows) ? rows : []
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '获取会话列表失败' });
  }
});

/** 当前用户全部未读条数（首页角标） */
router.get('/unread-total', requireAuth, async (req, res) => {
  try {
    const me = (req as any).userId as number;
    const [rows] = await pool.query(
      `
      SELECT COALESCE(SUM(uc), 0) AS total
      FROM (
        SELECT (
          SELECT COUNT(*)
          FROM chat_messages m
          WHERE m.conversation_id = c.id
            AND m.sender_id <> ?
            AND m.id > COALESCE(
              (SELECT s.last_read_message_id FROM chat_user_state s
               WHERE s.user_id = ? AND s.conversation_id = c.id),
              0
            )
        ) AS uc
        FROM chat_conversations c
        WHERE c.user_low = ? OR c.user_high = ?
      ) t
      `,
      [me, me, me, me]
    );
    const total = Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as any).total) || 0 : 0;
    return res.json({ success: true, message: 'ok', data: { total } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '获取未读数失败（若表不存在请执行 migrations/006_chat_user_state.sql）'
    });
  }
});

/** 将会话标记为已读到当前最新消息 */
router.post('/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    const me = (req as any).userId as number;
    const convId = Number(req.params.id);
    if (!convId) {
      return res.status(400).json({ success: false, message: '无效的会话' });
    }

    const [cRows] = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = ? AND (user_low = ? OR user_high = ?) LIMIT 1',
      [convId, me, me]
    );
    if (!Array.isArray(cRows) || cRows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    const [maxRows] = await pool.query(
      'SELECT COALESCE(MAX(id), 0) AS mx FROM chat_messages WHERE conversation_id = ?',
      [convId]
    );
    const mx =
      Array.isArray(maxRows) && maxRows.length > 0 ? Number((maxRows[0] as any).mx) || 0 : 0;

    await pool.query(
      `INSERT INTO chat_user_state (user_id, conversation_id, last_read_message_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_message_id = ?, updated_at = CURRENT_TIMESTAMP(3)`,
      [me, convId, mx, mx]
    );

    return res.json({ success: true, message: 'ok', data: { lastReadMessageId: mx } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '标记已读失败' });
  }
});

/** 会话历史消息 */
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const me = (req as any).userId as number;
    const convId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;

    if (!convId) {
      return res.status(400).json({ success: false, message: '无效的会话' });
    }

    const [cRows] = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = ? AND (user_low = ? OR user_high = ?) LIMIT 1',
      [convId, me, me]
    );
    if (!Array.isArray(cRows) || cRows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    let sql = `
      SELECT id, conversation_id, sender_id, content, created_at
      FROM chat_messages
      WHERE conversation_id = ?
    `;
    const params: unknown[] = [convId];
    if (beforeId && !Number.isNaN(beforeId)) {
      sql += ' AND id < ?';
      params.push(beforeId);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const [msgRows] = await pool.query(sql, params);
    const list = Array.isArray(msgRows) ? [...msgRows].reverse() : [];

    return res.json({
      success: true,
      message: 'ok',
      data: list
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '获取消息失败' });
  }
});

export default router;
