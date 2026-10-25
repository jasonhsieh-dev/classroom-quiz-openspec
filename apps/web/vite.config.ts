import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.CLASSROOM_BUZZER_WEB_HOST ?? "localhost",
    port: Number.parseInt(process.env.CLASSROOM_BUZZER_WEB_PORT ?? "5173", 10),
    proxy: {
      "/api": process.env.CLASSROOM_BUZZER_API_TARGET ?? "http://localhost:3000",
      "/socket.io": {
        target: process.env.CLASSROOM_BUZZER_API_TARGET ?? "http://localhost:3000",
        ws: true,
      },
    },
  },
});
