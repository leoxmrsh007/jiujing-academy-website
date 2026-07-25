// 预渲染：把每个 .dc.html 在真实浏览器里渲染一遍，将渲染结果写回 <x-dc>，
// 并把原模板搬进惰性的 <script type="text/plain" data-dc-template>。
//
// 为什么这样做：
//   dc-runtime 在浏览器端用 React + Babel 实时渲染，未执行 JS 的爬虫（尤其百度、
//   各类社交预览抓取器）只能看到模板原文，其中 {{ }} 占位符会被当成正文抓走，
//   而九经书名、三觉、二阶性谱系、导航项等数据驱动内容则完全看不到。
//   预渲染后，<x-dc> 内是渲染好的静态 HTML；运行时 boot() 会用 dc.replaceWith()
//   把整个 <x-dc> 换成 #dc-root，故这份静态内容对 JS 用户自动消失，不构成隐藏文本。
//
// 幂等：若文件已含 data-dc-template，则以其为模板源重新渲染，可反复执行。
//
// 注意：首页动态消息来自 fetch data/news-articles.json，预渲染会固化当时的快照。
//       JS 用户看到的仍是最新数据，但爬虫看到的是构建时的。内容更新后请重跑本脚本。
//
// 用法： node tools/prerender.mjs

import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8799;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('404'); }
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(500); res.end('500'); }
});

const X_DC = /<x-dc(?:\s[^>]*)?>([\s\S]*)<\/x-dc>/;
const TPL = /<script type="text\/plain" data-dc-template>([\s\S]*?)<\/script>\s*/;

// 取模板源：已预渲染过的取 script 里的，否则取 x-dc 内的
function templateOf(src) {
  const t = src.match(TPL);
  if (t) return t[1];
  const m = src.match(X_DC);
  return m ? m[1] : null;
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
const files = (await readdir(ROOT)).filter((f) => f.endsWith('.dc.html')).sort();

let ok = 0, skipped = 0;
const report = [];

for (const f of files) {
  const src = await readFile(join(ROOT, f), 'utf8');
  const template = templateOf(src);
  if (template === null) { console.log(`  跳过（无 x-dc）: ${f}`); skipped++; continue; }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(f)}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForSelector('#dc-root', { timeout: 60000 });
    await page.waitForTimeout(1500);

    const rendered = await page.evaluate(() => {
      const el = document.querySelector('#dc-root');
      return el ? el.innerHTML : null;
    });
    if (!rendered || rendered.length < 200) throw new Error('渲染结果为空或过短');
    if (/\{\{[^}]*\}\}/.test(rendered)) throw new Error('渲染结果仍含未求值的占位符');
    if (errors.length) throw new Error('页面报错: ' + errors[0]);

    // 组装：惰性 script 承载真模板 + x-dc 承载预渲染结果
    const block =
      `<script type="text/plain" data-dc-template>${template}</script>\n` +
      `<x-dc>${rendered}</x-dc>`;

    let out = src;
    out = TPL.test(out) ? out.replace(TPL, '') : out;   // 移除旧的模板 script
    out = out.replace(X_DC, block);

    await writeFile(join(ROOT, f), out, 'utf8');
    const before = (src.match(/\{\{[^}]*\}\}/g) || []).length;
    report.push({ f, before, tpl: template.length, rendered: rendered.length });
    ok++;
  } catch (e) {
    console.log(`  失败 ${f}: ${e.message}`);
    skipped++;
  } finally {
    await page.close();
  }
}

await browser.close();
server.close();

console.log(`\n  预渲染完成: ${ok} 成功 / ${skipped} 跳过`);
console.log('  页面                          原占位符  模板字节  渲染字节');
for (const r of report) {
  console.log(`  ${r.f.padEnd(28)} ${String(r.before).padStart(6)} ${String(r.tpl).padStart(9)} ${String(r.rendered).padStart(9)}`);
}
