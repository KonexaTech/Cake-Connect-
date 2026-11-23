import { defineConfig } from "vite";
import { resolve } from "node:path";

// Keep the multi-page marketplace entry points and relative assets for GitHub Pages.
export default defineConfig({
  base: "./",
  // QA artifact generation must not reload other parallel browser sessions.
  server: { watch: { ignored: ["**/dist-qa*/**"] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        customer: resolve("neon-customer.html"),
        owner: resolve("neon-owner.html"),
        admin: resolve("neon-admin.html"),
        reset: resolve("neon-reset-password.html"),
        setup: resolve("neon-password-reset.html"),
      },
    },
  },
});
