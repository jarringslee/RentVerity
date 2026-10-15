import { logSafeError } from '../utils/logSafeError';
import { Router } from 'express';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { parseHouseQuery } from '../houses/filters';
import { houseRepository, type HouseRepository } from '../houses/repository';
import { AppError } from '../utils/AppError';
import { positiveId, publishSchema, parseInput } from '../utils/validation';

export function createHousesRouter(repository: HouseRepository = houseRepository) {
const router = Router();

// 获取房源列表（简单分页）
router.get('/', async (req, res) => {
  try {
    const query = parseHouseQuery(req.query);
    const data = await repository.search(query);

    return res.json({
      success: true,
      message: '获取成功',
      data
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    logSafeError(err);
    return res.status(500).json({ success: false, message: '获取房源列表失败' });
  }
});

// 根据ID获取房源详情
router.get('/:id', async (req, res) => {
  try {
    const id = positiveId(req.params.id);
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
    logSafeError(err);
    return res.status(500).json({ success: false, message: '获取房源详情失败' });
  }
});

// 发布房源（简单版本）
router.post('/', requireAuth, async (req, res) => {
  const publisherId = (req as any).userId as number;
  try {
    const {
      title,
      price,
      location,
      lng,
      lat,
      description,
      image,
      tags,
      area,
      floor,
      orientation,
      landlordName,
      landlordPhone
    } = parseInput(publishSchema, req.body, '房源字段无效：租金和面积须为正整数，标题和位置必填；请检查坐标、标签、图片地址及联系方式。');

    if (!title || !price || !location) {
      return res.status(400).json({
        success: false,
        message: '标题、价格和位置为必填项'
      });
    }

    const lngVal = lng ?? null;
    const latVal = lat ?? null;

    const [result] = await pool.query(
      `
      INSERT INTO houses 
      (title, price, location, lng, lat, description, image, tags, area, floor, orientation, landlord_name, landlord_phone, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        title,
        price,
        location,
        lngVal,
        latVal,
        description || '',
        image || '/images/houses/house-1.jpg',
        Array.isArray(tags) ? tags.join(',') : tags || '',
        area || null,
        floor || '',
        orientation || '',
        landlordName || '房东',
        landlordPhone || '',
        publisherId
      ]
    );

    const insertResult = result as { insertId: number };

    return res.json({
      success: true,
      message: '发布成功',
      data: { id: insertResult.insertId }
    });
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    logSafeError(err);
    return res.status(500).json({ success: false, message: '发布房源失败' });
  }
});

return router;
}

export default createHousesRouter();

