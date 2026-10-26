import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';

/** Preserve notices for dependencies bundled into the application, including renderer packages. */
export async function generateLicenses(root) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const names = new Set(['react', 'react-dom', 'scheduler', 'electron']);
  for (const [key, info] of Object.entries(lock.packages)) {
    if (key.startsWith('node_modules/') && !info.dev) names.add(key.slice('node_modules/'.length));
  }
  const dir = path.join(root, 'licenses');
  await mkdir(dir, { recursive: true });
  const parts = [
    'Pixel Player — Third-party notices',
    'Project code is MIT licensed; third-party components retain their own licenses and copyright notices.',
    'Material Color Utilities: Google LLC, Apache-2.0. Vendored sources retain their original headers.',
    'Material Symbols Rounded: Google LLC, Apache-2.0. https://github.com/google/material-design-icons',
    'Electron includes Chromium, Node.js and other components. Their full notices are distributed with Electron in LICENSES.chromium.html.',
    '',
  ];
  for (const name of [...names].sort()) {
    const packageDir = path.join(root, 'node_modules', name);
    const info = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    const entries = await readdir(packageDir);
    const files = entries.filter((file) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file));
    if (!files.length && name === '@tokenizer/token') files.push('README.md');
    if (!files.length) throw new Error(`No license notice for ${name}`);
    const text = (await Promise.all(files.map((file) => readFile(path.join(packageDir, file), 'utf8')))).join('\n\n');
    const slug = name.replace(/[^a-z0-9.-]/gi, '_');
    await writeFile(path.join(dir, `${slug}.txt`), text);
    parts.push(`===== ${name} ${info.version} (${info.license || 'see notice'}) =====`, text, '');
  }
  for (const [file, input] of [
    ['Apache-2.0.txt', 'src/vendor/mcu/LICENSE'],
    ['GoogleSansFlex-OFL.txt', 'src/assets/fonts/OFL-GoogleSansFlex.txt'],
    ['RobotoFlex-OFL.txt', 'src/assets/fonts/OFL-RobotoFlex.txt'],
  ]) {
    const text = await readFile(path.join(root, input), 'utf8');
    await writeFile(path.join(dir, file), text);
    parts.push(`===== ${file} =====`, text, '');
  }
  await writeFile(path.join(dir, 'THIRD_PARTY_NOTICES.txt'), parts.join('\n\n'));
  await cp(path.join(root, 'LICENSE'), path.join(dir, 'PixelPlayer-MIT.txt'));
}
