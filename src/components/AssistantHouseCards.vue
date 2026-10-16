<template>
  <section class="search-result" aria-label="数据库房源查询结果">
    <div class="result-heading"><strong>数据库房源</strong><span>{{ result.total }} 套匹配 · 展示 {{ result.list.length }} 套</span></div>
    <p class="conditions">{{ describeHouseFilters(result.filters) }}</p>
    <el-alert v-if="result.unavailablePreferences.length" :title="'暂不能精确筛选：' + result.unavailablePreferences.join('、') + '。下列房源不保证满足这些偏好，请进一步核实。'" type="warning" :closable="false" />
    <el-empty v-if="!result.list.length" description="没有符合条件的房源；没有自动放宽条件。" :image-size="64" />
    <div class="houses-grid">
      <article v-for="house in result.list" :key="house.id" class="house-card">
        <img :src="safeImage(house.image)" :alt="house.title" loading="lazy" decoding="async" @error="imageFallback" />
        <div class="house-content"><h3>{{ house.title }}</h3><p class="price">¥{{ house.price }}<small> / 月</small></p><p class="address">{{ house.location }}</p><p class="metadata">{{ [house.houseType, house.area ? house.area + '㎡' : null].filter(Boolean).join(' · ') || '更多资料请查看详情' }}</p>
          <ul><li v-for="reason in house.matchReasons" :key="reason">{{ reason }}</li></ul>
          <el-button size="small" @click="router.push(`/house/${house.id}`)">查看详情 →</el-button>
        </div>
      </article>
    </div>
    <p class="notice">{{ result.notice }}</p>
    <div class="result-actions"><el-button size="small" @click="router.push({ path: '/houses', query: houseFiltersToQuery({ ...result.filters, sort: 'price_asc' }) })">在列表查看全部</el-button><el-button size="small" @click="router.push({ path: '/map', query: houseFiltersToQuery(result.filters) })">带条件去地图</el-button></div>
  </section>
</template>
<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { AssistantSearchResult } from '../types/assistant'
import { describeHouseFilters, houseFiltersToQuery } from '../utils/houseFilters'
defineProps<{ result: AssistantSearchResult }>()
const router = useRouter()
const safeImage = (path: string) => /^(?:https?:\/\/|\/images\/)/i.test(path) ? path : '/images/houses/house-1.jpg'
function imageFallback(event: Event) { const image = event.target as HTMLImageElement; if (!image.dataset.fallback) { image.dataset.fallback = '1'; image.src = '/images/houses/house-1.jpg' } }
</script>
<style scoped>
.search-result { margin-top: 18px; border-top: 1px solid #e1e8ed; padding-top: 16px; }
.result-heading, .result-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.result-heading { justify-content: space-between; font-size: 14px; }.result-heading span { color: #6a7d88; font-size: 12px; }
.conditions { font-size: 13px; color: #376b7b; line-height: 1.7; }.houses-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.house-card { overflow: hidden; background: #fff; border: 1px solid #e1e8ed; border-radius: 12px; min-width: 0; }
.house-card img { width: 100%; height: 145px; object-fit: cover; display: block; background: #edf1f4; }.house-content { padding: 14px; }
h3 { font-size: 14px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }.price { color: #c66a35; font-size: 21px; font-weight: 650; margin: 8px 0; }.price small { font-size: 12px; font-weight: 400; color: #7e8b94; }
.address, .metadata { font-size: 12px; line-height: 1.6; color: #667a86; overflow-wrap: anywhere; }ul { padding-left: 16px; font-size: 12px; color: #69818a; line-height: 1.7; }
.notice { font-size: 12px; line-height: 1.7; color: #7b8c95; }
@media (max-width: 600px) { .houses-grid { grid-template-columns: 1fr; }.house-card img { height: 165px; } }
</style>
