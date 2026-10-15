import { defineConfig, normalizePath } from 'vite'
import path from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: ['cmaps', 'standard_fonts'].map(folder => ({
        src: normalizePath(path.resolve('node_modules/pdfjs-dist', folder)),
        dest: 'pdfjs-assets'
      }))
    }),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
})
