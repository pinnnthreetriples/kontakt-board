import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const SOURCE_LIMIT = 350;
const TEST_LIMIT = 500;
const ROOTS = ['src', 'e2e'];
const ALLOWED = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  }));
  return groups.flat();
}

const files = (await Promise.all(ROOTS.map((root) => collect(root).catch(() => [])))).flat();
const violations = [];

for (const file of files.filter((path) => ALLOWED.has(extname(path)))) {
  const lines = (await readFile(file, 'utf8')).split('\n').length;
  const limit = /\.(test|spec)\.|^e2e\//.test(file) ? TEST_LIMIT : SOURCE_LIMIT;
  if (lines > limit) violations.push(`${file}: ${lines} строк (лимит ${limit})`);
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Размер файлов: OK (${files.length} проверено)`);
