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
  add(A.EVENT.APPROVED, { person: 'N', role: 'R', approved_at: '2026-01-02T00:00:00Z', intended_use: 'u' });
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

/* ---- Step 0: rules in core, verify replays them, frozen vectors ---- */

const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const AT = '2026-01-01T00:00:00Z';
const CLAIM = { project_name: 'P', project_id: 'X', registry_face: 'isometric', protocol: 'p', batch: 'B' };
const REG = { claim: CLAIM, ai_system: 'S', version: '1', artifact_hash: H1, inputs: '' };
const VAL = { data_snapshot_hash: H1, validation_type: 'hold-out', summary: 's', reference: '' };
const APPR = { person: 'N', role: 'R', approved_at: AT, intended_use: 'u' };

function chain(steps, seal = A.sealEvent) {
  const ev = [];
  for (const [type, payload] of steps) ev.push(seal(ev, { type, at: AT, payload }));
  return ev;
}
const pkgOf = (events, face = 'isometric') => A.buildPackage({ recordId: 'r', events, face, generatedAt: AT });

test('sha256Bytes hashes bytes; sha256Hex refuses non-strings', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const want = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  assert.strictEqual(A.sha256Bytes(bytes), want);
  assert.strictEqual(A.sha256Bytes(bytes.buffer), want);
  assert.strictEqual(A.sha256Bytes(new Uint8Array([9, 0, 1, 2, 250, 255]).subarray(1)), want);
  for (const bad of [new ArrayBuffer(2), bytes, 42, null, undefined, { a: 1 }]) {
    assert.throws(() => A.sha256Hex(bad), TypeError);
  }
  assert.throws(() => A.sha256Bytes('text'), TypeError);
});

test('sealEvent rejects payloads the form used to catch (review probe cases)', () => {
  const base = chain([[A.EVENT.REGISTERED, REG]]);
  const reject = (events, type, payload, re) =>
    assert.throws(() => A.sealEvent(events, { type, at: AT, payload }), re);

  reject(base, A.EVENT.VALIDATED, { ...VAL, validation_type: 'not-a-type' }, /Validation type must be one of/);
  reject(base, A.EVENT.VALIDATED, { ...VAL, data_snapshot_hash: 'abc' }, /must be a SHA-256/);
  reject(base, A.EVENT.VALIDATED, { ...VAL, extra: 1 }, /Unknown field: extra/);
  reject(base, A.EVENT.CORRECTION, { field: 'no_such_field', value: 'y', reason: 'r' }, /Corrected field must be one of/);
  reject(base, A.EVENT.CORRECTION, { field: 'data_snapshot_hash', value: H2, reason: 'r' }, /before a Validated event/);
  reject(base, A.EVENT.CORRECTION, { field: 'ai_version', previous: 'aaa', value: '2', reason: 'r' }, /Previous value does not match/);
  reject(base, A.EVENT.CORRECTION, { field: 'ai_version', value: '1', reason: 'r' }, /same as the current value/);
  reject(base, A.EVENT.CORRECTION, { field: 'artifact_hash', value: 'nothex', reason: 'r' }, /must be a SHA-256/);
  reject(base, A.EVENT.CORRECTION, { field: 'ai_version', value: '2', reason: '' }, /Reason is required/);
  reject([], A.EVENT.REGISTERED, { ...REG, claim: { ...CLAIM, registry_face: 'gold' } }, /Registry face must be one of/);
  reject([], A.EVENT.REGISTERED, { ...REG, claim: { ...CLAIM, project_name: '' } }, /Project name is required/);
  reject([], A.EVENT.REGISTERED, { ...REG, version: 2 }, /Version must be text/);
  reject([], 'Observed', { note: 'x' }, /Unknown event type/);
  const validated = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL]]);
  reject(validated, A.EVENT.APPROVED, { ...APPR, approved_at: 'yesterday' }, /ISO 8601/);
  assert.throws(() => A.sealEvent(base, { type: A.EVENT.VALIDATED, payload: VAL }), /seal time/);
  assert.strictEqual(A.checkSeal(base, { type: A.EVENT.VALIDATED, at: AT, payload: VAL }), null);
});

test('a Correction gets its previous value from the record', () => {
  const ev = chain([[A.EVENT.REGISTERED, REG]]);
  const input = { field: 'ai_version', value: '2', reason: 'r' };
  const c = A.sealEvent(ev, { type: A.EVENT.CORRECTION, at: AT, payload: input });
  assert.strictEqual(c.payload.previous, '1');
  assert.strictEqual(input.previous, undefined, 'caller payload is not mutated');
  // Inputs may be corrected from empty to text and back.
  ev.push(c);
  ev.push(A.sealEvent(ev, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'inputs', value: 'wind', reason: 'r' } }));
  assert.strictEqual(ev[2].payload.previous, '');
});

test('verify replays the rules: unknown types and invalid lines are reported', () => {
  // Built with sealUnchecked so the chain itself is intact; only the rules catch these.
  const unknown = chain([[A.EVENT.REGISTERED, REG], ['Observed', { kind: 'unavailable' }]], A.sealUnchecked);
  let r = A.verifyPackage(pkgOf(unknown));
  assert.ok(r.hash.pass && r.chain.pass && r.consistency.pass);
  assert.strictEqual(r.rules.pass, false);
  assert.match(r.rules.problems[0].message, /Line 2 \(Observed\): unknown event type/);

  const badPayload = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, { ...VAL, validation_type: 'not-a-type' }]], A.sealUnchecked);
  r = A.verifyPackage(pkgOf(badPayload));
  assert.strictEqual(r.rules.pass, false);
  assert.match(r.rules.problems[0].message, /Validation type must be one of/);

  // Approved + Issued with nothing before them used to verify as "issued".
  const skipped = chain([[A.EVENT.APPROVED, APPR], [A.EVENT.ISSUED, { face: 'isometric' }]], A.sealUnchecked);
  r = A.verifyPackage(pkgOf(skipped));
  assert.strictEqual(r.rules.pass, false);
  assert.ok(r.rules.problems.some((p) => /out of order/.test(p.message)));

  const extraKey = chain([[A.EVENT.REGISTERED, REG]]);
  extraKey[0] = { ...extraKey[0], note: 'x' };
  extraKey[0].hash = A.eventHash(extraKey[0]);
  r = A.verifyPackage(pkgOf(extraKey));
  assert.ok(r.rules.problems.some((p) => /unknown field note/.test(p.message)));
});

test('verify reports status as of the last line, and origin as not checked', () => {
  const r = A.verifyPackage(sample('issued'));
  assert.deepStrictEqual(r.asOf, { seq: 5, head: r.pkg.event_chain_head });
  assert.ok(r.rules.pass);
  assert.strictEqual(r.origin.checked, false);
  assert.match(r.origin.text, /does not sign packages/);
});

test('verify dispatches on format and survives malformed events', () => {
  const pkg = JSON.parse(sample('issued'));
  pkg.format = 'allocycle.package/v9';
  pkg.package_hash = A.packageHash(pkg);
  let r = A.verifyPackage(pkg);
  assert.ok(r.ok && r.hash.pass);
  assert.strictEqual(r.checked, false);
  assert.match(r.reason, /Unknown package format/);

  const broken = JSON.parse(sample('issued'));
  broken.events[1] = null;
  r = A.verifyPackage(broken);
  assert.ok(r.ok);
  assert.strictEqual(r.checked, false);
  assert.strictEqual(r.hash.pass, false);
});

test('frozen v1 vectors: builder reproduces them and never rewrites them', () => {
  const dir = path.join(__dirname, '..', 'samples');
  const before = ['issued', 'unapproved', 'altered'].map((n) => fs.statSync(path.join(dir, n + '.json')).mtimeMs);
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'build-samples.js')]);
  const after = ['issued', 'unapproved', 'altered'].map((n) => fs.statSync(path.join(dir, n + '.json')).mtimeMs);
  assert.deepStrictEqual(after, before);
  // Hashes pinned so an accidental change to the vectors, hashing or derivation is caught.
  const pinned = {
    issued: '07bb844a71256f33a09bc22aa085fb009e671f81adfe08f29c68e83b8450dd7f',
    unapproved: 'abda09474f8fc0b1d3d96c5a1aa2f81adf68a79e14ab18cba65d800ef901d995'
  };
  for (const [name, hash] of Object.entries(pinned)) {
    assert.strictEqual(JSON.parse(sample(name)).package_hash, hash);
    assert.strictEqual(A.verifyPackage(sample(name)).hash.recomputed, hash);
  }
  assert.strictEqual(JSON.parse(sample('altered')).package_hash, pinned.issued);
});
