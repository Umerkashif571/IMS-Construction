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
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
            if (id.includes('lucide-react') || id.includes('react-hot-toast')) return 'vendor-ui'
            if (id.includes('recharts')) return 'vendor-charts'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('axios') || id.includes('decimal.js') || id.includes('react-window') || id.includes('react-virtualized')) return 'vendor-utils'
            if (id.includes('exceljs') || id.includes('pdfkit')) return 'vendor-excel'
            return 'vendor-other'
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
  server: {
    port: 3000,
    allowedHosts: ['overbuilt-resilient-darkish.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  }
})