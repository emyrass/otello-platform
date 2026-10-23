import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { otelloApi } from "./server/plugin.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), otelloApi()],
  server: {
    host: "127.0.0.1",
    port: 47281,
    strictPort: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
