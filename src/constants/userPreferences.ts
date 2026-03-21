/** 个人偏好多选项（value 与后端白名单一致） */
export const PERSONAL_PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'comfort-demand', label: '舒适度优先' },
  { value: 'effectiveness-demand', label: '性价比优先' },
  { value: 'transportatuon-demand', label: '交通便捷优先' },
  { value: 'facility-demand', label: '便民设施完善优先' },
  { value: 'price', label: '价格优先' },
  { value: 'location', label: '地段优先' },
  { value: 'environment', label: '环境优先' },
  { value: 'traffic', label: '交通优先' }
]

export const preferenceLabelMap: Record<string, string> = Object.fromEntries(
  PERSONAL_PREFERENCE_OPTIONS.map((o) => [o.value, o.label])
)
