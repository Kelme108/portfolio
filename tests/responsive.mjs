// Responsive + accessibility smoke test for the built site (_site/).
// Run (Docker, from repo root):
//   docker run --rm -v "${PWD}:/work" -w /work/tests mcr.microsoft.com/playwright:v1.49.0-noble \
//     bash -c "npm i --silent playwright@1.49.0 @axe-core/playwright@4.10.1 && node responsive.mjs"
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SITE = path.resolve('../_site');
const BASE = '/portfolio';
const OUT = path.resolve('output');
const SHOTS = process.env.SHOTS !== '0';
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  let file = path.join(SITE, url.slice(BASE.length));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(SITE, '404.html'))); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(4000);

const ORIGIN = 'http://localhost:4000' + BASE;
const PAGES = {
  home: '/', writeups: '/writeups/', icemagic: '/writeups/hackthebox/icemagic-writeup/',
  unified: '/writeups/hackthebox/unified/', splunk: '/writeups/hackthebox/splunk-it-writeup/',
  oopsie: '/writeups/hackthebox/oopsie-writeup/', about: '/about/', tags: '/tags/',
  categories: '/categories/', archives: '/archives/', projects: '/projects/', notfound: '/nope/',
};
const VIEWPORTS = [[320, 640], [375, 812], [414, 896], [600, 960], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [740, 360]];

const browser = await chromium.launch();
const failures = [];
const rows = [];

// Block external requests (Google Fonts) so the run is deterministic/offline-safe
async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { page, errors };
}

for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 1024, colorScheme: 'dark' });
  for (const [name, p] of Object.entries(PAGES)) {
    const { page, errors } = await newPage(ctx);
    await page.goto(ORIGIN + p, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const scrollW = document.documentElement.scrollWidth;
      const clipped = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).position === 'fixed') continue;
        if (el.closest('.sidebar, dialog')) continue;
        if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) offenders.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ` [${Math.round(r.left)}→${Math.round(r.right)}]`);
      }
      // tap targets under 44px (visible links/buttons outside running text)
      const small = [...document.querySelectorAll('button, .btn, .menu a, .icon-btn, .chip-toggle span')]
        .filter(el => el.offsetParent !== null).map(el => el.getBoundingClientRect())
        .filter(r => r.height > 0 && r.height < 32).length;
      return { vw, scrollW, offenders: offenders.slice(0, 5), small };
    });
    const ok = res.scrollW <= res.vw && res.offenders.length === 0 && errors.length === 0;
    rows.push({ page: name, width: w, height: h, ok, ...res, errors });
    if (!ok) failures.push(`${name} @${w}x${h}: scrollWidth ${res.scrollW} > ${res.vw}? offenders=${JSON.stringify(res.offenders)} errors=${JSON.stringify(errors)}`);
    if (SHOTS && [320, 375, 768, 1280, 1440].includes(w) && h !== 360) {
      await page.evaluate(() => Promise.all([...document.images].map(i => { i.loading = 'eager'; return i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }); })));
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
    }
    await page.close();
  }
  await ctx.close();
}

// ---- Interaction checks ----
const checks = [];
async function check(label, fn) {
  try { await fn(); checks.push(`PASS ${label}`); } catch (e) { checks.push(`FAIL ${label}: ${e.message}`); failures.push(label + ': ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const { page } = await newPage(ctx);
  await page.goto(ORIGIN + '/');
  await check('mobile: menu button visible, nav hidden', async () => {
    assert(await page.isVisible('[data-nav-open]'), 'menu button hidden');
    assert(!(await page.isVisible('.menu a')), 'nav visible before opening');
  });
  await check('mobile: drawer opens, traps focus, Esc closes', async () => {
    await page.click('[data-nav-open]');
    await page.waitForTimeout(350);
    assert(await page.isVisible('.menu a'), 'nav not visible after open');
    assert(await page.getAttribute('[data-nav-open]', 'aria-expanded') === 'true', 'aria-expanded not true');
    assert(await page.evaluate(() => document.querySelector('.main').hasAttribute('inert')), 'main not inert');
    assert(await page.evaluate(() => !!document.activeElement.closest('#site-nav')), 'focus not moved into nav');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    assert(!(await page.isVisible('.menu a')), 'nav still visible after Esc');
  });
  await check('mobile: backdrop click closes drawer', async () => {
    await page.click('[data-nav-open]'); await page.waitForTimeout(350);
    await page.mouse.click(360, 400); await page.waitForTimeout(350);
    assert(!(await page.isVisible('.menu a')), 'drawer did not close');
  });
  await check('search palette: opens from topbar, finds Log4Shell', async () => {
    await page.click('[data-search-open]');
    await page.fill('#palette-q', 'log4shell');
    await page.waitForSelector('#palette-results [role="option"]');
    const first = await page.textContent('#palette-results [role="option"] strong');
    assert(/Unified/.test(first), 'first result was ' + first);
    await page.keyboard.press('Enter');
    await page.waitForURL(/unified/);
  });
  await check('write-up: TOC built and collapsed on mobile', async () => {
    const n = await page.locator('.toc-nav a').count();
    assert(n > 3, 'toc links ' + n);
    assert(!(await page.getAttribute('[data-toc]', 'open') !== null), 'toc open on mobile');
  });
  await check('write-up: copy buttons + tables wrapped', async () => {
    await page.goto(ORIGIN + '/writeups/hackthebox/splunk-it-writeup/');
    assert(await page.locator('.copy-btn').count() > 5, 'no copy buttons');
    assert(await page.locator('.table-scroll table').count() >= 1, 'table not wrapped');
  });
  await check('write-up: image opens lightbox', async () => {
    await page.goto(ORIGIN + '/writeups/hackthebox/oopsie-writeup/');
    const img = page.locator('#post-content img').first();
    await img.scrollIntoViewIfNeeded(); await img.click();
    await page.waitForSelector('dialog.lightbox[open] img', { state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
  });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await newPage(ctx);
  await page.goto(ORIGIN + '/writeups/hackthebox/icemagic-writeup/');
  await check('desktop: sidebar visible, topbar hidden, TOC open', async () => {
    assert(await page.isVisible('.menu a'), 'sidebar hidden');
    assert(!(await page.isVisible('.topbar')), 'topbar visible');
    assert(await page.getAttribute('[data-toc]', 'open') !== null, 'toc closed');
  });
  await check('desktop: Ctrl+K toggles palette', async () => {
    await page.keyboard.press('Control+k');
    assert(await page.isVisible('#palette'), 'palette not open');
    await page.keyboard.press('Escape');
  });
  await check('theme toggle persists light', async () => {
    await page.click('[data-theme-value="light"]');
    await page.reload();
    assert(await page.getAttribute('html', 'data-theme') === 'light', 'theme not persisted');
    await page.click('[data-theme-value="system"]');
  });
  await check('filters: difficulty=medium shows only Icemagic + URL state', async () => {
    await page.goto(ORIGIN + '/writeups/?difficulty=medium');
    const visible = await page.locator('[data-filter-list] .wcard:visible').count();
    assert(visible === 1, 'visible ' + visible);
    await page.fill('input[name="q"]', 'zzzz');
    assert(await page.isVisible('[data-filter-empty]'), 'empty state hidden');
    assert(/q=zzzz/.test(page.url()), 'url not updated');
  });
  await ctx.close();
}

// ---- axe accessibility ----
const axeRows = [];
for (const [w, h] of [[375, 812], [1280, 800]]) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    for (const [name, p] of Object.entries(PAGES)) {
      const { page } = await newPage(ctx);
      await page.goto(ORIGIN + p);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      for (const v of r.violations) axeRows.push(`${name} @${w} ${scheme}: [${v.impact}] ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`);
      await page.close();
    }
    await ctx.close();
  }
}

await browser.close();
server.close();

const passed = rows.filter(r => r.ok).length;
const table = ['| page | ' + VIEWPORTS.map(v => v.join('×')).join(' | ') + ' |', '|---|' + VIEWPORTS.map(() => '---').join('|') + '|'];
for (const name of Object.keys(PAGES)) table.push(`| ${name} | ` + VIEWPORTS.map(([w, h]) => rows.find(r => r.page === name && r.width === w && r.height === h).ok ? 'pass' : '**FAIL**').join(' | ') + ' |');
const report = [`Layout: ${passed}/${rows.length} page×viewport combinations without horizontal overflow or JS errors`, '', ...table, '', 'Interactions:', ...checks, '', `axe (WCAG 2.1 AA) violations: ${axeRows.length}`, ...axeRows].join('\n');
fs.writeFileSync(`${OUT}/report.md`, report);
console.log(report);
if (failures.length) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exitCode = 1; }
