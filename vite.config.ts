import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  const requestedBase = process.env.VITE_BASE_PATH ?? environment.VITE_BASE_PATH ?? "/";
  const base = requestedBase.endsWith("/") ? requestedBase : `${requestedBase}/`;

  return {
    base,
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      clearMocks: true,
    },
  };
});
