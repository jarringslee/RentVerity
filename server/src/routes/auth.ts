import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';

const router = Router();

interface JwtPayload {
  userId: number;
}

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, phone, password, preference } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({ success: false, message: '用户名、手机号和密码不能为空' });
    }

    // 检查用户名或手机号是否已存在
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE username = ? OR phone = ? LIMIT 1',
      [username, phone]
    );

    const existing = Array.isArray(rows) ? rows[0] : undefined;
    if (existing) {
      return res.status(409).json({ success: false, message: '用户名或手机号已存在' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (username, phone, password_hash, preference) VALUES (?, ?, ?, ?)',
      [username, phone, passwordHash, preference || null]
    );

    const insertResult = result as { insertId: number };
    const userId = insertResult.insertId;

    const token = jwt.sign(
      { userId } as JwtPayload,
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: '注册成功',
      data: {
        id: userId,
        username,
        phone,
        preference: preference || null,
        token
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '注册失败，服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }

    const [rows] = await pool.query(
      'SELECT id, username, phone, password_hash, preference FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    const userRow = Array.isArray(rows) ? (rows[0] as any) : null;

    if (!userRow) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const isMatch = await bcrypt.compare(password, userRow.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { userId: userRow.id } as JwtPayload,
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: '登录成功',
      data: {
        id: userRow.id,
        username: userRow.username,
        phone: userRow.phone,
        preference: userRow.preference,
        token
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '登录失败，服务器错误' });
  }
});

export default router;

