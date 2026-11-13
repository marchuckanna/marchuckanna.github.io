/* Shared by the browser and the catalogue builder. No third-party dependencies. */
(function (scope) {
  'use strict';
  const categories = { 'обложка': 'book-covers', 'иллюстрация': 'illustration', 'дизайн': 'graphic-design' };
  function parse(text, source = 'Markdown') {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const match = text.match(/^---\n((?:[^\n]*\n)*?)---(?:\n|$)/);
    if (!match) throw new Error(`${source}: expected a metadata block between --- lines`);
    const meta = {};
    for (const line of match[1].split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const item = line.match(/^([a-z][a-z-]*):\s*(.*?)\s*$/);
      if (!item || Object.hasOwn(meta, item[1])) throw new Error(`${source}: invalid or duplicate metadata: ${line}`);
      meta[item[1]] = item[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    const sections = {};
    let key = null;
    for (const line of text.slice(match[0].length).split('\n')) {
      const heading = line.match(/^## ([a-z][a-z-]*\.(?:en|ru))\s*$/);
      if (heading) {
        key = heading[1];
        if (Object.hasOwn(sections, key)) throw new Error(`${source}: duplicate section ${key}`);
        sections[key] = '';
      } else if (key) sections[key] += line + '\n';
      else if (line.trim() && !line.startsWith('<!--')) throw new Error(`${source}: text must be inside a ## section`);
    }
    for (const name of Object.keys(sections)) sections[name] = sections[name].trim();
    return { meta, sections, source };
  }
  function pair(doc, name, required = false) {
    const values = ['en', 'ru'].map(lang => doc.sections[`${name}.${lang}`] || '');
    if (required && values.some(v => !v)) throw new Error(`${doc.source}: ${name}.en and ${name}.ru are required`);
    return values.map(v => v || values.find(Boolean) || '');
  }
  function safeURL(value, base = '', image = false) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Empty URL');
    value = value.trim();
    if (/^(?:https?:)/i.test(value)) {
      const parsed = new URL(value);
      if (!parsed.hostname || parsed.username || parsed.password) throw new Error(`Invalid URL: ${value}`);
      return value;
    }
    if (!image && /^mailto:[^\s<>]+$/i.test(value)) return value;
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) throw new Error(`Unsupported URL: ${value}`);
    if (value.startsWith('/')) throw new Error('Use paths relative to the Markdown file, not /absolute paths');
    return base + value;
  }
  function project(doc, folder) {
    const m = doc.meta;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder)) throw new Error(`Invalid project folder: ${folder}`);
    const category = categories[m.category];
    if (!category) throw new Error(`${doc.source}: category must be обложка, иллюстрация or дизайн`);
    for (const flag of ['featured', 'demo']) if (m[flag] && !['true', 'false'].includes(m[flag])) throw new Error(`${doc.source}: ${flag} must be true or false`);
    if (m.order && !Number.isFinite(Number(m.order))) throw new Error(`${doc.source}: order must be a number`);
    const base = `projects/${folder}/`;
    return { id: folder, category, featured: m.featured === 'true', demo: m.demo === 'true', order: Number(m.order || 1000), year: m.year || '',
      image: safeURL(m.cover, base, true), title: pair(doc, 'title', true), type: pair(doc, 'direction', true),
      description: pair(doc, 'description', true), concept: pair(doc, 'concept'), status: pair(doc, 'status'), gallery: pair(doc, 'gallery'), base };
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(text, base = '') {
    // Raw HTML is escaped. Only this documented Markdown subset is rendered.
    const tokens = [];
    const stash = html => `\u0000${tokens.push(html) - 1}\u0000`;
    text = text.replace(/(!?)\[([^\]\n]*)\]\(([^\s)]+)\)/g, (_, image, label, href) => {
      const url = escape(safeURL(href, base, !!image));
      return stash(image ? `<img src="${url}" alt="${escape(label)}" loading="lazy">` : `<a href="${url}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escape(label)}</a>`);
    });
    return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
  }
  function markdown(text, base = '') {
    if (!text.trim()) return '';
    return text.trim().split(/\n\s*\n/).map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^- /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.slice(2), base)}</li>`).join('')}</ul>`;
      if (lines.every(l => /^\d+\. /.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\d+\. /, ''), base)}</li>`).join('')}</ol>`;
      if (/^### /.test(block)) return `<h3>${inline(block.slice(4), base)}</h3>`;
      if (lines.every(l => /^> ?/.test(l))) return `<blockquote>${inline(lines.map(l => l.replace(/^> ?/, '')).join(' '), base)}</blockquote>`;
      return `<p>${lines.map(l => inline(l, base)).join('<br>')}</p>`;
    }).join('\n');
  }
  const api = { parse, pair, project, safeURL, escape, markdown, inline, categories };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.PortfolioContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
