import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Read the repo's single root .env / .env.example instead of expecting
  // a separate frontend/.env — see .env.example at the project root.
  envDir: '..',
})
