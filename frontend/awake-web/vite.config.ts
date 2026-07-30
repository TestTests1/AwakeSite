import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // скриншот-проверки вёрстки гоняются Chromium'ом из docker-контейнера api
    allowedHosts: ['host.docker.internal'],
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
      // ws обязателен: SignalR поднимает WebSocket, и без него соединение
      // молча падает на согласовании транспорта
      '/hubs': { target: 'http://localhost:5001', changeOrigin: true, ws: true },
    },
  },
})
