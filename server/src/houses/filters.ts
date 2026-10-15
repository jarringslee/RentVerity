import { z } from 'zod';
import { AppError } from '../utils/AppError';

export const HOUSE_TYPES = ['一居室', '两居室', '三居室', '合租'] as const;
const shape = {
  location: z.string().trim().max(80).default(''),
  minPrice: z.number().finite().min(0).max(1000000).optional(),
  maxPrice: z.number().finite().min(0).max(1000000).optional(),
  houseTypes: z.array(z.enum(HOUSE_TYPES)).max(4).default([]).transform(types => [...new Set(types)])
};
const validRange = (value: { minPrice?: number; maxPrice?: number }) => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice;
export const boundsSchema = z.strictObject({
  west: z.number().finite().min(-180).max(180), south: z.number().finite().min(-90).max(90),
  east: z.number().finite().min(-180).max(180), north: z.number().finite().min(-90).max(90)
}).refine(bounds => bounds.west < bounds.east && bounds.south < bounds.north, '视野边界顺序不正确');
export const houseFiltersSchema = z.strictObject(shape).refine(validRange, '最低租金不能高于最高租金');
export const houseQuerySchema = z.strictObject({
  ...shape,
  bounds: boundsSchema.optional(),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
  sort: z.enum(['latest', 'price_asc', 'price_desc']).default('latest')
}).refine(validRange, '最低租金不能高于最高租金');
export type HouseFilters = z.infer<typeof houseFiltersSchema>;
export type HouseQuery = z.infer<typeof houseQuerySchema>;

export function parseHouseFilters(input: unknown): HouseFilters {
  const parsed = houseFiltersSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'HOUSE_FILTER_INVALID', '筛选条件无效，请检查位置、房型和租金上下限。');
  return parsed.data;
}

export function parseHouseQuery(raw: Record<string, unknown>): HouseQuery {
  const allowed = new Set(['location', 'minPrice', 'maxPrice', 'houseTypes', 'page', 'pageSize', 'sort', 'bounds']);
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key) || typeof value !== 'string') throw new AppError(400, 'HOUSE_QUERY_INVALID', '不支持的筛选参数或参数格式。');
    if (key === 'bounds') {
      const coordinates = value.split(',');
      if (coordinates.length !== 4 || coordinates.some(part => !part.trim())) throw new AppError(400, 'HOUSE_QUERY_INVALID', '视野格式应为 west,south,east,north。');
      const [west, south, east, north] = coordinates.map(Number);
      input.bounds = { west, south, east, north };
      continue;
    }
    if (value === '') continue;
    input[key] = ['minPrice', 'maxPrice', 'page', 'pageSize'].includes(key) ? Number(value) : key === 'houseTypes' ? value.split(',') : value;
  }
  const parsed = houseQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'HOUSE_QUERY_INVALID', '筛选或分页参数无效；每页最多 100 条，租金下限不能高于上限。');
  return parsed.data;
}

// 参数绑定防 SQL 注入；额外转义 LIKE 通配符，使用户输入的 %/_ 按字面匹配。
const likeValue = (value: string) => `%${value.replace(/[!%_]/g, char => `!${char}`)}%`;
const orderBy = { latest: 'created_at DESC, id DESC', price_asc: 'price ASC, id DESC', price_desc: 'price DESC, id DESC' } as const;

export function buildHouseSearchSql(query: HouseQuery) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.location) {
    clauses.push("(location LIKE ? ESCAPE '!' OR title LIKE ? ESCAPE '!')");
    params.push(likeValue(query.location), likeValue(query.location));
  }
  if (query.minPrice !== undefined) { clauses.push('price >= ?'); params.push(query.minPrice); }
  if (query.maxPrice !== undefined) { clauses.push('price <= ?'); params.push(query.maxPrice); }
  if (query.houseTypes.length) {
    clauses.push(`(${query.houseTypes.map(() => "title LIKE ? ESCAPE '!'").join(' OR ')})`);
    params.push(...query.houseTypes.map(likeValue));
  }
  if (query.bounds) {
    // 坐标为百度 BD-09；没有坐标的房源不会冒充视野内候选，仍可在不限视野列表查看。
    clauses.push('lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?');
    params.push(query.bounds.west, query.bounds.east, query.bounds.south, query.bounds.north);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return {
    listSql: `SELECT * FROM houses${where} ORDER BY ${orderBy[query.sort]} LIMIT ? OFFSET ?`,
    listParams: [...params, query.pageSize, (query.page - 1) * query.pageSize],
    countSql: `SELECT COUNT(*) AS total FROM houses${where}`,
    countParams: [...params]
  };
}
