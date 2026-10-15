import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue')
  },
  {
    path: '/ai-assistant',
    name: 'AiAssistant',
    component: () => import('../views/AiAssistant.vue')
  },
  {
    path: '/contract-analysis',
    name: 'ContractAnalysis',
    component: () => import('../views/ContractAnalysis.vue')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/Register.vue')
  },
  {
    path: '/houses',
    name: 'Houses',
    component: () => import('../views/Houses.vue')
  },
  {
    path: '/house/:id',
    name: 'HouseDetail',
    component: () => import('../views/HouseDetail.vue')
  },
  {
    path: '/house-compare',
    name: 'HouseCompare',
    component: () => import('../views/HouseCompare.vue')
  },
  {
    path: '/map',
    name: 'Map',
    component: () => import('../views/Map.vue')
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('../views/Chat.vue')
  },
  {
    path: '/favorites',
    name: 'Favorites',
    component: () => import('../views/Favorites.vue')
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('../views/Profile.vue')
  },
  {
    path: '/publish',
    name: 'PublishHouse',
    component: () => import('../views/PublishHouse.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
