import { pool } from '../config/db';
import { buildHouseSearchSql, type HouseQuery } from './filters';

export interface HouseRow extends Record<string, unknown> {
  id: number;
  title: string;
  price: number;
  location: string;
  image: string;
  description: string;
}
export interface HouseSearchResult { list: HouseRow[]; total: number; page: number; pageSize: number }
export type QueryRows = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
export interface HouseRepository { search(query: HouseQuery): Promise<HouseSearchResult> }

const queryRows: QueryRows = async (sql, params) => {
  const [rows] = await pool.query(sql, params);
  return rows as Record<string, unknown>[];
};

export function createHouseRepository(execute: QueryRows = queryRows): HouseRepository {
  return {
    async search(query) {
      const plan = buildHouseSearchSql(query);
      // list 与 total 使用同一 WHERE，翻页不再丢条件；排序仅来自服务端白名单。
      const [rows, count] = await Promise.all([execute(plan.listSql, plan.listParams), execute(plan.countSql, plan.countParams)]);
      const list: HouseRow[] = rows.map(row => ({
        ...row, id: Number(row.id), price: Number(row.price), title: String(row.title ?? ''),
        location: String(row.location ?? ''), image: String(row.image ?? ''), description: String(row.description ?? '')
      }));
      return { list, total: Number(count[0]?.total) || 0, page: query.page, pageSize: query.pageSize };
    }
  };
}

export const houseRepository = createHouseRepository();
