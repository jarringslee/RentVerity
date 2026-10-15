import fs from 'node:fs';
import path from 'node:path';
import type { Connection } from 'mysql2/promise';
import bcrypt from 'bcryptjs';

export function databaseName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error('请显式指定有效的目标库名，仅字母、数字、下划线。');
  return value;
}
export async function initializeEmptyDatabase(connection: Connection, name: string, onCreated?: (table: string) => void) {
  const target = databaseName(name);
  // SHOW TABLES 对不存在的库也会失败，不自动创建，更不会清空已有表。
  const [tables] = await connection.query(`SHOW TABLES FROM \`${target}\``);
  if (!Array.isArray(tables) || tables.length) throw new Error('目标库非空，拒绝初始化。现有环境请使用适用的历史迁移。');
  await connection.query(`USE \`${target}\``);
  const source = fs.readFileSync(path.resolve(__dirname, '../../database/schema.sql'), 'utf8');
  // 本快照仅含普通 CREATE TABLE；去除行注释后逐句执行，连接不启用 multipleStatements。
  const statements = source.replace(/^\s*--.*$/gm, '').split(';').map(statement => statement.trim()).filter(Boolean);
  for (const statement of statements) { await connection.query(statement); const table = /^CREATE TABLE ([a-z_]+)/i.exec(statement)?.[1]; if (table) onCreated?.(table); }
}
export async function seedDemoDatabase(connection: Connection, name: string, password: string) {
  const target = databaseName(name);
  if (!/^rentverity_demo(?:_[a-z0-9_]+)?$/.test(target)) throw new Error('演示数据仅可写入 rentverity_demo 或 rentverity_demo_* 库。');
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('请配置 DEMO_PASSWORD，至少 8 字符且最多 72 UTF-8 字节；脚本不会输出密码。');
  await connection.query(`USE \`${target}\``);
  const [rows] = await connection.query('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM houses) AS count');
  if (Number((rows as { count: number }[])[0]?.count) !== 0) throw new Error('目标演示库已有用户/房源，拒绝重复灌入。');
  const hash = await bcrypt.hash(password, 10);
  await connection.beginTransaction();
  try {
    const [result] = await connection.query("INSERT INTO users (username, phone, password_hash, gender) VALUES ('demo_landlord', '19900000001', ?, 'male'), ('demo_tenant', '19900000002', ?, 'female')", [hash, hash]);
    const landlordId = (result as { insertId: number }).insertId;
    await connection.query(`INSERT INTO houses (title, price, location, lng, lat, description, image, tags, area, owner_user_id, landlord_name) VALUES
      ('[演示] 高新区一居室', 2800, '西安市高新区（演示位置）', 108.94, 34.25, '仅供学习，坐标为演示点，不是可租赁的真实房源。', '/images/houses/house-1.jpg', '演示数据', 50, ?, '演示房东'),
      ('[演示] 两居室', 4200, '西安市（演示位置）', 108.98, 34.27, '仅供学习，坐标为演示点，不是可租赁的真实房源。', '/images/houses/house-2.jpg', '演示数据', 80, ?, '演示房东')`, [landlordId, landlordId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
}
