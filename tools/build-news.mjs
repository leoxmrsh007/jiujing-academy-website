// 把 _news/*.md（Decap CMS 的产出）编译成 data/news-articles.json（网站实际读取的）。
//
// 为什么需要它：
//   Decap CMS 写入 _news/*.md，而首页与书院动态页只读 data/news-articles.json，
//   两者此前毫无关联——后台发布的内容永远不会出现在网站上，且没有任何报错。
//   本脚本补上这缺失的一环，使 _news/ 成为唯一数据源。
//
// id 稳定性：
//   详情页以 ?id=N 定位文章。id 按「日期升序」分配（最早的一篇为 0），
//   因此新增文章只会追加新 id，既有分享链接永不失效；
//   而输出数组按日期倒序排列，供页面直接顺序渲染。
//
// 多语言：
//   CMS 主要收中文。frontmatter 里 *_hant / *_en 为可选；缺失时回落到中文，
//   保证任何一篇都不会出现空白，也不强迫编辑填翻译。
//
// 用法： node tools/build-news.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NEWS_DIR = '_news';
const OUT = 'data/news-articles.json';

// 分类 → 视觉样式。原 JSON 中这些值是逐条手写的，此处按分类统一派生。
const CAT_STYLE = {
  seminar: { glyph: '易', tagBg: '#9c2b23', zh: '会讲', hant: '會講', en: 'Seminar' },
  lecture: { glyph: '礼', tagBg: '#3b3833', zh: '讲座', hant: '講座', en: 'Lecture' },
  journey: { glyph: '游', tagBg: '#2f4538', zh: '游学', hant: '遊學', en: 'Journey' },
  note:    { glyph: '札', tagBg: '#9c2b23', zh: '札记', hant: '札記', en: 'Notes' },
  student: { glyph: '学', tagBg: '#2f4538', zh: '学员', hant: '學員', en: 'Student' },
};
const GLYPH_COLOR = 'rgba(156,43,35,.42)';
const BAND_BG =
  'repeating-linear-gradient(135deg,#e6dcc6,#e6dcc6 10px,#dccfb3 10px,#dccfb3 20px)';

// 极简 frontmatter 解析：支持 key: value、引号值，以及 key: | 块标量（多行正文用）
function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { data: {}, body: src.trim() };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2];
    if (val === '|' || val === '|-' || val === '>') {          // 块标量
      const buf = [];
      while (i + 1 < lines.length && /^(\s{2,}|\t|\s*$)/.test(lines[i + 1])) {
        buf.push(lines[++i].replace(/^ {2}/, ''));
      }
      data[key] = buf.join('\n').replace(/\s+$/, '');
      continue;
    }
    val = val.trim().replace(/^["'](.*)["']$/s, '$1');
    data[key] = val;
  }
  return { data, body: m[2].trim() };
}

const paras = (s) =>
  String(s || '').split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s*\r?\n\s*/g, '').trim()).filter(Boolean);

// 用于排序的日期键："2026.08 · 丙申孟秋" -> "2026.08"
const dateKey = (d) => String(d || '').split('·')[0].trim();

let files = [];
try {
  files = (await readdir(NEWS_DIR)).filter((f) => f.endsWith('.md')).sort();
} catch {
  console.error(`  ${NEWS_DIR}/ 不存在，跳过`);
  process.exit(0);
}

const items = [];
for (const f of files) {
  const { data, body } = parseFrontmatter(await readFile(join(NEWS_DIR, f), 'utf8'));
  if (!data.title) { console.warn(`  跳过（缺 title）: ${f}`); continue; }
  const cat = CAT_STYLE[data.cat] ? data.cat : 'note';
  const st = CAT_STYLE[cat];
  const bodyZh = paras(body);
  const exc = data.excerpt || bodyZh[0] || '';
  items.push({
    _sortKey: dateKey(data.date),
    cat, glyph: st.glyph, glyphColor: GLYPH_COLOR, bandBg: BAND_BG, tagBg: st.tagBg,
    catZh: st.zh, catHant: st.hant, catEn: st.en,
    date: data.date || '',
    titleZh: data.title,
    titleHant: data.title_hant || data.title,
    titleEn: data.title_en || data.title,
    excZh: exc,
    excHant: data.excerpt_hant || exc,
    excEn: data.excerpt_en || exc,
    bodyZh,
    bodyHant: data.body_hant ? paras(data.body_hant) : bodyZh,
    bodyEn: data.body_en ? paras(data.body_en) : bodyZh,
  });
}

// id 按日期升序分配后固定，输出按日期倒序
items.sort((a, b) => a._sortKey.localeCompare(b._sortKey));
items.forEach((it, i) => { it.id = i; });
items.sort((a, b) => b._sortKey.localeCompare(a._sortKey));

const out = items.map(({ _sortKey, id, ...rest }) => ({ id, ...rest }));
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`  ${OUT} 已生成：${out.length} 条（源：${NEWS_DIR}/ 共 ${files.length} 个 md）`);
for (const a of out) console.log(`    id=${String(a.id).padStart(2)}  ${a.date.padEnd(22)} ${a.titleZh}`);
