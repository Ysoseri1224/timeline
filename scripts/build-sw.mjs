// Writes dist/sw.js: the service worker template plus the list of built files to precache.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const base = '/timeline/';
const skip = new Set(['sw.js', '_headers', '_redirects', '_routes.json']);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(relative(dist, path).split('\\').join('/'));
  }
};
walk(dist);

const hash = createHash('sha256');
const urls = [];
for (const file of files.sort()) {
  if (skip.has(file)) continue;
  hash.update(file).update(readFileSync(join(dist, file)));
  urls.push(file === 'index.html' ? base : base + file);
}
const version = hash.digest('hex').slice(0, 12);
let commit = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '';
if (!commit) { try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { commit = 'unknown'; } }
const template = readFileSync(new URL('../src/sw.template.js', import.meta.url), 'utf8');
writeFileSync(join(dist, 'sw.js'), `// build ${commit}\n` + template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls, null, 2)));
console.log(`sw.js: version ${version}, commit ${commit}, ${urls.length} files precached`);
