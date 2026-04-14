import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

copyFile(path.join(root, 'public', 'index.html'), path.join(root, 'index.html'));
copyFile(path.join(root, 'public', 'steward.html'), path.join(root, 'steward.html'));

const brandSrc = path.join(root, 'public', 'brand');
const brandDst = path.join(root, 'brand');
if (fs.existsSync(brandSrc)) {
  fs.mkdirSync(brandDst, { recursive: true });
  for (const name of fs.readdirSync(brandSrc)) {
    const src = path.join(brandSrc, name);
    if (fs.statSync(src).isFile()) {
      copyFile(src, path.join(brandDst, name));
    }
  }
}
