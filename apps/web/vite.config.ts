import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: mode === "test"
          ? "http://127.0.0.1:8790"
          : process.env.BOUTIKIER_API_ORIGIN || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
}));
