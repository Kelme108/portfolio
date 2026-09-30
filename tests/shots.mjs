// Viewport screenshots of key UI states → tests/output/state-*.png (serve from responsive.mjs server logic)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SITE = path.resolve('../_site'), BASE = '/portfolio', OUT = path.resolve('output');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let f = path.join(SITE, decodeURIComponent(req.url.split('?')[0]).slice(BASE.length));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(4001);
const O = 'http://localhost:4001' + BASE;
const browser = await chromium.launch();

async function shot(name, { w, h, url, scheme = 'dark', act }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await page.goto(O + url, { waitUntil: 'load' });
  if (act) await act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/state-${name}.png` });
  await ctx.close();
}

await shot('writeup-top-1440', { w: 1440, h: 900, url: '/writeups/hackthebox/icemagic-writeup/' });
await shot('writeup-mid-1440', { w: 1440, h: 900, url: '/writeups/hackthebox/icemagic-writeup/', act: p => p.evaluate(() => document.querySelector('#q3--beacon-ip-and-port, h2:nth-of-type(4)').scrollIntoView({ behavior: 'instant' })) });
await shot('writeup-top-375', { w: 375, h: 812, url: '/writeups/hackthebox/unified/' });
await shot('writeup-code-375', { w: 375, h: 812, url: '/writeups/hackthebox/splunk-it-writeup/', act: p => p.evaluate(() => document.querySelectorAll('div.highlighter-rouge')[1].scrollIntoView({ block: 'center', behavior: 'instant' })) });
await shot('writeup-table-375', { w: 375, h: 812, url: '/writeups/hackthebox/splunk-it-writeup/', act: p => p.evaluate(() => document.querySelector('.table-scroll').scrollIntoView({ block: 'center', behavior: 'instant' })) });
await shot('drawer-375', { w: 375, h: 812, url: '/', act: p => p.click('[data-nav-open]') });
await shot('palette-375', { w: 375, h: 812, url: '/', act: async p => { await p.click('[data-search-open]'); await p.fill('#palette-q', 'splunk'); } });
await shot('writeups-768', { w: 768, h: 1024, url: '/writeups/' });
await shot('home-light-1280', { w: 1280, h: 800, url: '/', scheme: 'light' });
await shot('home-dark-1024', { w: 1024, h: 768, url: '/' });
await shot('about-375', { w: 375, h: 812, url: '/about/', act: p => p.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' })) });
await shot('writeup-light-1280', { w: 1280, h: 800, url: '/writeups/hackthebox/oopsie-writeup/', scheme: 'light', act: p => p.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' })) });

await browser.close(); server.close();
