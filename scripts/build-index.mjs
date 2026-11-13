import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const content = require('../content.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = await readdir(resolve(root, 'projects'), { withFileTypes: true });
const projects = [];
async function checkImages(doc, base) {
  const images = [...Object.values(doc.sections).join('\n').matchAll(/!\[[^\]]*\]\(([^\s)]+)\)/g)].map(m => m[1]);
  if (doc.meta.cover) images.push(doc.meta.cover);
  if (doc.meta.image) images.push(doc.meta.image);
  for (const image of images) {
    content.safeURL(image, '', true);
    if (/^https?:/i.test(image)) continue;
    const path = resolve(root, base, decodeURIComponent(image.split(/[?#]/)[0]));
    if (!path.startsWith(root + sep)) throw new Error(`${doc.source}: image outside site: ${image}`);
    try { await access(path); } catch { throw new Error(`${doc.source}: missing image ${image}`); }
  }
  for (const value of Object.values(doc.sections)) content.markdown(value, base + '/');
}
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
  const source = `projects/${entry.name}/project.md`;
  const doc = content.parse(await readFile(resolve(root, source), 'utf8'), source);
  const project = content.project(doc, entry.name);
  await checkImages(doc, `projects/${entry.name}`);
  projects.push(project);
}
for (const page of ['about', 'contact']) {
  const source = `pages/${page}.md`;
  const doc = content.parse(await readFile(resolve(root, source), 'utf8'), source);
  content.pair(doc, 'title', true);
  content.pair(doc, 'description', true);
  if (page === 'about') content.safeURL(doc.meta.image, 'pages/', true);
  await checkImages(doc, 'pages');
}
projects.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
await writeFile(resolve(root, 'projects/index.json'), JSON.stringify(projects.map(p => p.id), null, 2) + '\n');
console.log(`Validated ${projects.length} projects and 2 pages; projects/index.json updated.`);
