import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Pinned to 5175 so the dev origin always matches the Supabase redirect
  // allowlist (http://localhost:5175). strictPort fails loudly if 5175 is busy
  // rather than silently drifting to another port and breaking password resets.
  server: { port: 5175, strictPort: true },
});
