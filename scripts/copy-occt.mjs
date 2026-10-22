// Copies the OpenCascade WASM build into public/ so Vite serves it as a static file.
import { cpSync, mkdirSync } from 'node:fs';

const src = 'node_modules/occt-import-js/dist/';
const dst = 'public/vendor/occt/';
mkdirSync(dst, { recursive: true });
for (const f of ['occt-import-js.js', 'occt-import-js.wasm', 'occt-import-js-worker.js', 'license.occt-import-js.txt', 'license.occt.txt']) {
  cpSync(src + f, dst + f);
}
