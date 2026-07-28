// 把带白底的书法 logo 处理成透明背景，供米黄画布融合显示。
//
// 为什么需要它：
//   原始 PNG 是白底黑字，叠在页面 #f4efe4 米黄色画布上会形成白色矩形轮廓，
//   视觉上像给字加了个"白框+黑边"。透明化后手写字直接浮在画布上，与整
//   体风格一致。同时顺手裁掉图片边缘残留的深色噪点边框（不同图边框粗
//   细不同，各自单独测量后精确裁）。
//
// 幂等策略：
//   一旦处理过，图片就没有白底、也没有边框噪点了；再跑一遍脚本，边框
//   测量会返回 0，裁剪不生效，二次透明化对已透明像素也是 no-op。因此
//   可反复执行而不会累加损失。
//
// 只处理 logo 类图片，不动照片；亮度 -> alpha 的映射对手写笔画有效，
//   对灰度渐变的照片会造成严重失真，切勿扩用。
//
// 用法：npm run build:logos

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// 亮度→透明度映射：
//   全白像素完全透明，深字保持不透明，过渡带线性插值。
//   RGB 统一改写为品牌主色 #22201d，兼顾锐利与色调统一。
async function whiteToAlpha(file, crop = { top: 0, bot: 0, left: 0, right: 0 }) {
  if (!existsSync(file)) { console.log(`  跳过（不存在）: ${file}`); return; }
  const buf = readFileSync(file);
  const meta = await sharp(buf).metadata();
  const cropped = await sharp(buf)
    .extract({
      left: crop.left, top: crop.top,
      width: meta.width - crop.left - crop.right,
      height: meta.height - crop.top - crop.bot,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = cropped;
  const w = info.width, h = info.height;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let alpha;
    if (lum >= 235) alpha = 0;
    else if (lum <= 80) alpha = 255;
    else alpha = Math.round(255 * (235 - lum) / (235 - 80));
    out[i] = 0x22; out[i + 1] = 0x20; out[i + 2] = 0x1d; out[i + 3] = alpha;
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  const before = buf.length, after = png.length;
  writeFileSync(file, png);
  console.log(`  ${file}  ${meta.width}x${meta.height} -> ${w}x${h}  ${(before/1024).toFixed(1)}KB -> ${(after/1024).toFixed(1)}KB`);
}

// 各 logo 的边框噪点厚度（此前用采样脚本测得，见 build-logos 注释）：
//   logo-horizontal-white: 右侧 3px
//   logo-tagline         : 上 2px，左 7px
// 首次运行会裁掉；后续运行会因文件已洁净而裁 0px。
await whiteToAlpha('assets/logo-horizontal-white.png', { top: 0, bot: 0, left: 0, right: 3 });
await whiteToAlpha('assets/logo-tagline.png',          { top: 2, bot: 0, left: 7, right: 0 });

// 四角与四边中点 alpha 全 0 才算真正无白底
console.log('\n  校验:');
for (const f of ['assets/logo-horizontal-white.png', 'assets/logo-tagline.png']) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const px = (x, y) => data[(y * w + x) * 4 + 3];
  const pts = [px(0,0), px(w-1,0), px(0,h-1), px(w-1,h-1), px(w>>1,0), px(w>>1,h-1), px(0,h>>1), px(w-1,h>>1)];
  const ok = pts.every(a => a === 0);
  console.log(`    ${f}  ${ok ? '✔ 无白底' : '⚠ 仍有不透明: ' + pts.join(',')}`);
}
