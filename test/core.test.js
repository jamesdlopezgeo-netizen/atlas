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
  add(A.EVENT.APPROVED, { person: 'N', role: 'R', approved_at: '2026-01-01T00:00:00Z', intended_use: 'u' });
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
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'build-samples.js'), '--check']);
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
  assert.match(r.rules.problems[0].message, /Line 2 \("Observed"\): unknown event type/);

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

  // A malformed v1 file fails its checks; it is never merely "not checked".
  const broken = JSON.parse(sample('issued'));
  broken.events[1] = null;
  r = A.verifyPackage(broken);
  assert.ok(r.ok && r.checked);
  assert.strictEqual(r.hash.pass, false);
  assert.strictEqual(r.chain.pass, false);
  assert.strictEqual(r.rules.pass, false);
  assert.strictEqual(r.consistent, false);

  const noEvents = JSON.parse(sample('issued'));
  delete noEvents.events;
  noEvents.package_hash = A.packageHash(noEvents);
  r = A.verifyPackage(noEvents);
  assert.ok(r.checked && r.hash.pass);
  assert.strictEqual(r.chain.pass, false);
  assert.strictEqual(r.rules.pass, false);
  assert.strictEqual(r.status.derived, 'draft');
});

test('frozen v1 vectors: builder reproduces them and never rewrites them', () => {
  const dir = path.join(__dirname, '..', 'samples');
  const names = ['issued', 'unapproved', 'altered', 'issued-verra', 'issued-puro'];
  const before = names.map((n) => fs.statSync(path.join(dir, n + '.json')).mtimeMs).concat(fs.statSync(path.join(__dirname, '..', 'js', 'samples-data.js')).mtimeMs);
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'build-samples.js'), '--check']);
  const after = names.map((n) => fs.statSync(path.join(dir, n + '.json')).mtimeMs).concat(fs.statSync(path.join(__dirname, '..', 'js', 'samples-data.js')).mtimeMs);
  assert.deepStrictEqual(after, before);
  // Hashes pinned so an accidental change to the vectors, hashing or derivation is caught.
  const pinned = {
    issued: '07bb844a71256f33a09bc22aa085fb009e671f81adfe08f29c68e83b8450dd7f',
    unapproved: 'abda09474f8fc0b1d3d96c5a1aa2f81adf68a79e14ab18cba65d800ef901d995',
    'issued-verra': 'd2d6273acdc8df1050c46fe56ecd2abce98dcafdb269548410e9bad212687147',
    'issued-puro': '72fd27a4ab66181ebdb714078a0212d6345e52a9b3f338ca859eaf3916f6a9fb'
  };
  for (const [name, hash] of Object.entries(pinned)) {
    assert.strictEqual(JSON.parse(sample(name)).package_hash, hash);
    assert.strictEqual(A.verifyPackage(sample(name)).hash.recomputed, hash);
  }
  assert.strictEqual(JSON.parse(sample('altered')).package_hash, pinned.issued);
  // And the exact bytes of each file, independent of the builder.
  const fileDigests = {
    issued: 'c7025696ca6a8e091b94fc85b051b401a10e7fbc2ede2c8fd233dbf479459271',
    unapproved: '38ad7d7cbadeed10496457dfb2016e6a653b8e050f9f48b237e3556784005091',
    altered: 'fad648e3edfc76c17173c014980eeee3581a8c67fb066c17a5d392e4a6082c0d',
    'issued-verra': '0508b5cf0666d5c5baea218ed7d8a117bb9c89bc42796be45b4f8bbdccd6203c',
    'issued-puro': '8066053fc2e06c3c1302b33227f1b10ae47a287c62cd5aca5d4579b1131c70f6'
  };
  for (const [name, digest] of Object.entries(fileDigests)) {
    assert.strictEqual(A.sha256Bytes(fs.readFileSync(path.join(dir, name + '.json'))), digest, name + '.json bytes changed');
  }
});

/* ---- Fixes from the step 0 review ---- */

function rehash(pkg, events) {
  pkg.events = events;
  pkg.event_chain_head = events.length ? events[events.length - 1].hash : A.GENESIS;
  pkg.package_hash = A.packageHash(pkg);
  return JSON.parse(JSON.stringify(pkg));
}
const resealed = (mutate) => {
  const pkg = JSON.parse(sample('issued'));
  const out = [];
  pkg.events.forEach((ev, i) => {
    const spec = { type: ev.type, at: ev.sealed_at, payload: ev.payload };
    mutate(spec, i);
    out.push(A.sealUnchecked(out, spec));
  });
  return rehash(pkg, out);
};

test('a null payload cannot hide rule or chain failures behind "not checked"', () => {
  for (const line of [2, 3]) { // Correction, Approved for use
    const r = A.verifyPackage(resealed((spec, i) => { if (i === line) spec.payload = null; }));
    assert.ok(r.checked, 'line ' + (line + 1));
    assert.strictEqual(r.rules.pass, false);
    assert.ok(r.rules.problems.some((p) => /payload must be an object/.test(p.message)));
    assert.strictEqual(r.consistent, false);
  }
  // Registered + Issued with no approval, plus a null-payload approval line.
  const ev = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.ISSUED, { face: 'isometric' }]], A.sealUnchecked);
  ev.push(A.sealUnchecked(ev, { type: A.EVENT.APPROVED, at: AT, payload: null }));
  const r = A.verifyPackage(pkgOf(ev));
  assert.ok(r.checked && !r.rules.pass);
  assert.ok(r.rules.problems.some((p) => /Issued is reserved/.test(p.message)));
});

test('envelope rules: seal time and recorded_by are checked when sealing and on replay', () => {
  const base = chain([[A.EVENT.REGISTERED, REG]]);
  for (const at of ['', 'yesterday', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z']) {
    assert.throws(() => A.sealEvent(base, { type: A.EVENT.VALIDATED, at, payload: VAL }), /seal time/, at);
  }
  assert.throws(() => A.sealEvent(base, { type: A.EVENT.VALIDATED, at: AT, recordedBy: ' ', payload: VAL }), /recorded_by/);
  for (const [field, value, re] of [
    ['sealed_at', undefined, /missing field sealed_at/],
    ['sealed_at', 'not a time', /sealed_at must be/],
    ['recorded_by', '', /recorded_by must be/],
    ['recorded_by', 7, /recorded_by must be/]
  ]) {
    const evs = chain([[A.EVENT.REGISTERED, REG]]);
    const bad = { ...evs[0] };
    if (value === undefined) delete bad[field]; else bad[field] = value;
    bad.hash = A.eventHash(bad);
    const r = A.verifyPackage(pkgOf([bad]));
    assert.ok(r.rules.problems.some((p) => re.test(p.message)), field + '=' + value);
  }
});

test('time rule accepts real dates only', () => {
  const ok = ['2028-02-29T00:00:00Z', '2026-12-31T23:59:59Z', '2026-07-08T11:00:00.123+05:30', '2026-07-08T11:00Z'];
  const bad = ['2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-02-30T00:00:00Z', '2026-07-08T11:60:00Z', '2026-07-08 11:00:00Z', '2026-07-08T11:00:00+25:00'];
  const evs = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL]]);
  const later = '2030-01-01T00:00:00Z';
  for (const t of ok) assert.strictEqual(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: later, payload: { ...APPR, approved_at: t } }), null, t);
  for (const t of bad) assert.match(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: AT, payload: { ...APPR, approved_at: t } }), /ISO 8601/, t);
});

test('inherited names are not event types, fields or faces', () => {
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(A.validateEvent([], { type, payload: {} }), /Unknown event type/);
    assert.match(A.canSeal([], type), /Unknown event type/);
    const r = A.verifyPackage(pkgOf(chain([[A.EVENT.REGISTERED, REG], [type, {}]], A.sealUnchecked)));
    assert.ok(r.rules.problems.some((p) => /unknown event type/.test(p.message)), type);
  }
  const base = chain([[A.EVENT.REGISTERED, REG]]);
  assert.throws(() => A.sealEvent(base, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'constructor', value: 'x', reason: 'r' } }), /Corrected field must be one of/);
  assert.throws(() => A.sealEvent([], { type: A.EVENT.REGISTERED, at: AT, payload: { ...REG, claim: { ...CLAIM, registry_face: 'toString' } } }), /Registry face/);
});

test('an own "__proto__" member is hashed like any other member', () => {
  const text = sample('issued').replace('{\n  "format"', '{\n  "__proto__": {"x": 1},\n  "format"');
  assert.ok(Object.keys(JSON.parse(text)).includes('__proto__'));
  assert.strictEqual(A.verifyPackage(text).hash.pass, false);
});

test('Registered.inputs is required (it may be empty), so a Correction always has a previous value', () => {
  const { inputs, ...noInputs } = REG;
  assert.throws(() => A.sealEvent([], { type: A.EVENT.REGISTERED, at: AT, payload: noInputs }), /Model inputs is required/);
  const ev = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL]]);
  ev.push(A.sealEvent(ev, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'inputs', value: 'wind', reason: 'r' } }));
  ev.push(A.sealEvent(ev, { type: A.EVENT.APPROVED, at: AT, payload: APPR }));
  ev.push(A.sealEvent(ev, { type: A.EVENT.ISSUED, at: AT, payload: { face: 'puro' } }));
  const r = A.verifyPackage(JSON.stringify(pkgOf(ev, 'puro')));
  assert.ok(r.consistent, JSON.stringify(r.consistency.diffs));
  assert.strictEqual(r.status.derived, 'issued');
});

test('unpaired surrogates and non-JSON payloads are refused with a reason', () => {
  assert.throws(() => A.sealEvent([], { type: A.EVENT.REGISTERED, at: AT, payload: { ...REG, version: 'v\uD800' } }), /unpaired surrogate/);
  assert.strictEqual(A.checkSeal([], { type: A.EVENT.REGISTERED, at: AT, payload: { ...REG, version: '😀' } }), null);
  const circular = { ...REG }; circular.self = circular;
  assert.strictEqual(A.checkSeal([], { type: A.EVENT.REGISTERED, at: AT, payload: circular }), 'The payload must be plain JSON data.');
  assert.strictEqual(A.checkSeal([], { type: A.EVENT.REGISTERED, at: AT, payload: null }), 'The payload must be an object.');
  assert.strictEqual(A.checkSeal([], { type: A.EVENT.REGISTERED, at: AT, payload: { ...REG, n: 10n } }), 'The payload must be plain JSON data.');
});

test('sha256Bytes: block boundaries, other realms, shared buffers', () => {
  const vm = require('vm');
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 4097]) {
    const b = crypto.randomBytes(n);
    assert.strictEqual(A.sha256Bytes(b), crypto.createHash('sha256').update(b).digest('hex'), String(n));
  }
  const foreign = vm.runInNewContext('new Uint8Array([1,2,3]).buffer');
  assert.strictEqual(A.sha256Bytes(foreign), crypto.createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
  const shared = new SharedArrayBuffer(3);
  new Uint8Array(shared).set([1, 2, 3]);
  assert.strictEqual(A.sha256Bytes(shared), A.sha256Bytes(foreign));
});

test('replaying the rules is linear: 20,000 lines check quickly', () => {
  const ev = chain([[A.EVENT.REGISTERED, REG]]);
  for (let i = 0; i < 20000; i++) {
    const prev = i === 0 ? '1' : 'v' + (i - 1);
    ev.push(A.sealUnchecked(ev, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'ai_version', previous: prev, value: 'v' + i, reason: 'r' } }));
  }
  const t0 = Date.now();
  const r = A.checkRules(ev);
  assert.ok(r.pass, JSON.stringify(r.problems.slice(0, 2)));
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});

/* ---- App review batch 2: nothing is sealed on a damaged record ---- */

test('sealing refuses a record whose chain is broken or that breaks the rules', () => {
  const ev = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL]]);
  const edited = ev.map((e) => ({ ...e }));
  edited[1] = { ...edited[1], payload: { ...edited[1].payload, summary: 'changed' } };
  assert.match(A.checkSeal(edited, { type: A.EVENT.APPROVED, at: AT, payload: APPR }), /chain is broken \(line 2: Event hash/);
  const removed = [ev[0], ev[1]].slice(1);
  assert.match(A.checkSeal(removed, { type: A.EVENT.APPROVED, at: AT, payload: APPR }), /chain is broken \(line 1/);
  // A legacy line that no longer meets the rules (Registered without inputs).
  const { inputs, ...legacy } = REG;
  const old = chain([[A.EVENT.REGISTERED, legacy]], A.sealUnchecked);
  assert.match(A.checkSeal(old, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'inputs', value: 'x', reason: 'r' } }), /breaks the event rules/);
});

test('chain problems are located by position, and odd envelope values are described safely', () => {
  const pkg = JSON.parse(sample('issued'));
  pkg.events[2].seq = 99;
  pkg.events[0].seq = { a: 1 };
  pkg.package_hash = A.packageHash(pkg);
  const r = A.verifyPackage(pkg);
  assert.deepStrictEqual([...new Set(r.chain.problems.map((p) => p.seq))], [1, 3]);
  assert.ok(r.chain.problems.some((p) => p.message === 'Sequence number is an object, expected 1.'));
  assert.ok(r.rules.problems.some((p) => /seq must be a whole number/.test(p.message)));
  const typed = JSON.parse(sample('issued'));
  typed.events[0].type = ['Registered'];
  const t = A.verifyPackage(typed);
  assert.ok(t.rules.problems.some((p) => /type must be text|unknown event type/.test(p.message)));
});

test('a Correction without previous no longer causes a false outline mismatch', () => {
  const ev = chain([[A.EVENT.REGISTERED, REG]]);
  ev.push(A.sealUnchecked(ev, { type: A.EVENT.CORRECTION, at: AT, payload: { field: 'ai_version', value: '2', reason: 'r' } }));
  const r = A.verifyPackage(JSON.stringify(pkgOf(ev)));
  assert.deepStrictEqual(r.consistency.diffs, []);
  assert.ok(r.rules.problems.some((p) => /Previous value is missing/.test(p.message)));
});

/* ---- App review batch 3: Verify trust ---- */

test('fixed text in a package (notice, scope, status note, hash rule) is checked, not echoed', () => {
  for (const [field, value] of [['notice', 'Registry submission.'], ['scope', 'allocycle scored this credit.'], ['status_note', 'Issued.'], ['hash_rule', 'MD5']]) {
    const pkg = JSON.parse(sample('unapproved'));
    pkg[field] = value;
    pkg.package_hash = A.packageHash(pkg);
    const r = A.verifyPackage(pkg);
    assert.ok(r.hash.pass && !r.consistent, field);
    assert.ok(r.consistency.diffs.some((d) => d.path === field), field);
  }
  const bad = JSON.parse(sample('issued'));
  bad.face = 'gold';
  bad.package_hash = A.packageHash(bad);
  assert.ok(A.verifyPackage(bad).consistency.diffs.some((d) => d.path === 'face'));
});

test('the status note gives the reason for a draft that has a current approval', () => {
  const ev = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL], [A.EVENT.APPROVED, APPR]]);
  const pkg = pkgOf(ev);
  assert.strictEqual(pkg.status, 'draft');
  assert.deepStrictEqual(pkg.concerns, []);
  assert.match(pkg.status_note, /current "Approved for use" event \(line 3\), but no Package issued event for this face/);
  assert.ok(A.verifyPackage(JSON.stringify(pkg)).consistent);
});

test('package_hash is compared exactly as written, like the Python check', () => {
  for (const mutate of [(h) => 'sha256:' + h, (h) => h.toUpperCase(), (h) => ' ' + h]) {
    const pkg = JSON.parse(sample('issued'));
    pkg.package_hash = mutate(pkg.package_hash);
    assert.strictEqual(A.verifyPackage(pkg).hash.pass, false);
  }
});

test('verifyPackage never throws, even on deeply nested input', () => {
  let deep = []; for (let i = 0; i < 20000; i++) deep = [deep];
  const pkg = JSON.parse(sample('issued'));
  pkg.events[0].seq = deep;
  pkg.format = deep;
  const r = A.verifyPackage(pkg);
  assert.ok(r && typeof r === 'object');
  assert.ok(r.ok === false || r.hash);
});

/* ---- App review batch 4: time order ---- */

test('an approval sits between registration and its own seal time; lines are sealed in time order', () => {
  const evs = chain([[A.EVENT.REGISTERED, REG], [A.EVENT.VALIDATED, VAL]]); // both sealed at AT
  assert.match(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: AT, payload: { ...APPR, approved_at: '2031-06-01T12:00:00Z' } }), /cannot be later than the moment it is sealed/);
  assert.match(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: AT, payload: { ...APPR, approved_at: '2020-01-01T00:00:00Z' } }), /cannot be earlier than the Registered line/);
  assert.strictEqual(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: AT, payload: APPR }), null);
  assert.match(A.checkSeal(evs, { type: A.EVENT.APPROVED, at: '2025-12-31T00:00:00Z', payload: { ...APPR, approved_at: '2025-12-31T00:00:00Z' } }), /earlier than the line before it/);
  // The same rules are replayed on a file.
  const back = chain([[A.EVENT.REGISTERED, REG]]);
  back.push(A.sealUnchecked(back, { type: A.EVENT.VALIDATED, at: '2020-01-01T00:00:00Z', payload: VAL }));
  assert.ok(A.checkRules(back).problems.some((p) => /earlier than the line before it/.test(p.message)));
});

test('an approval entered in the same minute as registration is accepted', () => {
  const ev = [];
  ev.push(A.sealEvent(ev, { type: A.EVENT.REGISTERED, at: '2026-01-01T10:00:30Z', payload: REG }));
  ev.push(A.sealEvent(ev, { type: A.EVENT.VALIDATED, at: '2026-01-01T10:00:40Z', payload: VAL }));
  const at = '2026-01-01T10:01:00Z';
  assert.strictEqual(A.checkSeal(ev, { type: A.EVENT.APPROVED, at, payload: { ...APPR, approved_at: '2026-01-01T10:00:00Z' } }), null);
  assert.match(A.checkSeal(ev, { type: A.EVENT.APPROVED, at, payload: { ...APPR, approved_at: '2026-01-01T09:59:59Z' } }), /earlier than the Registered line/);
});

/* ---- App review batch 7 ---- */

test('every frozen vector verifies, including the Verra and Puro faces', () => {
  for (const name of ['issued', 'unapproved', 'issued-verra', 'issued-puro']) {
    const r = A.verifyPackage(sample(name));
    assert.ok(r.consistent, name);
  }
  assert.strictEqual(JSON.parse(sample('issued-verra')).cover_sheet.methodology, 'VM0049');
  assert.ok('monitoring_period' in JSON.parse(sample('issued-verra')).cover_sheet);
  assert.ok('production_batch' in JSON.parse(sample('issued-puro')).cover_sheet);
});

test('the correction playback cites the right lines', () => {
  global.window = { Allocycle: A };
  delete require.cache[require.resolve('../js/agent-cases.js')];
  require('../js/agent-cases.js');
  const steps = global.window.ALLOCYCLE_CASES.find((c) => c.id === 'correction').steps;
  delete global.window;
  const kindAt = (line) => steps[line - 1] && steps[line - 1].kind;
  for (const [i, st] of steps.entries()) {
    const corrects = /corrects line (\d+)/.exec(st.text);
    if (corrects) assert.match(steps[+corrects[1] - 1].text, /^Registered/, 'step ' + (i + 1));
    const cites = /cites lines? (\d+)(?: and (\d+))?/.exec(st.text);
    if (cites) {
      assert.strictEqual(kindAt(+cites[1]), 'observed', 'step ' + (i + 1));
      if (cites[2]) assert.strictEqual(kindAt(+cites[2]), 'reported', 'step ' + (i + 1));
    }
    const classifies = /classifies line (\d+).*line (\d+)/.exec(st.text);
    if (classifies) {
      assert.strictEqual(kindAt(+classifies[1]), 'observed');
      assert.strictEqual(kindAt(+classifies[2]), 'reported');
    }
    const before = /sealed before line (\d+)/.exec(st.text);
    if (before) assert.strictEqual(kindAt(+before[1]), 'correction');
  }
});
