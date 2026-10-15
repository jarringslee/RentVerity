import '../config/env';
import mysql from 'mysql2/promise';
import { databaseName, initializeEmptyDatabase, seedDemoDatabase } from '../database/bootstrap';

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const target = databaseName(args.find(arg => arg.startsWith('--database='))?.slice('--database='.length));
  if (!['init', 'seed'].includes(mode) || !args.includes(mode === 'init' ? '--confirm-empty' : '--confirm-demo')) throw new Error('需要显式目标和 --confirm-empty / --confirm-demo；不会采用 DB_NAME 作为隐式目标。');
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try {
    if (mode === 'init') await initializeEmptyDatabase(connection, target);
    else await seedDemoDatabase(connection, target, process.env.DEMO_PASSWORD || '');
    console.log(mode === 'init' ? '空库初始化完成（已包含 002—006，不再重复执行）。' : '演示数据已写入：demo_landlord / demo_tenant；密码使用 DEMO_PASSWORD，号码与房源只用于演示。');
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error instanceof Error && !('sql' in error) ? error.message : '数据库操作失败；未输出连接配置或 SQL 参数。'); process.exitCode = 1; });
