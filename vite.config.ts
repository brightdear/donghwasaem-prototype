/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";

// CSP는 빌드 산출물에만 주입한다. dev 서버는 HMR이 인라인 <style>·ws를 써서 style-src 'self'에 막힌다.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.anthropic.com; img-src 'self'; font-src 'self'; media-src 'none'; base-uri 'none'; form-action 'none'";
const cspPlugin: Plugin = {
  name: "inject-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
};

// base: './' — GitHub Pages 하위 경로(/donghwasaem-prototype/)에서도 상대 경로로 동작.
export default defineConfig({
  base: "./",
  plugins: [cspPlugin],
  build: { target: "es2022", sourcemap: false },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
