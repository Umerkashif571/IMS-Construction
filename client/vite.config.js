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
        manualChunks: (id) => {
          // Force split recharts/d3 into separate chunk FIRST
          if (id.includes('recharts') || id.includes('d3-') || id.includes('d3.')) return 'vendor-recharts'
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react'
            if (id.includes('lucide-react')) return 'vendor-ui'
            if (id.includes('axios') || id.includes('decimal.js') || id.includes('date-fns')) return 'vendor-utils'
            if (id.includes('@supabase')) return 'vendor-supabase'
            if (id.includes('react-window') || id.includes('react-virtualized-auto-sizer')) return 'vendor-virtual'
            return 'vendor'
          }
          // Split large pages into their own chunks
          if (id.includes('/pages/')) {
            if (id.includes('Dashboard')) return 'page-dashboard'
            if (id.includes('Materials')) return 'page-materials'
            if (id.includes('Reports')) return 'page-reports'
            if (id.includes('Projects')) return 'page-projects'
            if (id.includes('Vendors')) return 'page-vendors'
            if (id.includes('Vehicles')) return 'page-vehicles'
            if (id.includes('Tools')) return 'page-tools'
            if (id.includes('Warehouses')) return 'page-warehouses'
            if (id.includes('BankBook')) return 'page-bankbook'
            if (id.includes('GatePass')) return 'page-gatepass'
            if (id.includes('Users')) return 'page-users'
            if (id.includes('Backup')) return 'page-backup'
            return 'page-other'
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
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
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  }
})