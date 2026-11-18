import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import checker from 'vite-plugin-checker'
import path from 'node:path'

// 让同一个 dev server 既服务浏览器版也服务 Tauri 壳。Tauri 会在
// 启动时设 TAURI_DEV_HOST 环境变量；有这个变量时我们让 Vite 监听
// 全 IP 并开启 HMR，让 WebView 能连上。
const tauriHost = process.env.TAURI_DEV_HOST

// GitHub Pages 项目站点挂在 /FmoDeck/ 子路径下，需要 Vite 的 base 与之对齐，
// 否则构建产物的 JS/CSS 会去站点根目录找而 404。本地 / Tauri 构建保持 '/'。
// 用布尔 flag 而非传路径值：Windows/Git Bash 会把 '/FmoDeck/' 做 MSYS 路径转换。
const base = process.env.GITHUB_PAGES === '1' ? '/FmoDeck/' : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint .',
        useFlatConfig: true
      },
      overlay: { initialIsOpen: false }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Tauri 需要固定端口 + 禁用其他端口抢占
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: tauriHost ?? true,
    hmr: tauriHost
      ? {
          protocol: 'ws',
          host: tauriHost,
          port: 1421
        }
      : undefined,
    watch: {
      // 别把 src-tauri 当 frontend 源扫描，避免触发 HMR
      ignored: ['**/src-tauri/**']
    }
  }
})
