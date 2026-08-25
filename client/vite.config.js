import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
            if (id.includes('lucide-react') || id.includes('recharts')) return 'vendor-ui'
            if (id.includes('axios') || id.includes('decimal.js') || id.includes('date-fns')) return 'vendor-utils'
            if (id.includes('@supabase')) return 'vendor-supabase'
            return 'vendor'
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
  },
  server: {
    port: 3000,
    allowedHosts: ['overbuilt-resilient-darkish.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  }
})