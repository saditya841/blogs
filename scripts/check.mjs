// Imports every module in src/ once. Catches syntax errors and broken imports before deploy.
//   npm run check
import { readdirSync } from 'node:fs';

const dir = new URL('../src/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
let bad = 0;

for (const file of files) {
  try {
    await import(new URL(file, dir).href);
    console.log('ok    ' + file);
  } catch (e) {
    bad++;
    console.error('FAIL  ' + file + ' — ' + (e && e.message));
  }
}

console.log(`\n${files.length - bad}/${files.length} modules load`);
process.exit(bad ? 1 : 0);
