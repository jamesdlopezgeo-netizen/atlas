/*
 * allocycle core
 *
 * Pure functions shared by the browser app, the sample builder and the tests:
 * SHA-256, canonical JSON, sealed events with a hash chain, the outline that a
 * package derives from its events, package building and package verification.
 *
 * Loaded as a classic script in the browser (window.Allocycle) and with
 * require() in Node, so the page also works when opened from file://.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Allocycle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'allocycle.package/v1';
  var NOTICE = 'Prototype. Not a registry submission.';
  var SCOPE = 'allocycle does not score the credit, quantify tons, or submit to a registry.';
  var HASH_FIELD = 'package_hash';
  var HASH_RULE =
    'SHA-256 (hex) of canonical JSON of the whole package: object keys sorted, ' +
    'whitespace between tokens removed, the top-level "package_hash" field excluded.';
  var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

  var EVENT = {
    REGISTERED: 'Registered',
    VALIDATED: 'Validated',
    APPROVED: 'Approved for use',
    CORRECTION: 'Correction',
    ISSUED: 'Package issued'
  };

  var VALIDATION_TYPES = ['hold-out', 'empirical', 'peer-review'];

  var FACES = {
    isometric: { key: 'isometric', label: 'Isometric', isDefault: true },
    verra: { key: 'verra', label: 'Verra' },
    puro: { key: 'puro', label: 'Puro' }
  };
  var FACE_ORDER = ['isometric', 'verra', 'puro'];
  var ISOMETRIC_LABELS = ['G-K6MR-0', 'G-6VGD-0'];
  var VERRA_METHODOLOGY = 'VM0049';

  // Fields a Correction event may supersede, and where they live in the outline.
  var CORRECTABLE = {
    ai_system: { label: 'AI system name', section: 'source', key: 'ai_system', needs: EVENT.REGISTERED },
    ai_version: { label: 'AI system version', section: 'source', key: 'version', needs: EVENT.REGISTERED },
    artifact_hash: { label: 'Artifact hash', section: 'source', key: 'artifact_hash', needs: EVENT.REGISTERED, isHash: true },
    inputs: { label: 'Model inputs', section: 'inputs', key: 'description', needs: EVENT.REGISTERED },
    data_snapshot_hash: { label: 'Data snapshot hash', section: 'data', key: 'snapshot_hash', needs: EVENT.VALIDATED, isHash: true },
    validation_type: { label: 'Validation type', section: 'validation', key: 'type', needs: EVENT.VALIDATED, options: VALIDATION_TYPES },
    validation_summary: { label: 'Validation summary', section: 'validation', key: 'summary', needs: EVENT.VALIDATED }
  };

  /* ------------------------------------------------------------------ */
  /* SHA-256 (synchronous, dependency-free, UTF-8 input)                 */
  /* ------------------------------------------------------------------ */

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function sha256Hex(input) {
    var bytes = new TextEncoder().encode(String(input));
    var len = bytes.length;
    var total = ((len + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    var bitLen = len * 8;
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    m[total - 8] = hi >>> 24; m[total - 7] = (hi >>> 16) & 0xff; m[total - 6] = (hi >>> 8) & 0xff; m[total - 5] = hi & 0xff;
    m[total - 4] = lo >>> 24; m[total - 3] = (lo >>> 16) & 0xff; m[total - 2] = (lo >>> 8) & 0xff; m[total - 1] = lo & 0xff;

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Uint32Array(64);
    for (var i = 0; i < total; i += 64) {
      for (var t = 0; t < 16; t++) {
        var j = i + t * 4;
        W[t] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var w15 = W[t - 15], w2 = W[t - 2];
        var s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
        var s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Canonical JSON                                                      */
  /* ------------------------------------------------------------------ */

  // Keys sorted (UTF-16 code unit order, which equals code point order for
  // the ASCII keys used here), no whitespace between tokens, undefined
  // members dropped. Strings keep their own content, spaces included.
  function canonicalize(value) {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'number' && !isFinite(value)) throw new Error('Non-finite number cannot be hashed');
      if (value === undefined) return 'null';
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(canonicalize).join(',') + ']';
    }
    var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalize(value[k]); }).join(',') + '}';
  }

  function hashOf(value) {
    return sha256Hex(canonicalize(value));
  }

  function withoutKey(obj, key) {
    var copy = {};
    Object.keys(obj).forEach(function (k) { if (k !== key) copy[k] = obj[k]; });
    return copy;
  }

  function normalizeHash(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (s.indexOf('sha256:') === 0) s = s.slice(7);
    return /^[0-9a-f]{64}$/.test(s) ? s : null;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function eventHash(ev) {
    return hashOf(withoutKey(ev, 'hash'));
  }

  // Returns a new sealed event. The caller appends it; nothing here mutates.
  function sealEvent(events, spec) {
    var prev = events.length ? events[events.length - 1].hash : GENESIS;
    var ev = {
      seq: events.length + 1,
      type: spec.type,
      sealed_at: spec.at,
      recorded_by: spec.recordedBy || 'allocycle (external record)',
      payload: spec.payload,
      prev_hash: prev
    };
    ev.hash = eventHash(ev);
    return ev;
  }

  function checkChain(events) {
    var problems = [];
    var prev = GENESIS;
    (events || []).forEach(function (ev, i) {
      if (ev.seq !== i + 1) problems.push({ seq: ev.seq, message: 'Sequence number is ' + ev.seq + ', expected ' + (i + 1) + '.' });
      if (ev.prev_hash !== prev) problems.push({ seq: ev.seq, message: 'prev_hash does not match the hash of the line before it.' });
      var recomputed = eventHash(ev);
      if (recomputed !== ev.hash) problems.push({ seq: ev.seq, message: 'Event hash does not match its contents.' });
      prev = ev.hash;
    });
    return { pass: problems.length === 0, problems: problems, head: prev };
  }

  /* ------------------------------------------------------------------ */
  /* State derived from events                                           */
  /* ------------------------------------------------------------------ */

  function deriveState(events) {
    var s = {
      claim: null,
      source: null,
      inputs: null,
      data: null,
      validation: null,
      registered: null,
      validated: null,
      corrections: [],
      approvals: [],
      approval: null,
      staleApproval: null,
      issued: []
    };
    var lastCorrectionSeq = 0;
    (events || []).forEach(function (ev) {
      var p = ev.payload || {};
      if (ev.type === EVENT.REGISTERED && !s.registered) {
        s.registered = ev;
        s.claim = clone(p.claim);
        s.source = { ai_system: p.ai_system, version: p.version, artifact_hash: p.artifact_hash };
        s.inputs = { description: p.inputs };
      } else if (ev.type === EVENT.VALIDATED && !s.validated) {
        s.validated = ev;
        s.data = { snapshot_hash: p.data_snapshot_hash };
        s.validation = { type: p.validation_type, summary: p.summary, reference: p.reference };
      } else if (ev.type === EVENT.CORRECTION) {
        var spec = CORRECTABLE[p.field];
        if (spec && s[spec.section]) s[spec.section][spec.key] = p.value;
        s.corrections.push(ev);
        lastCorrectionSeq = ev.seq;
      } else if (ev.type === EVENT.APPROVED) {
        s.approvals.push(ev);
      } else if (ev.type === EVENT.ISSUED) {
        s.issued.push(ev);
      }
    });
    var latest = s.approvals[s.approvals.length - 1] || null;
    if (latest && latest.seq > lastCorrectionSeq) s.approval = latest;
    else if (latest) s.staleApproval = latest;
    s.lastCorrectionSeq = lastCorrectionSeq;
    return s;
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  // Which event types may be sealed next, and why not when they can't.
  function canSeal(events, type) {
    var s = deriveState(events);
    switch (type) {
      case EVENT.REGISTERED:
        return s.registered ? 'This record already has a Registered event. One claim, one system.' : null;
      case EVENT.VALIDATED:
        if (!s.registered) return 'Seal a Registered event first.';
        return s.validated ? 'This record already has a Validated event. Record a change as a Correction.' : null;
      case EVENT.APPROVED:
        if (!s.validated) return 'Seal a Validated event first.';
        return s.approval ? 'The record already carries a current Approved for use event.' : null;
      case EVENT.CORRECTION:
        return s.registered ? null : 'Nothing to correct before a Registered event.';
      case EVENT.ISSUED:
        return s.approval ? null : 'Issued is reserved for a record with a current Approved for use event.';
      default:
        return 'Unknown event type.';
    }
  }

  function deriveConcerns(state) {
    var c = [];
    if (!state.registered) {
      c.push({ code: 'NOT_REGISTERED', text: 'No Registered event. No AI system is on record for this batch.' });
    }
    if (state.registered && !state.validated) {
      c.push({ code: 'NOT_VALIDATED', text: 'No Validated event. No data snapshot or validation result is on record.' });
    }
    if (!state.approvals.length) {
      c.push({
        code: 'MISSING_APPROVAL',
        text: "Concern for the evaluator: no \"Approved for use\" event. No named person approved use of this AI system for this batch. This is a draft package, not an issued one."
      });
    } else if (!state.approval) {
      c.push({
        code: 'APPROVAL_PRECEDES_CORRECTION',
        text: 'Concern for the evaluator: the latest "Approved for use" event (line ' + state.staleApproval.seq +
          ') was sealed before a Correction (line ' + state.lastCorrectionSeq + '). The corrected record has no named approval. This is a draft package.'
      });
    }
    return c;
  }

  function deriveOutline(events) {
    var s = deriveState(events);
    return {
      source: s.source ? clone(s.source) : null,
      modifications: s.corrections.map(function (ev) {
        return {
          seq: ev.seq,
          sealed_at: ev.sealed_at,
          field: ev.payload.field,
          previous: ev.payload.previous,
          value: ev.payload.value,
          reason: ev.payload.reason,
          autogenic_reference: ev.payload.autogenic_reference || null
        };
      }),
      inputs: s.inputs ? clone(s.inputs) : null,
      data: s.data ? clone(s.data) : null,
      validation: s.validation ? clone(s.validation) : null,
      named_approval: s.approval
        ? {
            seq: s.approval.seq,
            person: s.approval.payload.person,
            role: s.approval.payload.role,
            approved_at: s.approval.payload.approved_at,
            intended_use: s.approval.payload.intended_use
          }
        : null,
      batch_binding: s.claim
        ? {
            project_name: s.claim.project_name,
            project_id: s.claim.project_id,
            registry_face: s.claim.registry_face,
            protocol: s.claim.protocol,
            batch: s.claim.batch,
            bound_at_seq: s.registered.seq,
            registered_event_hash: s.registered.hash
          }
        : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* Cover sheets and packages                                           */
  /* ------------------------------------------------------------------ */

  function coverSheet(claim, face) {
    claim = claim || {};
    if (face === 'verra') {
      return {
        face: 'Verra',
        project_id: claim.project_id || null,
        methodology: VERRA_METHODOLOGY,
        monitoring_period: claim.batch || null,
        project_name: claim.project_name || null
      };
    }
    if (face === 'puro') {
      return {
        face: 'Puro',
        facility_id: claim.project_id || null,
        methodology: claim.protocol || null,
        production_batch: claim.batch || null,
        project_name: claim.project_name || null
      };
    }
    return {
      face: 'Isometric',
      default_face: true,
      labeling: ISOMETRIC_LABELS.slice(),
      project_name: claim.project_name || null,
      project_id: claim.project_id || null,
      protocol: claim.protocol || null,
      batch: claim.batch || null
    };
  }

  // Status is derived, never chosen: "issued" needs a current Approved for use
  // event and a Package issued event for this face sealed after it.
  function deriveStatus(events, face) {
    var s = deriveState(events);
    if (!s.approval) return 'draft';
    var issuedForFace = s.issued.some(function (ev) {
      return ev.payload && ev.payload.face === face && ev.seq > s.approval.seq;
    });
    return issuedForFace ? 'issued' : 'draft';
  }

  function statusNote(status) {
    return status === 'issued'
      ? 'Issued package. The record carries an "Approved for use" event by a named person, sealed before this package was issued.'
      : 'Draft package. The named approval is missing or out of date; see concerns. A draft package is not an issued package.';
  }

  function buildPackage(opts) {
    var events = opts.events || [];
    var face = FACES[opts.face] ? opts.face : 'isometric';
    var state = deriveState(events);
    var status = deriveStatus(events, face);
    var chain = checkChain(events);
    var pkg = {
      format: FORMAT,
      notice: NOTICE,
      scope: SCOPE,
      record_id: opts.recordId,
      face: face,
      status: status,
      status_note: statusNote(status),
      cover_sheet: coverSheet(state.claim || opts.claim, face),
      outline: deriveOutline(events),
      concerns: deriveConcerns(state),
      events: clone(events),
      event_chain_head: chain.head,
      generated_at: opts.generatedAt,
      hash_rule: HASH_RULE
    };
    pkg[HASH_FIELD] = packageHash(pkg);
    return pkg;
  }

  function packageHash(pkg) {
    return hashOf(withoutKey(pkg, HASH_FIELD));
  }

  /* ------------------------------------------------------------------ */
  /* Verification                                                        */
  /* ------------------------------------------------------------------ */

  function flatten(value, prefix, out) {
    out = out || {};
    if (value !== null && typeof value === 'object') {
      var keys = Array.isArray(value) ? value.map(function (_, i) { return i; }) : Object.keys(value);
      if (!keys.length) out[prefix] = Array.isArray(value) ? '[]' : '{}';
      keys.forEach(function (k) {
        var path = Array.isArray(value) ? prefix + '[' + k + ']' : (prefix ? prefix + '.' + k : String(k));
        flatten(value[k], path, out);
      });
    } else {
      out[prefix] = JSON.stringify(value === undefined ? null : value);
    }
    return out;
  }

  function diff(stated, derived, prefix) {
    var a = flatten(stated, prefix);
    var b = flatten(derived, prefix);
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = true; });
    Object.keys(b).forEach(function (k) { keys[k] = true; });
    return Object.keys(keys).sort().filter(function (k) { return a[k] !== b[k]; }).map(function (k) {
      return { path: k, stated: a[k] === undefined ? '(absent)' : a[k], derived: b[k] === undefined ? '(absent)' : b[k] };
    });
  }

  function parsePackage(text) {
    var pkg;
    try {
      pkg = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      return { error: 'This is not valid JSON: ' + e.message };
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { error: 'The JSON is not an object.' };
    return { pkg: pkg };
  }

  function verifyPackage(input) {
    var parsed = parsePackage(input);
    if (parsed.error) return { ok: false, error: parsed.error };
    var pkg = parsed.pkg;
    if (typeof pkg[HASH_FIELD] !== 'string') {
      return { ok: false, error: 'No "' + HASH_FIELD + '" field. This does not look like an allocycle package.' };
    }

    var stated = pkg[HASH_FIELD].trim().toLowerCase().replace(/^sha256:/, '');
    var recomputed;
    try {
      recomputed = packageHash(pkg);
    } catch (e) {
      return { ok: false, error: 'Could not canonicalize the package: ' + e.message };
    }
    var hash = { stated: stated, recomputed: recomputed, pass: stated === recomputed };

    var events = Array.isArray(pkg.events) ? pkg.events : [];
    var chain = checkChain(events);
    if (chain.pass && pkg.event_chain_head !== chain.head) {
      chain.pass = false;
      chain.problems.push({ seq: null, message: 'event_chain_head does not match the last event hash.' });
    }

    var state = deriveState(events);
    var face = pkg.face;
    var derivedStatus = FACES[face] ? deriveStatus(events, face) : 'draft';
    var derived = {
      outline: deriveOutline(events),
      cover_sheet: coverSheet(state.claim, face),
      concerns: deriveConcerns(state),
      status: derivedStatus
    };
    var diffs = []
      .concat(diff(pkg.outline, derived.outline, 'outline'))
      .concat(diff(pkg.cover_sheet, derived.cover_sheet, 'cover_sheet'))
      .concat(diff(pkg.concerns, derived.concerns, 'concerns'))
      .concat(diff(pkg.status, derived.status, 'status'));

    return {
      ok: true,
      pkg: pkg,
      hash: hash,
      chain: chain,
      consistency: { pass: diffs.length === 0, diffs: diffs },
      status: { stated: pkg.status, derived: derivedStatus },
      concerns: derived.concerns,
      outline: pkg.outline || null,
      canonicalLength: canonicalize(withoutKey(pkg, HASH_FIELD)).length
    };
  }

  return {
    FORMAT: FORMAT,
    NOTICE: NOTICE,
    SCOPE: SCOPE,
    HASH_FIELD: HASH_FIELD,
    HASH_RULE: HASH_RULE,
    GENESIS: GENESIS,
    EVENT: EVENT,
    VALIDATION_TYPES: VALIDATION_TYPES,
    FACES: FACES,
    FACE_ORDER: FACE_ORDER,
    ISOMETRIC_LABELS: ISOMETRIC_LABELS,
    CORRECTABLE: CORRECTABLE,
    sha256Hex: sha256Hex,
    canonicalize: canonicalize,
    hashOf: hashOf,
    normalizeHash: normalizeHash,
    sealEvent: sealEvent,
    eventHash: eventHash,
    checkChain: checkChain,
    deriveState: deriveState,
    canSeal: canSeal,
    deriveConcerns: deriveConcerns,
    deriveOutline: deriveOutline,
    deriveStatus: deriveStatus,
    coverSheet: coverSheet,
    buildPackage: buildPackage,
    packageHash: packageHash,
    verifyPackage: verifyPackage,
    diff: diff
  };
});
