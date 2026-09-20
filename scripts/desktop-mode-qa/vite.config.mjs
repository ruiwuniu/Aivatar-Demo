import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.AIVATAR_SYNTHETIC_ROOT;
if (!root || !root.startsWith("/tmp/aivatar-desktop-qa-")) throw new Error("The generated desktop QA profile is required");
const marker = JSON.parse(await readFile(path.join(root, "synthetic-profile.json"), "utf8"));
if (marker.format !== "aivatar-synthetic-profile-v1" || !marker.identifier.startsWith("com.aivatar.synthetic.")) throw new Error("Invalid synthetic marker");
const port = Number(process.env.AIVATAR_DESKTOP_QA_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [1420, 38987, 38988].includes(port)) throw new Error("Invalid isolated QA port");

export default defineConfig({
  root: path.resolve(here, "../.."),
  cacheDir: path.join(root, "vite-cache"),
  plugins: [react(), {
    name: "aivatar-isolated-desktop-qa",
    enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/main.tsx")) {
        return `import "/scripts/desktop-mode-qa/native-client.ts";\n${code}`;
      }
    },
    configureServer(server) {
      server.middlewares.use("/__desktop_qa_control", async (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        try { response.end(await readFile(path.join(root, "control.json"), "utf8")); }
        catch { response.statusCode = 503; response.end('{"error":"No valid synthetic control"}'); }
      });
    },
  }],
  clearScreen: false,
  server: { host: "127.0.0.1", port, strictPort: true },
});
