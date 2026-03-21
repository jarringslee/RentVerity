import { CHINA_CITY_SET } from '../constants/chinaCities';

/** 允许的个人偏好 key（与前端选项一致） */
export const PREFERENCE_WHITELIST = new Set([
  'price',
  'location',
  'environment',
  'traffic',
  'comfort-demand',
  'effectiveness-demand',
  'transportatuon-demand',
  'facility-demand'
]);

export function filterPreferenceKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const x of input) {
    if (typeof x !== 'string') continue;
    const k = x.trim();
    if (k && PREFERENCE_WHITELIST.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function parsePreferencesFromRow(row: {
  preferences_json?: string | null;
  preference?: string | null;
}): string[] {
  if (row.preferences_json) {
    try {
      const parsed = JSON.parse(row.preferences_json) as unknown;
      if (Array.isArray(parsed)) {
        return filterPreferenceKeys(parsed);
      }
    } catch {
      /* ignore */
    }
  }
  if (row.preference && String(row.preference).trim()) {
    return filterPreferenceKeys([row.preference]);
  }
  return [];
}

export function serializePreferencesJson(keys: string[]): string | null {
  const filtered = filterPreferenceKeys(keys);
  if (filtered.length === 0) return null;
  return JSON.stringify(filtered);
}

export function normalizeGender(input: unknown): 'male' | 'female' | null {
  if (input === 'male' || input === 'female') return input;
  if (input === '' || input === null || input === undefined) return null;
  return null;
}

/** 对外统一为男/女；库内 NULL 或旧数据视为男（默认） */
export function coerceGender(rowGender: unknown): 'male' | 'female' {
  return rowGender === 'female' ? 'female' : 'male';
}

export function normalizeCity(input: unknown): string | null {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input !== 'string') return null;
  const c = input.trim();
  if (!c) return null;
  if (!CHINA_CITY_SET.has(c)) return null;
  return c;
}
