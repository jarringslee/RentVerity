import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import multer, { MulterError } from 'multer';
import { pool } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { AVATARS_DIR, UPLOADS_ROOT } from '../config/paths';
import {
  filterPreferenceKeys,
  parsePreferencesFromRow,
  serializePreferencesJson,
  normalizeCity,
  coerceGender
} from '../utils/userProfile';

const router = Router();

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, AVATARS_DIR);
  },
  filename: (req, file, cb) => {
    const userId = (req as { userId?: number }).userId ?? 0;
    const ext = path.extname(file.originalname) || '.jpg';
    const safeExt = /^\.(jpe?g|png|gif|webp)$/i.test(ext) ? ext.toLowerCase() : '.jpg';
    cb(null, `${userId}-${Date.now()}${safeExt}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 jpg、png、gif、webp 图片'));
  }
});

function publicUserFromRow(row: any) {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone,
    gender: coerceGender(row.gender),
    city: row.city ?? null,
    avatarUrl: row.avatar_url ?? null,
    preferences: parsePreferencesFromRow(row),
    createdAt: row.created_at
  };
}

function tryRemoveAvatarFile(avatarUrl: string | null | undefined) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return;
  if (!avatarUrl.startsWith('/uploads/avatars/')) return;
  const rel = avatarUrl.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOADS_ROOT, rel);
  if (abs.startsWith(AVATARS_DIR) && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
}

// 获取当前登录用户信息
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as number;

    const [rows] = await pool.query(
      'SELECT id, username, phone, gender, city, avatar_url, preference, preferences_json, created_at FROM users WHERE id = ? LIMIT 1',
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
      message:
        '获取用户信息失败（若提示未知列，请先执行 migrations/002_user_profile_extend.sql、003_user_avatar.sql）'
    });
  }
});

// 上传头像（multipart 字段名 avatar）
router.post(
  '/me/avatar',
  requireAuth,
  (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: '图片大小不能超过 2MB' });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      if (err) {
        return res.status(400).json({ success: false, message: '仅支持 jpg、png、gif、webp 图片' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const userId = (req as { userId?: number }).userId as number;
      const file = (req as { file?: { filename: string } }).file;
      if (!file) {
        return res.status(400).json({ success: false, message: '请选择图片文件' });
      }

      const relative = `/uploads/avatars/${file.filename}`;

      const [curRows] = await pool.query(
        'SELECT avatar_url FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      const cur = Array.isArray(curRows) ? (curRows[0] as { avatar_url?: string | null }) : null;
      tryRemoveAvatarFile(cur?.avatar_url ?? null);

      await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [relative, userId]);

      const [afterRows] = await pool.query(
        'SELECT id, username, phone, gender, city, avatar_url, preference, preferences_json, created_at FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      const updated = Array.isArray(afterRows) ? (afterRows[0] as any) : null;

      return res.json({
        success: true,
        message: '头像已更新',
        data: publicUserFromRow(updated)
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: '上传头像失败' });
    }
  }
);

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
      'preferences' in body ||
      'avatarUrl' in body;

    if (!has) {
      return res.status(400).json({ success: false, message: '请至少选择一项要修改的内容' });
    }

    const [currentRows] = await pool.query(
      'SELECT id, username, phone, gender, city, avatar_url, preference, preferences_json FROM users WHERE id = ? LIMIT 1',
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
    let finalAvatarUrl: string | null = current.avatar_url ?? null;

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

    if ('avatarUrl' in body) {
      const a = body.avatarUrl;
      if (a === null || a === undefined || a === '') {
        tryRemoveAvatarFile(finalAvatarUrl);
        finalAvatarUrl = null;
      } else {
        return res.status(400).json({
          success: false,
          message: '头像请通过上传接口修改；传 null 可恢复默认头像'
        });
      }
    }

    await pool.query(
      `UPDATE users SET username = ?, phone = ?, gender = ?, city = ?, avatar_url = ?, preference = ?, preferences_json = ? WHERE id = ?`,
      [finalUsername, finalPhone, finalGender, finalCity, finalAvatarUrl, finalLegacy, finalPrefsJson, userId]
    );

    const [afterRows] = await pool.query(
      'SELECT id, username, phone, gender, city, avatar_url, preference, preferences_json, created_at FROM users WHERE id = ? LIMIT 1',
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
