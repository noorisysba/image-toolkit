import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "/image-toolkit/",
  plugins: [react(), tailwindcss()],
  test: { include: ["src/**/*.test.ts"] },
});
