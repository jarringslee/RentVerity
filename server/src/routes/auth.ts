import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import {
  filterPreferenceKeys,
  parsePreferencesFromRow,
  serializePreferencesJson,
  normalizeGender,
  normalizeCity,
  coerceGender
} from '../utils/userProfile';

const router = Router();

interface JwtPayload {
  userId: number;
}

function publicUserFromRow(row: any) {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone,
    gender: coerceGender(row.gender),
    city: row.city ?? null,
    preferences: parsePreferencesFromRow(row)
  };
}

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, phone, password, preference, preferences, gender, city } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({ success: false, message: '用户名、手机号和密码不能为空' });
    }

    const prefList = Array.isArray(preferences)
      ? preferences
      : preference
        ? [preference]
        : [];
    const filteredPrefs = filterPreferenceKeys(prefList);
    const preferencesJson = serializePreferencesJson(filteredPrefs);
    const legacyPreference = filteredPrefs[0] || null;

    let genderVal: 'male' | 'female' = 'male';
    if (gender !== undefined && gender !== null && gender !== '') {
      const g = normalizeGender(gender);
      if (!g) {
        return res.status(400).json({ success: false, message: '性别取值无效' });
      }
      genderVal = g;
    }

    let cityVal: string | null = null;
    if (city !== undefined && city !== null && city !== '') {
      const c = normalizeCity(city);
      if (!c) {
        return res.status(400).json({ success: false, message: '请选择有效的城市' });
      }
      cityVal = c;
    }

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
      `INSERT INTO users (username, phone, password_hash, preference, gender, city, preferences_json) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, phone, passwordHash, legacyPreference, genderVal, cityVal, preferencesJson]
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
        gender: genderVal,
        city: cityVal,
        preferences: filteredPrefs,
        token
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '注册失败，服务器错误（若提示未知列，请先执行 migrations/002_user_profile_extend.sql）'
    });
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
      'SELECT id, username, phone, password_hash, preference, gender, city, preferences_json FROM users WHERE username = ? LIMIT 1',
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
        ...publicUserFromRow(userRow),
        token
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '登录失败，服务器错误（若提示未知列，请先执行 migrations/002_user_profile_extend.sql）'
    });
  }
});

export default router;
