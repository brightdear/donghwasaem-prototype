/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// base: './' — GitHub Pages 하위 경로(/donghwasaem-prototype/)에서도 상대 경로로 동작.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
