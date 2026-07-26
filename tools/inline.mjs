/**
 * inline.mjs — fold the Vite build (index.html + one JS + one CSS) into a
 * single self-contained HTML body fragment for publishing as an Artifact.
 * Strips external references so it satisfies the artifact CSP (no CDN hosts).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const out = path.join(__dirname, '..', 'dist', 'override-standalone.html');

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// locate hashed asset filenames
const js = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.js'));
const css = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.css'));
const jsCode = fs.readFileSync(path.join(dist, 'assets', js), 'utf8');
const cssCode = fs.readFileSync(path.join(dist, 'assets', css), 'utf8');

// extract just the <body> inner content (the artifact provides html/head/body)
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : html;

// drop the module + stylesheet + external font link tags; we inline instead
body = body
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/gi, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');

const page = `<style>
${cssCode}
</style>

${body.trim()}

<script type="module">
${jsCode}
</script>
`;

fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(0) + 'KB');
