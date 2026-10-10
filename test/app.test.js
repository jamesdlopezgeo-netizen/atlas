'use strict';
/*
 * Browser tests for the app layer: they drive the real pages in Chromium.
 * They need Playwright (installed locally or globally); without it they are
 * skipped, and the core tests still run.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const A = require('../js/core.js');

const ROOT = path.join(__dirname, '..');
const STORE_KEY = 'allocycle.records.v1';

function findPlaywright() {
  try { return require('playwright'); } catch (e) { /* try the global install */ }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { return null; }
}
const pw = findPlaywright();
const skip = pw ? false : 'Playwright is not installed';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let server, base, browser;

test.before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await pw.chromium.launch();
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// A fresh browser profile per test; confirms are accepted, page errors kept.
async function page() {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  return p;
}
async function newRecord(p) {
  await p.goto(base + '#/new');
  await p.fill('[name=project_name]', 'Test project');
  await p.fill('[name=project_id]', 'P-1');
  await p.fill('[name=protocol]', 'Protocol');
  await p.fill('[name=batch]', 'Batch 1');
  await p.click('text=Open the record');
  await p.waitForSelector('#register-form');
  return p.evaluate(() => location.hash.split('/').pop());
}
async function register(p) {
  await p.fill('[name=ai_system]', 'Model');
  await p.fill('[name=version]', '1.0');
  await p.click('#register-form [data-fill]');
  await p.click('text=Seal Registered event');
  await p.waitForSelector('#validate-form');
}
async function validate(p) {
  await p.click('#validate-form [data-fill]');
  await p.fill('[name=summary]', 'Within the stated envelope');
  await p.click('text=Seal Validated event');
  await p.waitForSelector('#approve-form');
}
async function approve(p) {
  await p.fill('[name=person]', 'A. Person');
  await p.fill('[name=role]', 'Lead');
  await p.fill('[name=intended_use]', 'Screening support');
  await p.click('text=Seal Approved for use event');
  await p.waitForSelector('[data-issue]');
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), STORE_KEY);
async function verifyText(p, json) {
  await p.goto(base + '#/verify');
  await p.fill('#pkg-input', typeof json === 'string' ? json : JSON.stringify(json));
  await p.click('#verify-btn');
  await p.waitForSelector('#verify-out .verdict');
  return p.$eval('#verify-out .verdict-label', (e) => e.textContent);
}

test('a record goes from Register to an issued package that Verify passes', { skip }, async () => {
  const p = await page();
  await newRecord(p);
  await register(p);
  await validate(p);
  await approve(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-issue=isometric]')]);
  const pkg = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.strictEqual(pkg.status, 'issued');
  assert.ok(A.verifyPackage(pkg).consistent);
  assert.strictEqual(await verifyText(p, pkg), 'PASS');
  assert.deepStrictEqual(p.errors, []);
});

test('a second tab cannot overwrite sealed lines', { skip }, async () => {
  const p = await page();
  const id = await newRecord(p);
  await register(p);
  // Another tab seals Validated; this page does not hear about it.
  await p.evaluate(([k, id]) => {
    const list = JSON.parse(localStorage.getItem(k));
    const r = list.find((x) => x.id === id);
    r.events.push(Allocycle.sealEvent(r.events, { type: 'Validated', at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      payload: { data_snapshot_hash: 'b'.repeat(64), validation_type: 'empirical', summary: 'other tab', reference: '' } }));
    localStorage.setItem(k, JSON.stringify(list));
  }, [STORE_KEY, id]);
  await p.click('#validate-form [data-fill]');
  await p.fill('[name=summary]', 'this tab');
  await p.click('text=Seal Validated event');
  await p.waitForSelector('.notice');
  const r = (await stored(p)).find((x) => x.id === id);
  assert.deepStrictEqual(r.events.map((e) => e.payload.summary || e.type), ['Registered', 'other tab']);
  assert.match(await p.textContent('.notice'), /changed in another tab/);
});

test('a full browser storage is reported, not shown as sealed', { skip }, async () => {
  const p = await page();
  const id = await newRecord(p);
  await register(p);
  await p.evaluate(() => {
    let n = 0;
    for (let size = 1 << 20; size >= 1; size >>= 1) {
      for (;;) { try { localStorage.setItem('fill' + (n++), 'x'.repeat(size)); } catch (e) { break; } }
    }
  });
  await p.click('#validate-form [data-fill]');
  await p.fill('[name=summary]', 'ok');
  await p.click('text=Seal Validated event');
  await p.waitForSelector('.form-error');
  assert.match(await p.textContent('.form-error'), /^Not saved/);
  assert.ok(await p.$('#validate-form'), 'the Validate form is still there');
  assert.strictEqual((await stored(p)).find((x) => x.id === id).events.length, 1);
});

test('a damaged record is locked', { skip }, async () => {
  const p = await page();
  const id = await newRecord(p);
  await register(p);
  await validate(p);
  await p.evaluate(([k, id]) => {
    const list = JSON.parse(localStorage.getItem(k));
    list.find((x) => x.id === id).events[1].payload.summary = 'edited outside allocycle';
    localStorage.setItem(k, JSON.stringify(list));
  }, [STORE_KEY, id]);
  await p.reload();
  await p.waitForSelector('.damaged');
  assert.strictEqual((await p.$$('#approve-form, #correction-form, [data-draft], [data-issue]')).length, 0);
  assert.match(await p.textContent('.head-pills'), /Chain broken/);
});

test('Verify: samples, a re-hashed tampered file, and a forged notice', { skip }, async () => {
  const p = await page();
  const sample = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', n + '.json'), 'utf8'));
  assert.strictEqual(await verifyText(p, sample('issued')), 'PASS');
  assert.strictEqual(await verifyText(p, sample('altered')), 'FAIL');
  const tampered = sample('issued');
  tampered.events[3].payload.person = 'Someone else';
  tampered.package_hash = A.packageHash(tampered);
  assert.strictEqual(await verifyText(p, tampered), 'FAIL');
  const forged = sample('unapproved');
  forged.scope = 'allocycle scored this credit.';
  forged.package_hash = A.packageHash(forged);
  assert.strictEqual(await verifyText(p, forged), 'FAIL');
  assert.match(await p.textContent('.status-card'), /does not score the credit/);
  assert.deepStrictEqual(p.errors, []);
});

test('every page renders without script errors', { skip }, async () => {
  const p = await page();
  for (const route of ['#/', '#/records', '#/new', '#/record/sample-issued', '#/record/sample-unapproved', '#/record/nope',
    '#/record/%E0%A4%A', '#/agents', '#/agents/correction', '#/verify', '#/verify/issued', '#/verify/__proto__', '#/elsewhere']) {
    await p.goto(base + route);
    await p.waitForSelector('h1');
  }
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(await p.title(), 'Not found · allocycle');
});
