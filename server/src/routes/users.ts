import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';
import {
  filterPreferenceKeys,
  parsePreferencesFromRow,
  serializePreferencesJson,
  normalizeCity,
  coerceGender
} from '../utils/userProfile';

const router = Router();

function publicUserFromRow(row: any) {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone,
    gender: coerceGender(row.gender),
    city: row.city ?? null,
    preferences: parsePreferencesFromRow(row),
    createdAt: row.created_at
  };
}

// 获取当前登录用户信息
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;

    const [rows] = await pool.query(
      'SELECT id, username, phone, gender, city, preference, preferences_json, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = Array.isArray(rows) ? (rows[0] as any) : null;

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    return res.json({
      success: true,
      message: '获取成功',
      data: publicUserFromRow(user)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '获取用户信息失败（若提示未知列，请先执行 migrations/002_user_profile_extend.sql）'
    });
  }
});

// 修改基本资料：用户名、手机号、性别、城市、个人偏好（多选）
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const body = req.body as Record<string, unknown>;

    const has =
      typeof body.username === 'string' ||
      typeof body.phone === 'string' ||
      'gender' in body ||
      'city' in body ||
      'preferences' in body;

    if (!has) {
      return res.status(400).json({ success: false, message: '请至少选择一项要修改的内容' });
    }

    const [currentRows] = await pool.query(
      'SELECT id, username, phone, gender, city, preference, preferences_json FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const current = Array.isArray(currentRows) ? (currentRows[0] as any) : null;
    if (!current) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    let finalUsername = current.username;
    let finalPhone = current.phone;
    let finalGender: 'male' | 'female' = coerceGender(current.gender);
    let finalCity: string | null = current.city ?? null;
    let finalPrefs = parsePreferencesFromRow(current);
    let finalPrefsJson = serializePreferencesJson(finalPrefs);
    let finalLegacy = finalPrefs[0] || null;

    if (typeof body.username === 'string') {
      const u = body.username.trim();
      if (!u) {
        return res.status(400).json({ success: false, message: '用户名不能为空' });
      }
      finalUsername = u;
      const [dupName] = await pool.query(
        'SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1',
        [finalUsername, userId]
      );
      if (Array.isArray(dupName) && dupName.length > 0) {
        return res.status(409).json({ success: false, message: '该用户名已被占用' });
      }
    }

    if (typeof body.phone === 'string') {
      const p = body.phone.trim();
      if (!p) {
        return res.status(400).json({ success: false, message: '手机号不能为空' });
      }
      if (!/^1[3-9]\d{9}$/.test(p)) {
        return res.status(400).json({ success: false, message: '手机号格式不正确' });
      }
      finalPhone = p;
      const [dupPhone] = await pool.query(
        'SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1',
        [finalPhone, userId]
      );
      if (Array.isArray(dupPhone) && dupPhone.length > 0) {
        return res.status(409).json({ success: false, message: '该手机号已被占用' });
      }
    }

    if ('gender' in body) {
      const g = body.gender;
      if (g === null || g === undefined || g === '') {
        finalGender = 'male';
      } else if (g === 'male' || g === 'female') {
        finalGender = g;
      } else {
        return res.status(400).json({ success: false, message: '性别取值无效' });
      }
    }

    if ('city' in body) {
      const c = body.city;
      if (c === null || c === undefined || c === '') {
        finalCity = null;
      } else if (typeof c === 'string') {
        const nc = normalizeCity(c);
        if (!nc) {
          return res.status(400).json({ success: false, message: '请选择有效的城市' });
        }
        finalCity = nc;
      } else {
        return res.status(400).json({ success: false, message: '城市格式无效' });
      }
    }

    if ('preferences' in body) {
      const arr = filterPreferenceKeys(body.preferences as unknown);
      finalPrefs = arr;
      finalPrefsJson = serializePreferencesJson(arr);
      finalLegacy = arr[0] || null;
    }

    await pool.query(
      `UPDATE users SET username = ?, phone = ?, gender = ?, city = ?, preference = ?, preferences_json = ? WHERE id = ?`,
      [finalUsername, finalPhone, finalGender, finalCity, finalLegacy, finalPrefsJson, userId]
    );

    const [afterRows] = await pool.query(
      'SELECT id, username, phone, gender, city, preference, preferences_json, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const updated = Array.isArray(afterRows) ? (afterRows[0] as any) : null;

    return res.json({
      success: true,
      message: '资料更新成功',
      data: publicUserFromRow(updated)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: '更新资料失败（若提示未知列，请先执行 migrations/002_user_profile_extend.sql）'
    });
  }
});

// 修改密码（需原密码；新密码不能与旧密码相同）
router.patch('/me/password', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请填写原密码和新密码' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '新密码长度至少为 6 位' });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ success: false, message: '新密码不能与旧密码一致' });
    }

    const [rows] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = Array.isArray(rows) ? (rows[0] as any) : null;
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok) {
      return res.status(400).json({ success: false, message: '原密码错误' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    return res.json({ success: true, message: '密码修改成功', data: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '修改密码失败' });
  }
});

export default router;
