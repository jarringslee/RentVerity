import { createApp } from 'vue'  // 创建实例
import './style.css'  // 导入样式
import App from './App.vue'  // 导入项目的根组件
import router from './router'  // 路由
import ElementPlus from 'element-plus'  // 引入UI组件库
import 'element-plus/dist/index.css'

const app = createApp(App)
app.use(router)
app.use(ElementPlus)
app.mount('#app')