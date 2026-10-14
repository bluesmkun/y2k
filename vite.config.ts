import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": import.meta.dirname + "/src" } },
  build: {
    // The theme ships as one directory the hub serves verbatim; dist/ is that
    // directory's payload, so nothing else may land in it.
    outDir: "y2k/dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  // A theme reads public data only, so any hub with its status page open can
  // serve as the source: MONITOR_HUB=https://hub.example.com npm run dev.
  // changeOrigin sends that hub its own name as Host, which a proxy or CDN in
  // front of it routes by.
  server: {
    proxy: {
      "/api": {
        target: process.env.MONITOR_HUB || "http://127.0.0.1:9911",
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
