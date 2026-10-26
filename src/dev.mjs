/**
 * Build once, then serve and rebuild on content/src changes.
 * `node src/dev.mjs` — http://127.0.0.1:4173
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WATCHED = ['content', 'src', 'public'].map((d) => path.join(ROOT, d));

const build = () =>
  new Promise((resolve) => {
    execFile(process.execPath, ['src/build.mjs'], { cwd: ROOT }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (error) process.stderr.write(stderr || String(error));
      resolve();
    });
  });

await build();

const server = spawn(process.execPath, ['src/serve.mjs'], { cwd: ROOT, stdio: 'inherit' });

let timer = null;
for (const dir of WATCHED) {
  if (!fs.existsSync(dir)) continue;
  fs.watch(dir, { recursive: true }, (_event, file) => {
    if (file && !/\.(md|json|css|js|mjs|svg|html)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(build, 120);
  });
}

console.log('  watching content/ src/ public/ — Ctrl+C to stop\n');

const shutdown = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
