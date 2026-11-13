const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../content.js');
const root = path.resolve(__dirname, '..');

test('metadata, bilingual sections and relative/remote images', () => {
  const doc = C.parse('---\ncategory: дизайн\nfeatured: true\norder: 12\ncover: images/cover.webp\n---\n## title.en\nName\n## title.ru\nНазвание\n## direction.en\nIdentity\n## direction.ru\nАйдентика\n## description.en\nDescription\n## description.ru\nОписание');
  const p = C.project(doc, 'test-work');
  assert.equal(p.category, 'graphic-design');
  assert.equal(p.featured, true);
  assert.equal(p.image, 'projects/test-work/images/cover.webp');
  assert.equal(p.type[1], 'Айдентика');
  assert.equal(C.safeURL('https://example.com/image.jpg', p.base, true), 'https://example.com/image.jpg');
  assert.equal(C.pair({sections:{'concept.en':'Fallback'}}, 'concept')[1], 'Fallback');
});
test('invalid content fails with useful errors', () => {
  assert.throws(() => C.parse('No metadata'), /metadata/);
  assert.throws(() => C.parse('---\ncover: a\ncover: b\n---'), /duplicate/);
  assert.equal(Object.keys(C.parse('---\n---').meta).length, 0);
  assert.throws(() => C.parse('---\n---\n## title.en\nA\n## title.en\nB'), /duplicate/);
  assert.throws(() => C.project({meta:{category:'unknown'},source:'x'}, 'work'), /category/);
});
test('Markdown is escaped and URLs are restricted', () => {
  assert.equal(C.markdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.match(C.markdown('**Bold** and *italic*\n\n- One\n- Two'), /<strong>Bold<\/strong>.*<em>italic<\/em>[\s\S]*<ul>/);
  assert.match(C.markdown('![A "quote"](photo.png)', 'projects/work/'), /src="projects\/work\/photo.png" alt="A &quot;quote&quot;"/);
  for (const url of ['javascript:alert', 'data:text/html,test', '//example.com/x', '/root.png']) assert.throws(() => C.safeURL(url));
  assert.throws(() => C.markdown('[Bad](javascript:alert)'), /Unsupported/);
  assert.match(C.markdown('[Email](mailto:hello@example.com)'), /href="mailto:/);
});
test('all migrated content loads; all routes render in both languages', async () => {
  const folders = JSON.parse(await fs.readFile(path.join(root, 'projects/index.json'), 'utf8'));
  const source = await fs.readFile(path.join(root, 'app.js'), 'utf8');
  const documents = {};
  for (const file of ['projects/index.json', 'pages/about.md', 'pages/contact.md', ...folders.map(id => `projects/${id}/project.md`)]) documents[file] = await fs.readFile(path.join(root, file), 'utf8');
  for (const id of folders) {
    const p = C.project(C.parse(documents[`projects/${id}/project.md`]), id);
    await fs.access(path.join(root, p.image));
  }
  let count = 0;
  for (const language of ['en', 'ru']) for (const route of ['home','book-covers','illustration','graphic-design','about','contact','missing',...folders.map(id=>'project&project='+id)]) {
    const errorNode = {textContent:''};
    const element = {innerHTML:'',querySelector:()=>({addEventListener(){}, ...errorNode})};
    const context = {window:{PortfolioContent:C}, URLSearchParams, location:{search:`?page=${route}&lang=${language}`},
      document:{documentElement:{}, querySelector:()=>element}, Date, console:{error(e){throw e;}},
      fetch:async file=>({ok:Object.hasOwn(documents,file),status:404,text:async()=>documents[file]})};
    vm.createContext(context);
    await vm.runInContext(source, context);
    assert.ok(element.innerHTML.includes('<header>'), route);
    assert.equal(context.document.documentElement.lang, language);
    if (route==='home') assert.equal((element.innerHTML.match(/<article /g)||[]).length, folders.filter(id=>C.project(C.parse(documents[`projects/${id}/project.md`]),id).featured).length);
    if (route==='about') assert.ok(element.innerHTML.includes(C.escape(C.pair(C.parse(documents['pages/about.md']),'title')[language==='ru'?1:0])));
    if (route==='contact') assert.ok(element.innerHTML.includes(C.markdown(C.pair(C.parse(documents['pages/contact.md']),'details')[language==='ru'?1:0],'pages/')));
    count++;
  }
  assert.equal(count, (7 + folders.length) * 2);
});
test('featured flag controls only the home gallery; menu toggle still works', async () => {
  const files = {};
  for (const file of ['projects/index.json','pages/about.md','pages/contact.md']) files[file] = await fs.readFile(path.join(root,file),'utf8');
  const folders=JSON.parse(files['projects/index.json']);
  for (const id of folders) files[`projects/${id}/project.md`] = (await fs.readFile(path.join(root,`projects/${id}/project.md`),'utf8')).replace('featured: true','featured: false');
  let handler, toggled;
  const button={addEventListener(_,fn){handler=fn;},getAttribute(){return 'false';},setAttribute(key,value){assert.equal(value,'true');}};
  const element={innerHTML:'',querySelector:selector=>selector==='.menu-toggle'?button:{classList:{toggle(name,value){toggled=value;}}}};
  const context={window:{PortfolioContent:C}, URLSearchParams, location:{search:''},document:{documentElement:{},querySelector:()=>element},Date,console,fetch:async file=>({ok:true,text:async()=>files[file]})};
  vm.createContext(context);
  await vm.runInContext(await fs.readFile(path.join(root,'app.js'),'utf8'),context);
  assert.ok(!element.innerHTML.includes('<article '));
  handler({currentTarget:button});
  assert.equal(toggled,true);
  context.location.search='?page=book-covers';
  await vm.runInContext(await fs.readFile(path.join(root,'app.js'),'utf8'),context);
  assert.equal((element.innerHTML.match(/<article /g)||[]).length,folders.filter(id=>C.project(C.parse(files[`projects/${id}/project.md`]),id).category==='book-covers').length);
});

test('a failed Markdown request shows a useful error instead of a blank page', async () => {
  const errorNode = {textContent:''};
  const element = {innerHTML:'',querySelector:()=>errorNode};
  const context = {window:{PortfolioContent:C},URLSearchParams,location:{search:''},document:{querySelector:()=>element},console:{error(){}},
    fetch:async()=>({ok:false,status:404})};
  vm.createContext(context);
  await vm.runInContext(await fs.readFile(path.join(root,'app.js'),'utf8'),context);
  assert.match(element.innerHTML,/Контент недоступен/);
  assert.equal(errorNode.textContent,'projects/index.json: HTTP 404');
});

test('opening index.html as a local file explains how to start preview', async () => {
  const errorNode = {textContent:''};
  const element = {innerHTML:'',querySelector:()=>errorNode};
  const context = {window:{PortfolioContent:C},location:{protocol:'file:'},document:{querySelector:()=>element},console:{error(){}},
    fetch:async()=>{throw new Error('Local files must not use fetch');}};
  vm.createContext(context);
  await vm.runInContext(await fs.readFile(path.join(root,'app.js'),'utf8'),context);
  assert.match(errorNode.textContent,/preview.cmd/);
  assert.match(errorNode.textContent,/127.0.0.1:8080/);
});
