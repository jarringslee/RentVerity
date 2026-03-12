import { Router } from 'express';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 获取当前用户收藏列表
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;

    const [rows] = await pool.query(
      `
      SELECT h.*
      FROM favorites f
      INNER JOIN houses h ON h.id = f.house_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      message: '获取成功',
      data: rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '获取收藏失败' });
  }
});

// 检查某个房源是否已收藏
router.get('/check/:houseId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const houseId = Number(req.params.houseId);
    if (!houseId) {
      return res.status(400).json({ success: false, message: '无效的房源ID', data: false });
    }

    const [rows] = await pool.query(
      'SELECT 1 AS ok FROM favorites WHERE user_id = ? AND house_id = ? LIMIT 1',
      [userId, houseId]
    );

    const isFav = Array.isArray(rows) && rows.length > 0;
    return res.json({ success: true, message: '查询成功', data: isFav });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '查询失败', data: false });
  }
});

// 添加收藏
router.post('/:houseId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const houseId = Number(req.params.houseId);
    if (!houseId) {
      return res.status(400).json({ success: false, message: '无效的房源ID' });
    }

    await pool.query(
      'INSERT IGNORE INTO favorites (user_id, house_id) VALUES (?, ?)',
      [userId, houseId]
    );

    return res.json({ success: true, message: '收藏成功', data: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '收藏失败' });
  }
});

// 取消收藏
router.delete('/:houseId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const houseId = Number(req.params.houseId);
    if (!houseId) {
      return res.status(400).json({ success: false, message: '无效的房源ID' });
    }

    await pool.query('DELETE FROM favorites WHERE user_id = ? AND house_id = ?', [userId, houseId]);
    return res.json({ success: true, message: '取消收藏成功', data: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '取消收藏失败' });
  }
});

export default router;

