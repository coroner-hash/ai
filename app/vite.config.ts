import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Multi-page build: add app pages (e.g. app: "app.html") to the input map.
export default defineConfig({
  plugins: [cloudflare()],
  environments: {
    client: {
      build: {
        assetsInlineLimit: 0, // keep fonts as files: CSP is font-src self
        rollupOptions: {
          input: { main: "index.html", check: "check.html", premortem: "premortem.html", autopsy: "autopsy.html", docs: "docs.html", sentinel: "sentinel.html", notFound: "404.html" },
        },
      },
    },
  },
});
