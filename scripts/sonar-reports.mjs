// The coverage report's paths made the scanner's (it runs in Linux, in the project's folder): the page's lcov with
// forward slashes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fix = (file, change) => {
  const path = join(root, file);
  if (!existsSync(path)) {
    console.warn(`no ${file}: run the tests with coverage first`);
    return;
  }
  writeFileSync(path, change(readFileSync(path, 'utf-8')));
  console.log(`${file}: paths made the scanner's`);
};

fix('coverage/web/lcov.info', (s) => s.replace(/^SF:(.*)$/gm, (_, p) => `SF:${p.replaceAll('\\', '/')}`));
