import '../config/env';
import mysql from 'mysql2/promise';
import { upgradeHouseSearch } from '../database/upgradeSearch';

async function main() {
  const args = process.argv.slice(2);
  const database = args.find(arg => arg.startsWith('--database='))?.slice(11);
  if (!database || args.some(arg => !arg.startsWith('--database=') && arg !== '--apply')) throw new Error('请显式传 --database=目标库；默认只预览，--apply 才执行。');
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try { console.log(JSON.stringify(await upgradeHouseSearch(connection, database, args.includes('--apply')), null, 2)); }
  finally { await connection.end(); }
}
main().catch(() => { console.error('房源迁移失败；未输出凭据/SQL。请核对目标库和账号 ALTER/读写权限。'); process.exitCode = 1; });
