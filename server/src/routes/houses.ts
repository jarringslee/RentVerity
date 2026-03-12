import { Router } from 'express';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 获取房源列表（简单分页）
router.get('/', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 10;

    const offset = (page - 1) * pageSize;

    const [listRows] = await pool.query(
      'SELECT * FROM houses ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );

    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM houses');
    const total = Array.isArray(countRows) ? (countRows[0] as any).total : 0;

    return res.json({
      success: true,
      message: '获取成功',
      data: {
        list: listRows,
        total,
        page,
        pageSize
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '获取房源列表失败' });
  }
});

// 根据ID获取房源详情
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: '无效的房源ID' });
    }

    const [rows] = await pool.query('SELECT * FROM houses WHERE id = ? LIMIT 1', [id]);
    const house = Array.isArray(rows) ? (rows[0] as any) : null;

    if (!house) {
      return res.status(404).json({ success: false, message: '房源不存在' });
    }

    return res.json({
      success: true,
      message: '获取成功',
      data: house
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '获取房源详情失败' });
  }
});

// 发布房源（简单版本）
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title,
      price,
      location,
      description,
      image,
      tags,
      riskLevel,
      area,
      floor,
      orientation,
      landlordName,
      landlordPhone
    } = req.body;

    if (!title || !price || !location) {
      return res.status(400).json({
        success: false,
        message: '标题、价格和位置为必填项'
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO houses 
      (title, price, location, description, image, tags, risk_level, area, floor, orientation, landlord_name, landlord_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        title,
        price,
        location,
        description || '',
        image || '/images/houses/house-1.jpg',
        Array.isArray(tags) ? tags.join(',') : tags || '',
        riskLevel || 'low',
        area || null,
        floor || '',
        orientation || '',
        landlordName || '房东',
        landlordPhone || ''
      ]
    );

    const insertResult = result as { insertId: number };

    return res.json({
      success: true,
      message: '发布成功',
      data: { id: insertResult.insertId }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '发布房源失败' });
  }
});

export default router;

