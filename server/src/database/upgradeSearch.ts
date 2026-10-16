import type { Connection } from 'mysql2/promise';
import { databaseName } from './bootstrap';
import { inferLegacyHouse } from '../houses/catalog';

/** 先预览、显式 --apply 才写入；DDL 可重复运行，回填不覆盖已填字段。 */
export async function upgradeHouseSearch(connection: Connection, name: string, apply = false) {
  const target = databaseName(name);
  const [columns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [target, 'houses']);
  const names = new Set((columns as { COLUMN_NAME: string }[]).map(row => row.COLUMN_NAME));
  if (!['id', 'location', 'title', 'price'].every(field => names.has(field))) throw new Error('目标缺少预期 houses 表，拒绝迁移。');
  const [indexes] = await connection.query('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [target, 'houses']);
  const missing: string[] = [];
  if (!names.has('city')) missing.push("ADD COLUMN city VARCHAR(64) NULL COMMENT '标准城市名，旧地址未知时留空'");
  if (!names.has('house_type')) missing.push("ADD COLUMN house_type VARCHAR(16) NULL COMMENT '结构化房型，旧数据未知时留空'");
  if (!(indexes as { INDEX_NAME: string }[]).some(index => index.INDEX_NAME === 'idx_house_city_price')) missing.push('ADD INDEX idx_house_city_price (city, price, id)');
  const [rows] = await connection.query(`SELECT id, location, title, ${names.has('city') ? 'city' : 'NULL AS city'}, ${names.has('house_type') ? 'house_type' : 'NULL AS house_type'} FROM \`${target}\`.houses`);
  const candidates = (rows as { id: number; location: string; title: string; city: string | null; house_type: string | null }[]).map(row => ({ ...row, inferred: inferLegacyHouse(row) }));
  const summary = { database: target, apply, rows: candidates.length, ddlChanges: missing.length,
    cityBackfills: candidates.filter(row => row.city == null && row.inferred.city).length,
    typeBackfills: candidates.filter(row => row.house_type == null && row.inferred.houseType).length,
    unknownCities: candidates.filter(row => !row.city && !row.inferred.city).length };
  if (!apply) return summary;
  const lock = `rentverity_search_${target}`.slice(0, 64);
  const [locked] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
  if (Number((locked as { acquired: number }[])[0]?.acquired) !== 1) throw new Error('迁移已在运行，请勿并发执行。');
  try {
    if (missing.length) await connection.query(`ALTER TABLE \`${target}\`.houses ${missing.join(', ')}`);
    await connection.beginTransaction();
    try {
      for (const row of candidates) {
        if ((row.city == null && row.inferred.city) || (row.house_type == null && row.inferred.houseType)) {
          await connection.query(`UPDATE \`${target}\`.houses SET city = COALESCE(city, ?), house_type = COALESCE(house_type, ?) WHERE id = ?`, [row.inferred.city, row.inferred.houseType, row.id]);
        }
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
  } finally { await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
  return summary;
}
