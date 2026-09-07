#!/usr/bin/env node
/**
 * Сборка блока T123 для Тильды из присланной single-file сборки (Vite + Vue 3 + Tailwind 4).
 *
 * Вход:  source/*.html (берётся последний по имени) или путь к файлу первым аргументом.
 * Выход:
 *   assets/img/<роль>-<hash>.webp        картинки (в исходнике были base64 внутри JS)
 *   assets/tilda/<имя>.<hash>.css / .js  минифицированные файлы для CDN и превью
 *   index.html                           превью (локально / GitHub Pages)
 *   tilda/1-css.html 2-html.html 3-js.html   три блока T123, вставлять по порядку
 *   tilda/all-in-one.html                то же одним блоком
 *   tilda/external.html                  блок T123, CSS и JS с jsDelivr (самый лёгкий)
 *
 * Запуск:  node scripts/build-tilda.mjs [source.html] [--ref=main|<sha>] [--bot=https://t.me/...] [--music=assets/audio/x.mp3] [--clean]
 *   --ref   ветка или коммит для jsDelivr (по умолчанию main)
 *   --bot   ссылка на бота вместо плейсхолдера https://t.me/your_bot_username
 *   --music mp3 для плеера (путь в репо или URL); без него — тихий генеративный эмбиент (Web Audio)
 *   --clean удалить старые версии файлов в assets/img и assets/tilda
 *
 * Что делает с кодом:
 *   • убирает <header> и <footer> (меню и футер — на стороне Тильды), min-h-screen у корня
 *   • base64-картинки → WebP на jsDelivr (cwebp), лишние размеры ужимаются
 *   • CSS: снимает @layer, все селекторы префиксует .sya, html/body/:root → .sya
 *   • JS: без type=module, в IIFE (никаких глобальных const рядом с jQuery Тильды)
 *   • плеер: иконка паузы вместо play, точка прогресса движется вместе с волной
 *   • плавное появление блоков (IntersectionObserver), точки в конце абзацев снимаются
 *   • одинаковые отступы сверху и снизу у всех секций (был разнобой section / section-sm)
 *   • плавный скролл по якорям с поправкой на липкое меню Тильды
 *   • на выходе всё минифицировано esbuild: без комментариев и пустых строк
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const flag = (name) => args.includes(`--${name}`);

const REPO = "ElenaSamanchuk/sistema-yasnosti-club";
const REF = opt("ref", "main");
const CDN = `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/`;
const BOT_URL = opt("bot", "");
const MUSIC_URL = opt("music", ""); // mp3 вместо генеративного эмбиента: путь в репо (assets/audio/x.mp3) или URL
const PLACEHOLDER_BOT = "https://t.me/your_bot_username";
const SCOPE = "sya";
const WRAP_ID = "sya-club";
const APP_ID = "sya-club-app";
const NAME = "sya-audioclub";
const TODAY = new Date().toISOString().slice(0, 10);
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Forum&family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap" rel="stylesheet">';

// Роли картинок по порядку их появления в JS. maxWidth — с запасом ×2 под ретину.
const IMAGE_ROLES = [
  { role: "hero-player", maxWidth: 1000, expect: "1000x746", preload: true }, // фото в карточке плеера, отдаётся в ~420px × 2
  { role: "vinyl-mark", maxWidth: 0, expect: "440x440", preload: true }, // печать на пластинке (png с альфой)
  { role: "recognition-band", maxWidth: 1800, expect: "1800x379" }, // широкая полоса «Теперь будет иначе»
  { role: "author-1", maxWidth: 600, expect: "1200x800" }, // фото автора, колонка 236px
  { role: "author-2", maxWidth: 600, expect: "1000x664" },
  { role: "author-3", maxWidth: 600, expect: "1400x933" },
  { role: "faq-photo-1", maxWidth: 480, expect: "1000x666" }, // полароиды в FAQ, 168–184px
  { role: "faq-photo-2", maxWidth: 480, expect: "1000x481" },
];

// Своя картинка вместо присланной: положите файл source/img/<роль>.<jpg|png|webp>,
// имя без расширения = поле role выше. Переживает новые сборки от разработчика.
const IMG_DIR = "source/img";
// формат по содержимому, а не по расширению: png с именем .jpg не должен ломать сборку
function sniff(b) {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}
function overrideFor(role) {
  const dir = path.join(ROOT, IMG_DIR);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, "") === role && /\.(jpe?g|png|webp)$/i.test(f));
  return hit ? path.join(dir, hit) : null;
}

// Что плавно появляется (внутри .sya). Порядок = очередность внутри родителя для задержки.
const REVEAL_SELECTORS = [
  "section > .wrap > *",
  "section > .wrap > .grid > *",
  "section .grid > figure, section .grid > article",
  "section ul > li",
];

const fail = (msg) => {
  console.error("✖ " + msg);
  process.exit(1);
};
const must = (m, label) => (m ? m : fail(`не найдено: ${label} — присланная сборка изменилась, нужно обновить скрипт`));
const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const kb = (n) => (n / 1024).toFixed(1) + " KB";

function esbuild(code, args, label) {
  const bin = process.env.SYA_ESBUILD || path.join(ROOT, "node_modules/.bin/esbuild");
  if (!fs.existsSync(bin)) fail("нет esbuild — выполните один раз: npm i");
  try {
    return execFileSync(bin, args, { input: code, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (e) {
    fail(`esbuild (${label}): ` + String(e.stderr || e.message).slice(0, 500));
  }
}
const minifyJs = (code) => esbuild(code, ["--minify", "--target=es2020", "--charset=utf8", "--loader=js"], "js").trim();
const minifyCss = (code) => esbuild(code, ["--minify", "--charset=utf8", "--loader=css"], "css").trim();

// ---------- источник ----------
const srcArg = args.find((a) => !a.startsWith("--"));
let sourcePath;
if (srcArg) sourcePath = path.resolve(srcArg);
else {
  const dir = path.join(ROOT, "source");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort() : [];
  if (!files.length) fail("положите присланный html в source/");
  sourcePath = path.join(dir, files[files.length - 1]);
}
console.log("источник:", path.relative(ROOT, sourcePath));
const html = fs.readFileSync(sourcePath, "utf8");
const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "Аудиоклуб").trim();
const cssRaw = must(html.match(/<style[^>]*>([\s\S]*?)<\/style>/), "<style>")[1];
let js = must(html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/), '<script type="module">')[1];

try {
  execFileSync("cwebp", ["-version"], { stdio: "pipe" });
} catch {
  fail("нужен cwebp: brew install webp");
}

for (const d of ["assets/img", "assets/tilda", "tilda"]) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sya-build-"));

// ---------- картинки ----------
function dims(buf, type) {
  if (type === "image/png") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (type === "image/jpeg") {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { w: 0, h: 0 };
}

const blobRe = /"data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)"/g;
const blobs = [...js.matchAll(blobRe)];
if (blobs.length !== IMAGE_ROLES.length) {
  console.warn(`⚠ картинок в сборке: ${blobs.length}, ролей в скрипте: ${IMAGE_ROLES.length} — проверьте таблицу ниже`);
}
const produced = new Set();
const preloads = [];
const imgTable = [];
blobs.forEach((m, i) => {
  let type = m[1];
  let buf = Buffer.from(m[2], "base64");
  const rule = IMAGE_ROLES[i] || { role: `img-${i + 1}`, maxWidth: 0 };
  const ovr = overrideFor(rule.role);
  if (ovr) {
    buf = fs.readFileSync(ovr);
    type = sniff(buf) || fail(`${path.relative(ROOT, ovr)}: не jpg, не png и не webp`);
    if (type === "image/webp") {
      // cwebp не читает webp на входе — переводим в png штатным sips
      const conv = path.join(TMP, `ovr-${i}.png`);
      try {
        execFileSync("sips", ["-s", "format", "png", ovr, "--out", conv], { stdio: "pipe" });
      } catch {
        fail(`${path.relative(ROOT, ovr)}: не удалось прочитать webp — положите jpg или png`);
      }
      buf = fs.readFileSync(conv);
      type = "image/png";
    }
  }
  const ext = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : type.split("/")[1];
  const { w, h } = dims(buf, type);
  if (!ovr && rule.expect && rule.expect !== `${w}x${h}`) {
    console.warn(`⚠ #${i + 1} ${rule.role}: размер ${w}x${h}, ожидался ${rule.expect} — картинки могли поменяться местами`);
  }
  const tmpSrc = path.join(TMP, `${i}.${ext}`);
  const tmpOut = path.join(TMP, `${i}.webp`);
  fs.writeFileSync(tmpSrc, buf);
  const cw = ["-quiet", "-metadata", "none", "-m", "6", "-af", "-sharp_yuv"];
  if (rule.maxWidth && w > rule.maxWidth) cw.push("-resize", String(rule.maxWidth), "0");
  let out;
  if (type === "image/png") {
    // png (печать/логотип): пробуем lossless и lossy, берём что меньше
    const tmpLossless = path.join(TMP, `${i}-ll.webp`);
    execFileSync("cwebp", [...cw, "-lossless", "-z", "9", tmpSrc, "-o", tmpLossless]);
    execFileSync("cwebp", [...cw, "-q", "92", "-alpha_q", "100", tmpSrc, "-o", tmpOut]);
    const a = fs.readFileSync(tmpLossless), b = fs.readFileSync(tmpOut);
    out = a.length <= b.length ? a : b;
  } else {
    execFileSync("cwebp", [...cw, "-q", "88", tmpSrc, "-o", tmpOut]);
    out = fs.readFileSync(tmpOut);
  }
  const file = `${rule.role}-${sha1(out).slice(0, 8)}.webp`;
  fs.writeFileSync(path.join(ROOT, "assets/img", file), out);
  produced.add(file);
  const rel = `assets/img/${file}`;
  if (rule.preload) preloads.push(rel);
  js = js.split(m[0]).join(`__syaBase+"${rel}"`);
  const outDims = dims(out, "image/webp");
  imgTable.push({ "#": i + 1, роль: rule.role, было: `${ovr ? IMG_DIR + "/" + path.basename(ovr) + " " : ""}${w}x${h} ${ext} ${kb(buf.length)}`, стало: `${rule.maxWidth && w > rule.maxWidth ? rule.maxWidth + "w" : "как есть"} ${kb(out.length)}`, файл: file });
});
console.table(imgTable);

// ---------- JS ----------
function patch(src, re, repl, label) {
  const m = src.match(re);
  must(m, label);
  return src.replace(re, repl);
}

// 1. полифилл modulepreload в начале сборки не нужен
js = patch(js, /^\s*\(function\(\)\{const \w+=document\.createElement\("link"\)\.relList;[\s\S]*?\}\)\(\);/, "", "полифилл modulepreload");

// 2. шапка и футер — на стороне Тильды
function componentNames(name) {
  const raw = must(js.match(new RegExp(`\\b(\\w+)=\\{__name:"${name}"`)), name)[1];
  const names = [raw];
  const wrapped = js.match(new RegExp(`\\b(\\w+)=\\w+\\(${raw},\\[\\["__scopeId"`)); // scoped styles → обёртка
  if (wrapped) names.push(wrapped[1]);
  return names.join("|");
}
const headerVar = componentNames("AppHeader");
const footerVar = componentNames("AppFooter");
const appRe = new RegExp(`R\\("div",(\\w+),\\[X\\((?:${headerVar})\\),(k\\("main",null,\\[[^\\]]*\\]\\)),X\\((?:${footerVar})\\)\\]\\)`);
const appMatch = must(js.match(appRe), "render корня App (header + main + footer)");
const rootVar = appMatch[1];
js = js.replace(appRe, 'R("div",$1,[$2])');
js = patch(js, new RegExp(`\\b${rootVar}=\\{class:"min-h-screen `), `${rootVar}={class:"`, "min-h-screen у корня");

// 3. точка монтирования — уникальный id внутри страницы Тильды
js = patch(js, /(\w+\(\w+\))\.mount\("#app"\)/, (m, app) => `__syaMount(${app})`, 'mount("#app")');

// 4. плеер: точка прогресса едет вместе с волной, иконка паузы
const pcIdx = must(js.match(/\{__name:"PlayerCard"/), "PlayerCard").index;
const progressVar = must(js.slice(pcIdx).match(/setup\(\w+\)\{const (\w+)=\w+\(\.38\)/), "PlayerCard: ref прогресса Oe(.38)")[1];
js = patch(
  js,
  /(\w+)\[1\]\|\|\(\1\[1\]=k\("div",\{class:"mt-4 flex items-center gap-3","aria-hidden":"true"\},\[k\("span",\{class:"relative h-px flex-1 bg-muted\/40"\},\[k\("span",\{class:"absolute left-\[38%\] ([^"]*)"\}\)\]\)\],-1\)\)/,
  (_, __, rest) =>
    `k("div",{class:"mt-4 flex items-center gap-3","aria-hidden":"true"},[k("span",{class:"relative h-px flex-1 bg-muted/40"},[k("span",{class:"absolute sya-dot ${rest}",style:{left:(${progressVar}.value*100).toFixed(2)+"%"}},null,4)])])`,
  "PlayerCard: статичная точка прогресса"
);
const playSvg = '<svg width="10" height="11" viewBox="0 0 10 11" fill="none" class="translate-x-px"><path d="M9.5 5.5 0 10.7V.3L9.5 5.5Z" class="fill-white"></path></svg>';
const pauseSvg = '<svg width="10" height="11" viewBox="0 0 10 11" fill="none"><rect x="1" y=".5" width="3" height="10" rx=".7" class="fill-white"></rect><rect x="6" y=".5" width="3" height="10" rx=".7" class="fill-white"></rect></svg>';
if (!js.includes(playSvg)) fail("не найдено: иконка play в PlayerCard");
js = js.split(playSvg).join(pauseSvg);

// 4b. загрузка картинок: hero — приоритет, остальные — lazy
let imgCount = 0;
js = js.replace(/k\("img",\{(?=[^}]{0,160})/g, (m, off) => {
  imgCount++;
  const ahead = js.slice(off, off + 160);
  if (/src:\w+\.photo,alt:"/.test(ahead)) return 'k("img",{fetchpriority:"high",decoding:"async",';
  if (/src:\w+\.mark,/.test(ahead)) return 'k("img",{decoding:"async",';
  return 'k("img",{loading:"lazy",decoding:"async",';
});
if (imgCount < 5) fail("img в шаблонах меньше ожидаемого: " + imgCount);

// 5. ссылка на бота
if (BOT_URL) js = js.split(JSON.stringify(PLACEHOLDER_BOT)).join(JSON.stringify(BOT_URL));
else if (js.includes(PLACEHOLDER_BOT)) console.warn(`⚠ в сборке остался плейсхолдер ${PLACEHOLDER_BOT} — задайте --bot=https://t.me/...`);

// 5b. плашка в hero: вместо даты старта продаж — постоянный доступ
js = patch(js, /tag:"Старт продаж[^"]*"/, 'tag:"Доступ по подписке"', "плашка в hero");

// 6. плеер: прогресс идёт от реального воспроизведения (общее состояние __syaPlayer)
js = patch(
  js,
  /function (\w+)\((\w+)\)\{(\w+)===null&&\(\3=\2\),\2-(\w+)>33&&\((\w+)\.value=\(\2-\3\)%(\w+)\/\6,\4=\2\),(\w+)=requestAnimationFrame\(\1\)\}/,
  "function $1($2){$2-$4>33&&(__syaPlayer.playing&&($5.value=__syaPlayer.progress()),$4=$2),$7=requestAnimationFrame($1)}",
  "PlayerCard: цикл requestAnimationFrame прогресса"
);
// кнопка play/pause вместо декоративного span
const ctrlOld = '<div class="flex items-center gap-4 text-brown" aria-hidden="true">';
if (!js.includes(ctrlOld)) fail("не найдено: контейнер кнопок плеера");
js = js.split(ctrlOld).join('<div class="flex items-center gap-4 text-brown">');
const btnOld = '<span class="flex h-9 w-9 items-center justify-center rounded-full bg-olive">' + pauseSvg + "</span>";
if (!js.includes(btnOld)) fail("не найдено: кнопка play в PlayerCard");
const playIco = '<svg class="sya-ico-play translate-x-px" width="10" height="11" viewBox="0 0 10 11" fill="none"><path d="M9.5 5.5 0 10.7V.3L9.5 5.5Z" class="fill-white"></path></svg>';
const pauseIco = pauseSvg.replace('<svg ', '<svg class="sya-ico-pause" ');
js = js.split(btnOld).join(
  '<button type="button" class="sya-play flex h-9 w-9 items-center justify-center rounded-full bg-olive" aria-label="Слушать" aria-pressed="false">' + playIco + pauseIco + "</button>"
);

// 7. «Теперь будет иначе», пункт 03: текст уже, чтобы «теория» переносилась
const narrowVar = must(js.match(/k\("p",(\w+),o\(y\(\w+\)\.items\[2\]\.text\)/), "RecognitionBand items[2].text")[1];
js = patch(js, new RegExp(`\\b${narrowVar}=\\{class:"`), `${narrowVar}={class:"sya-narrow `, "класс описания пункта 03");

// 7b. вертикальный ритм: у всех секций одинаковые отступы сверху и снизу
// hero был без верхнего отступа (над ним стояла своя шапка) — на Тильде меню чужое
js = patch(js, /class:"paper pb-\[var\(--spacing-section\)\] pt-5 md:pt-20"/, 'class:"paper section"', "паддинги hero");
// «Теперь будет иначе»: кнопка на мобильном отрывалась от текста (32px снизу у пункта + 40px mt-10)
js = patch(
  js,
  /class:"btn order-last mt-10 w-full md:order-none md:mt-0 md:w-fit"/,
  'class:"btn order-last mt-3 w-full md:order-none md:mt-0 md:w-fit"',
  "отступ кнопки «Узнать подробнее»"
);
// «Автор аудиоклуба»: на мобильном между цитатой и фото было 56px
js = patch(
  js,
  /class:"grid items-center gap-14 md:grid-cols-\[236px_1fr\] md:gap-16"/,
  'class:"grid items-center gap-8 md:grid-cols-[236px_1fr] md:gap-16"',
  "отступ между текстом и фото автора"
);

// 8. runtime: плавное появление, точки в конце абзацев, плеер с музыкой
const runtime = fs
  .readFileSync(path.join(ROOT, "scripts/runtime.js"), "utf8")
  .split("__SYA_WRAP_ID__").join(JSON.stringify(WRAP_ID))
  .split("__SYA_REVEAL__").join(JSON.stringify(REVEAL_SELECTORS.join(", ")));

const prelude =
  `var __syaBase=window.SYA_ASSET_BASE||${JSON.stringify(CDN)};` +
  `var __syaMusic=${JSON.stringify(MUSIC_URL)};` +
  `var __syaPlayer={playing:false,progress:function(){return .38}};` +
  // блок с разметкой может быть отдельным блоком Тильды и появиться позже скрипта
  `function __syaMount(app){var n=0;function boot(){var el=document.getElementById(${JSON.stringify(APP_ID)});` +
  `if(!el)return false;if(el.__sya)return true;el.__sya=1;app.mount(el);__syaRuntime();return true}` +
  `if(boot())return;document.addEventListener("DOMContentLoaded",boot);` +
  `var iv=setInterval(function(){if(boot()||++n>200)clearInterval(iv)},50)}`;
js = `(function(){"use strict";${prelude}\n${js.trim()}\n;${runtime}\n})();`;
js = minifyJs(js);

// ---------- CSS ----------
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const P = `.${SCOPE}`;
function mapSelector(sel) {
  sel = sel.trim();
  if (!sel) return null;
  if (sel.startsWith(P)) return sel;
  if (/^(html|body|:root|:host)$/.test(sel)) return P;
  if (/^(html|body)[\s>]/.test(sel)) return sel.replace(/^(html|body)/, P);
  if (sel === "*") return `${P},${P} *`;
  if (/^::?(before|after)$/.test(sel)) return `${P}${sel},${P} *${sel}`;
  if (/^::?(backdrop|file-selector-button)$/.test(sel)) return null;
  if (sel.startsWith("*")) return `${P} ${sel}`;
  return `${P} ${sel}`;
}
function scopeCss(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = e === -1 ? css.length : e + 2; continue; }
    if (/\s/.test(css[i])) { i++; continue; }
    const brace = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    if (css[i] === "@" && semi !== -1 && (brace === -1 || semi < brace)) { i = semi + 1; continue; } // @layer a,b;  @import
    if (brace === -1) break;
    let j = brace, depth = 0;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    const head = css.slice(i, brace).trim();
    const inner = css.slice(brace + 1, j - 1);
    if (head.startsWith("@")) {
      if (/^@layer\b/.test(head)) out += scopeCss(inner);
      else if (/^@(media|supports|container)\b/.test(head)) { const s = scopeCss(inner); if (s.trim()) out += `${head}{${s}}`; }
      else out += css.slice(i, j); // @keyframes, @property, @font-face — как есть
    } else {
      const sels = splitTop(head, ",").map(mapSelector).filter(Boolean);
      if (sels.length) out += `${sels.join(",")}{${inner}}`;
    }
    i = j;
  }
  return out;
}
let css = scopeCss(cssRaw);
css = css.split("#app").join(`#${APP_ID}`);
{
  let d = 0;
  for (const ch of css) { if (ch === "{") d++; else if (ch === "}") d--; if (d < 0) fail("CSS: лишняя }"); }
  if (d !== 0) fail("CSS: незакрытые скобки");
}
const embedCss =
  `#${WRAP_ID}{width:100%;max-width:100%;margin:0;padding:0}` +
  // одинаковый вертикальный ритм: в исходнике часть секций была section (60/100), часть section-sm (40/60)
  `${P}{--spacing-section:clamp(48px,7vw,80px);--spacing-section-sm:clamp(48px,7vw,80px)}` +
  // если браузер сам прыгает по #якорю до старта скрипта — заголовок не уедет под меню Тильды
  `${P} section[id]{scroll-margin-top:76px}` +
  `${P}{display:block;position:relative;isolation:isolate;overflow-x:clip;width:100%;max-width:100%;min-width:0}` +
  `${P} .min-h-screen{min-height:0}` +
  `${P} [data-sya-reveal]{opacity:0;transform:translate3d(0,22px,0);transition:opacity .8s cubic-bezier(.22,.61,.36,1),transform .8s cubic-bezier(.22,.61,.36,1);transition-delay:var(--sya-d,0s);will-change:opacity,transform}` +
  `${P} [data-sya-reveal].sya-in{opacity:1;transform:none}` +
  `@media (prefers-reduced-motion:reduce){${P} [data-sya-reveal]{opacity:1;transform:none;transition:none}}` +
  `${P} .sya-dot{transition:left .12s linear}` +
  `${P} .sya-play{cursor:pointer;-webkit-appearance:none;appearance:none;border:0}` +
  `${P} .sya-ico-pause{display:none}${P}[data-sya-playing] .sya-ico-pause{display:block}${P}[data-sya-playing] .sya-ico-play{display:none}` +
  `@media (min-width:64rem){${P} .sya-narrow{max-width:236px}}`; /* только в 4-колоночной сетке */
css = minifyCss(`${css}\n${embedCss}`);
if (css.includes("</style")) fail("CSS содержит </style: инлайн-стиль так не вставить");

// ---------- вывод ----------
const cssHash = sha1(css).slice(0, 8);
const jsHash = sha1(js).slice(0, 8);
const cssFile = `${NAME}.${cssHash}.css`;
const jsFile = `${NAME}.${jsHash}.js`;
fs.writeFileSync(path.join(ROOT, "assets/tilda", cssFile), css);
fs.writeFileSync(path.join(ROOT, "assets/tilda", jsFile), js);
produced.add(cssFile); produced.add(jsFile);

if (flag("clean")) {
  for (const dir of ["assets/img", "assets/tilda"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!produced.has(f) && /\.(webp|css|js)$/.test(f)) { fs.unlinkSync(path.join(ROOT, dir, f)); console.log("удалён старый файл", dir + "/" + f); }
    }
  }
}

const wrapHtml = `<div id="${WRAP_ID}" class="${SCOPE}"><div id="${APP_ID}"></div></div>`;
const preloadLinks = (base) => preloads.map((p) => `<link rel="preload" as="image" href="${base}${p}" fetchpriority="high">`).join("");
const headTags = (base) => `${FONTS}${preloadLinks(base)}`;
const styleTag = `<style>${css}</style>`;
// "</script>" внутри строки бандла закрыл бы тег раньше времени
const scriptTag = `<script>${js.split("</script>").join("<\\/script>")}</script>`;

const outputs = {
  "1-css.html": `${headTags(CDN)}${styleTag}`,
  "2-html.html": wrapHtml,
  "3-js.html": scriptTag,
  "all-in-one.html": `${headTags(CDN)}${styleTag}${wrapHtml}${scriptTag}`,
  "external.html": `${headTags(CDN)}<link rel="stylesheet" href="${CDN}assets/tilda/${cssFile}">${wrapHtml}<script src="${CDN}assets/tilda/${jsFile}" defer></script>`,
};
for (const [file, content] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(ROOT, "tilda", file), content + "\n");
}

const index = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<meta name="robots" content="noindex">
${headTags("")}
<link rel="stylesheet" href="assets/tilda/${cssFile}">
<style>html,body{margin:0;padding:0;background:#f5f4f2}</style>
</head>
<body>
<script>window.SYA_ASSET_BASE="./";</script>
${wrapHtml}
<script src="assets/tilda/${jsFile}"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), index);
fs.rmSync(TMP, { recursive: true, force: true });

const size = (p) => kb(fs.statSync(path.join(ROOT, p)).size);
console.log("\nблоки T123 (вставлять по порядку):");
console.log(`  tilda/1-css.html        ${size("tilda/1-css.html")}\tшрифты, preload картинок, стили`);
console.log(`  tilda/2-html.html       ${size("tilda/2-html.html")}\tконтейнер блока`);
console.log(`  tilda/3-js.html         ${size("tilda/3-js.html")}\tприложение (рисует разметку)`);
console.log("\nальтернативы одним блоком:");
console.log(`  tilda/all-in-one.html   ${size("tilda/all-in-one.html")}\tвсё сразу`);
console.log(`  tilda/external.html     ${size("tilda/external.html")}\tCSS и JS с jsDelivr`);
console.log(`\nassets/tilda/${cssFile}\t${size(`assets/tilda/${cssFile}`)}`);
console.log(`assets/tilda/${jsFile}\t${size(`assets/tilda/${jsFile}`)}`);
console.log("index.html — превью");
