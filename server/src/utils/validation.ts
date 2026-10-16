import { z } from 'zod';
import { AppError } from './AppError';
import { normalizeHouseCity } from '../houses/catalog';
import { HOUSE_TYPES } from '../houses/filters';

export function positiveId(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
const password = z.string().min(6).refine(value => Buffer.byteLength(value, 'utf8') <= 72, '密码最多 72 个 UTF-8 字节');
export const passwordSchema = password;
export const registerSchema = z.object({
  username: z.string().trim().min(1).max(50), phone: z.string().trim().regex(/^1[3-9]\d{9}$/), password,
  gender: z.unknown().optional(), city: z.unknown().optional(), preference: z.unknown().optional(), preferences: z.unknown().optional()
});
export const loginSchema = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(256) });
const optionalText = (length: number) => z.string().trim().max(length).optional();
const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().optional();
export const publishSchema = z.strictObject({
  city: z.string().trim().refine(value => !!normalizeHouseCity(value), '请选择城市').transform(value => normalizeHouseCity(value)!),
  houseType: z.enum(HOUSE_TYPES),
  title: z.string().trim().min(1).max(120), price: z.number().int().positive().max(1000000),
  location: z.string().trim().min(1).max(255), lng: coordinate(70, 140), lat: coordinate(10, 55),
  description: optionalText(10000), image: z.string().trim().max(255).refine(value => !value || /^\/images\/[^\s]+$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value)).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).refine(tags => tags.join(',').length <= 255).optional(),
  area: z.number().int().positive().max(100000).nullable().optional(), floor: optionalText(40), orientation: optionalText(40),
  landlordName: optionalText(50), landlordPhone: z.string().trim().max(20).refine(value => !value || /^1[3-9]\d{9}$/.test(value)).optional()
}).refine(value => (value.lng == null) === (value.lat == null), '坐标必须同时提供');
export const chatFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('send'), conversationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), content: z.string().trim().min(1).max(2000) })
]);
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(400, 'INPUT_INVALID', message);
  return result.data;
}
export const isDuplicateKey = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';
