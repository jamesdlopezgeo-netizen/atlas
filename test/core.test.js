'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../js/core.js');

const sample = (name) => fs.readFileSync(path.join(__dirname, '..', 'samples', name + '.json'), 'utf8');

test('sha256 matches node crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'héllo ✓ 𝄞']) {
    assert.strictEqual(A.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('canonical JSON sorts keys and drops whitespace', () => {
  assert.strictEqual(A.canonicalize({ b: 1, a: { d: [1, { z: 'a b', y: null }], c: true } }), '{"a":{"c":true,"d":[1,{"y":null,"z":"a b"}]},"b":1}');
});

test('untouched issued sample passes; draft sample passes as draft', () => {
  const issued = A.verifyPackage(sample('issued'));
  assert.ok(issued.hash.pass && issued.chain.pass && issued.consistency.pass);
  assert.strictEqual(issued.pkg.status, 'issued');
  assert.deepStrictEqual(issued.concerns, []);

  const draft = A.verifyPackage(sample('unapproved'));
  assert.ok(draft.hash.pass && draft.consistency.pass);
  assert.strictEqual(draft.pkg.status, 'draft');
  assert.ok(draft.concerns.some((c) => c.code === 'MISSING_APPROVAL'));
  assert.strictEqual(draft.pkg.outline.named_approval, null);
});

test('altered sample fails and the changed field is located', () => {
  const r = A.verifyPackage(sample('altered'));
  assert.strictEqual(r.hash.pass, false);
  assert.deepStrictEqual(r.consistency.diffs.map((d) => d.path), ['outline.validation.type']);
});

test('any single changed field fails the hash', () => {
  const pkg = JSON.parse(sample('issued'));
  for (const mutate of [
    (p) => { p.status = 'draft'; },
    (p) => { p.cover_sheet.batch += ' '; },
    (p) => { p.events[0].payload.version = '2.3.2'; },
    (p) => { p.outline.named_approval.person = 'Someone else'; },
    (p) => { p.extra = 1; }
  ]) {
    const copy = JSON.parse(JSON.stringify(pkg));
    mutate(copy);
    assert.strictEqual(A.verifyPackage(copy).hash.pass, false);
  }
  // Reformatting whitespace or key order does not change the hash.
  const reordered = Object.fromEntries(Object.entries(pkg).reverse());
  assert.ok(A.verifyPackage(JSON.stringify(reordered)).hash.pass);
});

test('editing a sealed event breaks the chain even if the package is re-hashed', () => {
  const pkg = JSON.parse(sample('issued'));
  pkg.events[1].payload.validation_type = 'peer-review';
  pkg.package_hash = A.packageHash(pkg);
  const r = A.verifyPackage(pkg);
  assert.ok(r.hash.pass);
  assert.strictEqual(r.chain.pass, false);
});

test('draft until approved; correction after approval returns to draft', () => {
  const ev = [];
  const add = (type, payload) => ev.push(A.sealEvent(ev, { type, at: '2026-01-01T00:00:00Z', payload }));
  const h = 'a'.repeat(64);
  assert.strictEqual(A.canSeal(ev, A.EVENT.VALIDATED), 'Seal a Registered event first.');
  add(A.EVENT.REGISTERED, { claim: { project_name: 'P', project_id: 'X', registry_face: 'verra', protocol: 'VM0049', batch: 'B' }, ai_system: 'S', version: '1', artifact_hash: h, inputs: '' });
  add(A.EVENT.VALIDATED, { data_snapshot_hash: h, validation_type: 'empirical', summary: 's', reference: '' });
  assert.ok(A.canSeal(ev, A.EVENT.ISSUED));
  assert.strictEqual(A.buildPackage({ recordId: 'r', events: ev, face: 'verra', generatedAt: 't' }).status, 'draft');
  add(A.EVENT.APPROVED, { person: 'N', role: 'R', approved_at: 't', intended_use: 'u' });
  add(A.EVENT.ISSUED, { face: 'verra' });
  const pkg = A.buildPackage({ recordId: 'r', events: ev, face: 'verra', generatedAt: 't' });
  assert.strictEqual(pkg.status, 'issued');
  assert.deepStrictEqual(pkg.cover_sheet.methodology, 'VM0049');
  assert.strictEqual(A.buildPackage({ recordId: 'r', events: ev, face: 'puro', generatedAt: 't' }).status, 'draft');
  add(A.EVENT.CORRECTION, { field: 'ai_version', previous: '1', value: '1.1', reason: 'x' });
  const after = A.buildPackage({ recordId: 'r', events: ev, face: 'verra', generatedAt: 't' });
  assert.strictEqual(after.status, 'draft');
  assert.ok(after.concerns.some((c) => c.code === 'APPROVAL_PRECEDES_CORRECTION'));
  assert.strictEqual(after.outline.source.version, '1.1');
  assert.strictEqual(A.canSeal(ev, A.EVENT.APPROVED), null);
});

test('the Python one-liner on the Verify page recomputes the same hash', (t) => {
  let py;
  try { py = execFileSync('python3', ['--version']); } catch (e) { return t.skip('python3 not available'); }
  const code = "import json,hashlib,sys; d=json.load(open(sys.argv[1])); h=d.pop('package_hash'); " +
    "c=json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=False); print(h==hashlib.sha256(c.encode()).hexdigest())";
  const run = (name) => execFileSync('python3', ['-c', code, path.join(__dirname, '..', 'samples', name + '.json')]).toString().trim();
  assert.strictEqual(run('issued'), 'True');
  assert.strictEqual(run('unapproved'), 'True');
  assert.strictEqual(run('altered'), 'False');
});

test('sample files are up to date with the builder', () => {
  const before = ['issued', 'unapproved', 'altered'].map(sample);
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'build-samples.js')]);
  assert.deepStrictEqual(['issued', 'unapproved', 'altered'].map(sample), before);
});
