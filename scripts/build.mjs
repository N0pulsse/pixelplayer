// Сборка интерфейса (React + CSS) в dist/renderer при помощи esbuild.
//   node scripts/build.mjs            — продакшн-сборка
//   node scripts/build.mjs --watch    — пересборка при изменениях
//   node scripts/build.mjs --mock     — дополнительно собирает dist/renderer/mock.js (для тестов в браузере)
import { build, context } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateLicenses } from './licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'renderer');
const watch = process.argv.includes('--watch');
const withMock = process.argv.includes('--mock');
const dev = watch || process.argv.includes('--dev');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await generateLicenses(root);

const common = {
  absWorkingDir: root,
  bundle: true,
  outdir: out,
  format: 'iife',
  target: 'chrome128',
  jsx: 'automatic',
  loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.svg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
  legalComments: 'none',
};

const entries = { app: 'src/main.jsx' };
if (withMock) entries.mock = 'src/dev/mock.js';

const opts = { ...common, entryPoints: entries };

async function copyStatic() {
  let html = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), html);
  await cp(path.join(root,'build','icon.png'),path.join(out,'app-icon.png'));
  await cp(path.join(root, 'licenses'), path.join(out, 'licenses'), { recursive: true });
}

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  await copyStatic();
  console.log('Слежу за изменениями… (Ctrl+C для выхода)');
} else {
  await build(opts);
  await copyStatic();
}
