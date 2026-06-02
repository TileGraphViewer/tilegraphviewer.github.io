import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), cesium()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4096,
  },
});
