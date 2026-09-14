import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The three libraries jsPDF dynamically imports from `doc.html()`, and only
 * from there. The chord chart PDF is drawn from measured geometry rather than
 * screenshotted, so that path is never taken — see `src/lib/jspdf-html-stub.ts`.
 */
const JSPDF_HTML_DEPENDENCIES = ['html2canvas', 'canvg', 'dompurify'];

const stub = fileURLToPath(new URL('./src/lib/jspdf-html-stub.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: Object.fromEntries(JSPDF_HTML_DEPENDENCIES.map((name) => [name, stub])),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
