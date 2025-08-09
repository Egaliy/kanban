import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Works for GitHub Pages automatically; on local dev it's '/'
  base: process.env.BASE_PATH || '/',
})
