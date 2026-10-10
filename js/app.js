/*
 * allocycle app: hash router and views.
 * Home · Records · Record (register / validate / approve / issue) · Live agents · Verify
 */
(function () {
  'use strict';

  var A = window.Allocycle;
  var SAMPLES = window.ALLOCYCLE_SAMPLES;
  var CASES = window.ALLOCYCLE_CASES;
  var E = A.EVENT;
  var app = document.getElementById('app');
  var STORE_KEY = 'allocycle.records.v1';

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shortHash(hex, n) {
    if (!hex) return '';
    if (typeof hex !== 'string') hex = typeof hex === 'object' ? JSON.stringify(hex) : String(hex);
    n = n || 10;
    return hex.length > n * 2 ? hex.slice(0, n) + '…' + hex.slice(-4) : hex;
  }
  // Full hashes are shown wherever a person may compare them; short ones
  // only in dense lists, where the full value is one click away.
  function fullHash(hex) {
    return '<code class="hash full">' + esc(typeof hex === 'string' ? hex : shortHash(hex)) + '</code>';
  }
  function hashSpan(hex, n) {
    return '<code class="hash" title="' + esc(hex) + '">' + esc(shortHash(hex, n)) + '</code>';
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/:\d\dZ$/, 'Z');
  }
  function nowIso() {
    return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  }
  function localInputValue(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function randomHex() {
    var b = new Uint8Array(32);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256; });
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  // Polite message for screen readers (see #announcer in index.html).
  function announce(text) {
    var el = document.getElementById('announcer');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = text; }, 30);
  }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || app).querySelectorAll(sel)); }
  function formData(form) {
    var out = {};
    new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }
  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function storedPackage(pkg) {
    return { face: pkg.face, status: pkg.status, package_hash: pkg.package_hash, generated_at: pkg.generated_at, json: pkg };
  }
  function packageFilename(recordId, pkg) {
    var tag = pkg.status === 'issued' ? 'issued' : 'DRAFT';
    return 'allocycle-' + recordId + '-' + pkg.face + '-' + tag + '-' + pkg.package_hash.slice(0, 8) + '.json';
  }
  function faceLabel(face) {
    return typeof face === 'string' && Object.prototype.hasOwnProperty.call(A.FACES, face) ? A.FACES[face].label : String(face);
  }
  // The approver's name is self-asserted until approver identity is checked.
  function asEntered(name) { return esc(name) + '<br><span class="hint">name as entered, not verified</span>'; }
  // Accepts "sha256:" prefixes and upper case; anything else goes to core
  // unchanged so core's rule gives the error.
  function tidyHash(raw) { return A.normalizeHash(raw) || raw; }

  /* ------------------------------------------------------------------ */
  /* Storage (browser only; sample records are read-only and in memory)  */
  /* ------------------------------------------------------------------ */

  // Records live in this browser's localStorage under one key. There is no
  // cache: every read goes to storage, and every write reads the list again,
  // replaces one record and checks that nobody (another tab) moved that
  // record on in the meantime. A write that fails throws; nothing is ever
  // shown as saved when it was not.
  var memoryOnly = null;   // records kept in memory when localStorage is blocked
  var unreadable = null;   // the stored text, when it cannot be parsed

  function storage() {
    try {
      var ls = window.localStorage;
      ls.getItem(STORE_KEY);
      return ls;
    } catch (e) {
      return null;
    }
  }
  function readAll() {
    var ls = storage();
    if (!ls) return memoryOnly || (memoryOnly = []);
    var raw = ls.getItem(STORE_KEY);
    unreadable = null;
    if (!raw) return [];
    try {
      var list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    } catch (e) { /* handled below */ }
    unreadable = raw;
    return [];
  }
  function writeAll(list) {
    var ls = storage();
    if (!ls) { memoryOnly = list; return; }
    if (unreadable !== null) {
      throw new Error('Not saved. The records stored in this browser could not be read, and saving now would overwrite them. See the note on the Records page.');
    }
    try {
      ls.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) {
      throw new Error('Not saved. This browser refused to store the record (its storage may be full or blocked). Nothing was changed.');
    }
  }
  function isRecord(r) {
    return r !== null && typeof r === 'object' && typeof r.id === 'string' && Array.isArray(r.events);
  }
  function loadRecords() {
    return readAll().filter(isRecord);
  }
  function getRecord(id) {
    var s = SAMPLES.records.filter(function (r) { return r.id === id; })[0];
    if (s) return s;
    return loadRecords().filter(function (r) { return r.id === id; })[0] || null;
  }
  function newRecordId() {
    return 'rec-' + randomHex().slice(0, 8);
  }
  function headOf(events) {
    var n = Array.isArray(events) ? events.length : 0;
    var last = n ? events[n - 1] : null;
    return { n: n, head: last && typeof last === 'object' ? last.hash : null };
  }
  function sameHead(a, b) {
    return a.n === b.n && a.head === b.head;
  }
  function staleError() {
    var e = new Error('Not saved. This record changed in another tab or window, so the page now shows the latest version. Nothing was sealed.');
    e.stale = true;
    return e;
  }
  // Writes one record. `seen` is the head of the events the caller started
  // from, or null for a record that must not exist yet.
  function saveRecord(rec, seen) {
    var list = readAll();
    var i = -1;
    list.forEach(function (r, j) { if (isRecord(r) && r.id === rec.id) i = j; });
    if (seen === null ? i !== -1 : i === -1 || !sameHead(headOf(list[i].events), seen)) throw staleError();
    var next = list.slice();
    if (i === -1) next.push(rec); else next[i] = rec;
    writeAll(next);
  }
  function removeRecord(id, seen) {
    var list = readAll();
    var i = -1;
    list.forEach(function (r, j) { if (isRecord(r) && r.id === id) i = j; });
    if (i === -1 || !sameHead(headOf(list[i].events), seen)) throw staleError();
    writeAll(list.slice(0, i).concat(list.slice(i + 1)));
  }
  function copyOf(record) {
    var c = JSON.parse(JSON.stringify(record));
    c.packages = Array.isArray(c.packages) ? c.packages : [];
    return c;
  }

  // The only write path for events: seal, then append. No edit, no delete.
  // All rules (order and payload) live in core's sealEvent; the form only
  // tidies input. Rules are checked before the person is asked to confirm.
  // `also` may add to the new copy of the record (e.g. the issued package),
  // so the event and what goes with it are saved in one write.
  function appendEvent(record, spec, confirmText, also) {
    if (record.sample) throw new Error('Sample records are read-only.');
    var seen = headOf(record.events);
    var full = { type: spec.type, at: nowIso(), payload: spec.payload };
    var why = A.checkSeal(record.events, full);
    if (why) throw new Error(why);
    if (confirmText && !confirm(confirmText)) throw cancelled();
    full.at = nowIso(); // the seal time is when the person confirmed, not when the dialog opened
    var ev = A.sealEvent(record.events, full);
    var next = copyOf(record);
    next.events.push(ev);
    if (also) also(next, ev);
    saveRecord(next, seen);
    return next;
  }
  function cancelled() {
    var e = new Error('Cancelled.');
    e.cancelled = true;
    return e;
  }

  // A note shown on the record pages when storage is not doing its job.
  function storageNote() {
    if (unreadable !== null) {
      return '<div class="concern-box storage-note"><strong>The records stored in this browser could not be read.</strong> ' +
        'Nothing new can be saved until this is resolved, so that the stored text is not overwritten. ' +
        '<div class="form-actions"><button class="btn small" type="button" id="store-export">Download the stored text</button>' +
        '<button class="btn small ghost danger" type="button" id="store-reset">Clear it and start fresh</button></div></div>';
    }
    if (memoryOnly) {
      return '<div class="concern-box storage-note"><strong>This browser is not saving records.</strong> ' +
        'Local storage is blocked, so records you start here are kept only until this tab closes.</div>';
    }
    var hidden = readAll().length - loadRecords().length;
    if (hidden > 0) {
      return '<div class="concern-box storage-note">' + hidden + ' stored entr' + (hidden === 1 ? 'y is' : 'ies are') +
        ' not a readable record and ' + (hidden === 1 ? 'is' : 'are') + ' hidden. They stay in storage unchanged.</div>';
    }
    return '';
  }
  function bindStorageNote() {
    var exp = $('#store-export');
    if (exp) exp.addEventListener('click', function () {
      var blob = new Blob([unreadable || ''], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'allocycle-stored-records.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var reset = $('#store-reset');
    if (reset) reset.addEventListener('click', function () {
      if (!confirm('Clear the unreadable stored text? Download it first if you may need it. This cannot be undone.')) return;
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ }
      unreadable = null;
      route();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */

  var cleanup = null;
  var view = { recordId: null, head: null };
  function route() {
    view = { recordId: null, head: null };
    if (cleanup) { cleanup(); cleanup = null; }
    var hash = location.hash.replace(/^#/, '') || '/';
    var parts = hash.split('/').filter(Boolean);
    var nav = parts[0] || 'home';
    if (nav === 'record' || nav === 'new') nav = 'records';
    $$('[data-nav]', document).forEach(function (a) {
      if (a.getAttribute('data-nav') === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (!parts.length) renderHome();
    else if (parts[0] === 'records') renderRecords();
    else if (parts[0] === 'new') renderNew();
    else if (parts[0] === 'record' && parts[1]) renderRecord(decodeId(parts[1]));
    else if (parts[0] === 'agents') renderAgents(parts[1]);
    else if (parts[0] === 'verify') renderVerify(parts[1]);
    else renderNotFound();
    window.scrollTo(0, 0);
    afterRoute();
  }

  // Each page gets its own title, and focus moves to its heading so a
  // screen reader announces the new page (not on the first load).
  var firstRoute = true;
  function afterRoute() {
    var h1 = $('h1');
    var heading = h1 ? h1.textContent.trim() : '';
    document.title = heading && heading !== 'allocycle' ? heading + ' · allocycle' : 'allocycle';
    if (firstRoute) { firstRoute = false; return; }
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }
  window.addEventListener('hashchange', route);

  // Another tab wrote to storage: refresh what this tab shows, so it never
  // acts on a stale copy.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY && e.key !== null) return;
    if (/^#\/records\/?$/.test(location.hash)) { route(); return; }
    if (!view.recordId) return;
    var r = getRecord(view.recordId);
    if (!r || !sameHead(headOf(r.events), view.head)) {
      route();
      notice('This record changed in another tab. The page now shows the latest version.');
    }
  });

  // A short message at the top of the current page.
  function notice(text) {
    var page = $('.page');
    if (!page) return;
    var el = document.createElement('div');
    el.className = 'banner notice';
    el.setAttribute('role', 'status');
    el.textContent = text;
    page.insertBefore(el, page.firstChild);
  }

  function decodeId(raw) {
    try { return decodeURIComponent(raw); } catch (e) { return null; }
  }

  function renderNotFound() {
    app.innerHTML = '<section class="page narrow"><h1>Not found</h1><p><a href="#/">Back to home</a></p></section>';
  }

  /* ------------------------------------------------------------------ */
  /* Home                                                                */
  /* ------------------------------------------------------------------ */

  function renderHome() {
    app.innerHTML =
      '<section class="hero">' +
        '<p class="eyebrow">EXTERNAL RECORD</p>' +
        '<h1 class="title">allocycle</h1>' +
        '<p class="tagline">Allogenic record. Autogenic log.</p>' +
        '<p class="lede">A checkable log of the AI used on a CDR or CCUS carbon-credit project. allocycle does not score the credit, quantify tons, or submit to a registry.</p>' +
        '<p class="note">This form stands in for the Autogenic connector. In the live product, the connector writes the log when an artifact appears. This prototype keeps the form and does not build connectors.</p>' +
        '<p class="note note-follow">In the reviewed design, the connector only records what it observes: a version at the bound location and the hash it computed. A named person still turns each observation into a claim. See <a href="#/agents">Live agents</a>.</p>' +
        '<div class="actions">' +
          '<a class="btn" href="#/record/sample-issued">Open the issued sample</a>' +
          '<a class="btn" href="#/record/sample-unapproved">Open the unapproved sample</a>' +
          '<a class="btn primary" href="#/new">Start a record</a>' +
        '</div>' +
      '</section>' +

      '<section class="page">' +
        '<h2 class="section-title">Why</h2>' +
        '<div class="why">' +
          '<article class="card"><h3>Not an exact copy of the team’s log.</h3>' +
            '<p>The project team keeps its own internal record, the autogenic log. allocycle keeps the allogenic record: an external log written outside the team that produced the carbon quantity. It does not copy the team’s log. A change in the team’s process shows up here as a new event.</p></article>' +
          '<article class="card"><h3>A person is named before a package exists.</h3>' +
            '<p>If the named approval is missing, the download is a draft package and that gap is labeled a concern for the evaluator. Issued is reserved for a package that has an “Approved for use” event.</p></article>' +
          '<article class="card"><h3>A changed file fails on its own.</h3>' +
            '<p>At issue, the app hashes the fields (sorted, spacing removed, hash field itself excluded) and writes that hash into the file. Anyone can recompute it. An untouched file passes; a changed field fails.</p>' +
            '<p class="hint">A changed field fails unless whoever changed it also rewrote the hash. The prototype does not sign packages yet, so a passing hash shows the file was not changed after it was hashed, not who made it.</p></article>' +
        '</div>' +

        '<h2 class="section-title">How this works</h2>' +
        '<ol class="steps">' +
          '<li><h3>One claim, one system</h3><p>Open a record for one batch: project, registry face, protocol or methodology, batch or period.</p></li>' +
          '<li><h3>Register</h3><p>Record the AI system and version, including a pasted artifact hash. Sealing writes a <span class="evt">Registered</span> event.</p></li>' +
          '<li><h3>Validate</h3><p>Attach a data snapshot (pasted hash) and a validation result: hold-out, empirical, or peer-review. Sealing writes a <span class="evt">Validated</span> event.</p></li>' +
          '<li><h3>Approve</h3><p>A named person approves use, with role and time. Sealing writes an <span class="evt">Approved for use</span> event. Before that event, downloads are draft packages.</p></li>' +
          '<li><h3>Issue three cover sheets</h3><p>One record downloads as JSON under three faces: Isometric (default, labeled G-K6MR-0 and G-6VGD-0); Verra (project id, VM0049, monitoring period); Puro (facility id, methodology, production batch). Without named approval the file is a draft package that flags the missing approval as a concern.</p></li>' +
          '<li><h3>Someone else checks the file</h3><p>The <a href="#/verify">Verify</a> page needs no account. Paste the JSON and the hash is recomputed.</p></li>' +
        '</ol>' +

        '<div class="card band">' +
          '<div><p class="sim-label">SIMULATED AGENTS · NOT A REAL CREDIT</p>' +
          '<h3>Live agents</h3><p>Watch a playback write log lines as steps happen, each line hashed onto the one before it. Three cases: DAC screening, CCUS screening, and a correction.</p></div>' +
          '<a class="btn" href="#/agents">Open live agents</a>' +
        '</div>' +
      '</section>';
  }

  /* ------------------------------------------------------------------ */
  /* Records list and new record                                         */
  /* ------------------------------------------------------------------ */

  // Is the stored record intact? A damaged record (edited, removed or
  // invalid lines) is shown, but nothing more is sealed or issued on it.
  function recordHealth(record) {
    var chain = A.checkChain(record.events);
    var rules = A.checkRules(record.events);
    return { chain: chain, rules: rules, ok: chain.pass && rules.pass };
  }

  function recordStatus(record, health) {
    health = health || recordHealth(record);
    if (!health.ok) return { key: 'fail', label: health.chain.pass ? 'Damaged · breaks the rules' : 'Damaged · chain broken' };
    var s = A.deriveState(record.events);
    if (!s.registered) return { key: 'open', label: 'Open, nothing sealed' };
    if (s.approval && s.issued.some(function (ev) { return ev.seq > s.approval.seq; })) return { key: 'issued', label: 'Issued' };
    if (s.approval) return { key: 'approved', label: 'Approved for use' };
    if (s.staleApproval) return { key: 'draft', label: 'Draft · approval predates correction' };
    if (s.validated) return { key: 'draft', label: 'Draft · no named approval' };
    return { key: 'draft', label: 'Draft · registered' };
  }

  function recordRow(r) {
    var st = recordStatus(r);
    var claim = A.deriveState(r.events).claim || r.claim || {};
    return '<a class="row" href="#/record/' + encodeURIComponent(r.id) + '">' +
      '<span class="row-main"><strong>' + esc(claim.project_name || 'Untitled record') + '</strong>' +
      '<span class="muted">' + esc(claim.batch || '') + (claim.protocol ? ' · ' + esc(claim.protocol) : '') + '</span></span>' +
      '<span class="row-meta">' + (r.sample ? '<span class="pill">Sample</span>' : '') +
      '<span class="pill status-' + st.key + '">' + esc(st.label) + '</span>' +
      '<span class="muted">' + r.events.length + ' event' + (r.events.length === 1 ? '' : 's') + '</span></span></a>';
  }

  function renderRecords() {
    var mine = loadRecords();
    app.innerHTML =
      '<section class="page">' +
        storageNote() +
        '<div class="page-head"><div><p class="eyebrow">EXTERNAL RECORD</p><h1>Records</h1>' +
        '<p class="muted">One record per claim: one batch, one AI system.</p></div>' +
        '<a class="btn primary" href="#/new">Start a record</a></div>' +
        '<h2 class="section-title">Samples</h2>' +
        '<div class="rows">' + SAMPLES.records.map(recordRow).join('') + '</div>' +
        '<h2 class="section-title">Your records <span class="muted small">(this browser)</span></h2>' +
        (mine.length
          ? '<div class="rows">' + mine.slice().reverse().map(recordRow).join('') + '</div>'
          : '<p class="empty">No records yet. <a href="#/new">Start a record</a>.</p>') +
      '</section>';
    bindStorageNote();
  }

  function claimFields(claim, disabled) {
    claim = claim || {};
    var dis = disabled ? ' disabled' : '';
    var faceOpts = A.FACE_ORDER.map(function (f) {
      var sel = (claim.registry_face || 'isometric') === f ? ' selected' : '';
      return '<option value="' + f + '"' + sel + '>' + esc(faceLabel(f)) + (A.FACES[f].isDefault ? ' (default)' : '') + '</option>';
    }).join('');
    return '' +
      field('project_name', 'Project name', claim.project_name, 'e.g. Basin Ridge DAC Pilot', dis, true) +
      field('project_id', 'Project or facility id', claim.project_id, 'Registry project id (Verra) or facility id (Puro)', dis, true) +
      '<label class="field"><span>Registry face</span><select name="registry_face"' + dis + '>' + faceOpts + '</select>' +
        '<small>All three faces can be downloaded; this one is shown first. Isometric is the default face.</small></label>' +
      field('protocol', 'Protocol or methodology', claim.protocol, 'e.g. Direct air capture protocol', dis, true) +
      field('batch', 'Batch or period', claim.batch, 'e.g. Batch 2026-Q2-07 or monitoring period', dis, true);
  }

  function field(name, label, value, placeholder, dis, required, extra) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<input name="' + name + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '"' +
      (required ? ' required' : '') + (dis || '') + (extra || '') + '></label>';
  }

  function renderNew() {
    app.innerHTML =
      '<section class="page narrow">' +
        storageNote() +
        '<p class="eyebrow">STEP 1 · ONE CLAIM, ONE SYSTEM</p>' +
        '<h1>Start a record</h1>' +
        '<p class="muted">Open a record for one batch. These fields are fixed into the record when you seal the Registered event.</p>' +
        '<form class="card form" id="new-form">' + claimFields({}) +
          '<div class="form-actions"><button class="btn primary" type="submit">Open the record</button>' +
          '<a class="btn ghost" href="#/records">Cancel</a></div>' +
        '</form>' +
      '</section>';
    bindStorageNote();
    $('#new-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var claim = formData(e.target);
      var rec = { id: newRecordId(), created_at: nowIso(), claim: claim, events: [], packages: [] };
      try {
        saveRecord(rec, null);
      } catch (err) {
        showError(e.target, err.message);
        return;
      }
      location.hash = '#/record/' + rec.id;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Record                                                              */
  /* ------------------------------------------------------------------ */

  function renderRecord(id) {
    var record = id === null ? null : getRecord(id);
    if (!record) {
      app.innerHTML = '<section class="page narrow"><h1>No such record</h1><p>Records you start live in this browser only. <a href="#/records">See records</a>.</p></section>';
      return;
    }
    view = { recordId: record.id, head: headOf(record.events) };
    var health = recordHealth(record);
    // mode: 'sample' (read-only), 'damaged' (locked) or 'open'.
    var mode = record.sample ? 'sample' : health.ok ? 'open' : 'damaged';
    var ro = mode !== 'open';
    var s = A.deriveState(record.events);
    var chain = health.chain;
    var claim = s.claim || record.claim || {};
    var st = recordStatus(record, health);
    var concerns = A.deriveConcerns(s);
    var firstProblem = (chain.problems[0] || health.rules.problems[0] || null);
    nextStep = mode !== 'open' ? 0 : !s.registered ? 2 : !s.validated ? 3 : !s.approval ? 4
      : A.FACE_ORDER.every(function (f) { return A.deriveStatus(record.events, f) === 'issued'; }) ? 0 : 5;

    app.innerHTML =
      '<section class="page wide">' +
        (mode === 'sample' ? '<div class="banner">Sample record · read-only. <a href="#/new">Start your own record</a> to seal events.</div>' : storageNote()) +
        (mode === 'damaged' ? '<div class="concern-box damaged" role="alert"><strong>This record is damaged, so nothing more can be sealed or issued on it.</strong> ' +
          'Line ' + esc(firstProblem.seq) + ': ' + esc(firstProblem.message) + ' Its lines were changed or removed outside allocycle, or were written by an older version with different rules. Packages downloaded earlier are unchanged.</div>' : '') +
        '<div class="page-head">' +
          '<div><p class="eyebrow">ALLOGENIC RECORD · ' + esc(record.id) + '</p>' +
          '<h1>' + esc(claim.project_name || 'Untitled record') + '</h1>' +
          '<p class="muted">' + esc(claim.batch || '') + (claim.protocol ? ' · ' + esc(claim.protocol) : '') + '</p></div>' +
          '<div class="head-pills"><span class="pill status-' + st.key + '">' + esc(st.label) + '</span>' +
          '<span class="pill ' + (health.ok ? 'pass' : 'fail') + '">' + (!chain.pass ? 'Chain broken' : health.ok ? 'Chain intact' : 'Breaks the rules') + '</span></div>' +
        '</div>' +
        '<div class="record-grid">' +
          '<div class="record-steps">' +
            stepClaim(record, s, ro) +
            stepRegister(record, s, ro) +
            stepValidate(record, s, mode) +
            stepApprove(record, s, mode) +
            stepIssue(record, s, mode, concerns) +
            stepCorrection(record, s, mode) +
          '</div>' +
          '<aside class="record-log">' + eventLog(record, health) + '</aside>' +
        '</div>' +
      '</section>';

    bindRecord(record);
  }

  // The step to do next on an open record (0: none), marked so the person
  // can see where to go.
  var nextStep = 0;

  function stepCard(n, title, state, body, sealedEv, badgeText) {
    var isNext = n === nextStep;
    var badge = isNext ? '<span class="pill next">Next</span>'
      : badgeText ? '<span class="pill">' + esc(badgeText) + '</span>'
      : state === 'sealed' ? '<span class="pill sealed">Sealed</span>'
      : state === 'ready' ? '<span class="pill">Ready</span>'
      : state === 'concern' ? '<span class="pill concern">Concern</span>'
      : '<span class="pill muted-pill">Waiting</span>';
    return '<article class="card step step-' + state + (isNext ? ' step-next' : '') + '"' + (isNext ? ' aria-current="step"' : '') + '>' +
      '<header class="step-head"><span class="step-n">' + n + '</span><h2>' + esc(title) + '</h2>' + badge + '</header>' +
      (sealedEv ? '<p class="sealed-line">Line ' + esc(sealedEv.seq) + ' · ' + esc(sealedEv.type) + ' · ' + fmtTime(sealedEv.sealed_at) + ' · ' + hashSpan(sealedEv.hash) + '</p>' : '') +
      body + '</article>';
  }

  function kv(rows) {
    return '<dl class="kv">' + rows.filter(Boolean).map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[2] ? r[1] : esc(r[1] == null || r[1] === '' ? '—' : r[1])) + '</dd>';
    }).join('') + '</dl>';
  }

  function stepClaim(record, s, ro) {
    if (s.registered) {
      var c = s.claim;
      return stepCard(1, 'One claim, one system', 'sealed',
        kv([['Project', c.project_name], ['Project / facility id', c.project_id], ['Registry face', faceLabel(c.registry_face)],
          ['Protocol / methodology', c.protocol], ['Batch / period', c.batch]]) +
        '<p class="hint">Fixed by the Registered event on line ' + esc(s.registered.seq) + '.</p>');
    }
    return stepCard(1, 'One claim, one system', 'ready',
      '<form class="form" id="claim-form">' + claimFields(record.claim, ro) +
      '<p class="hint">Not sealed yet. Sealing Register (step 2) fixes these fields; saving them first is optional.</p>' +
      (ro ? '' : '<div class="form-actions"><button class="btn" type="submit">Save claim</button>' +
        (record.events.length ? '' : '<button class="btn ghost danger" type="button" id="discard">Discard this unsealed record</button>') +
        '<span class="hint" id="claim-saved" role="status"></span></div>') +
      '</form>', null, ro ? null : 'Part of Register');
  }

  // The label names only the field; the help text describes it and the
  // placeholder button sits outside the label.
  function hashField(name, label, value, dis, help) {
    return '<div class="field"><label for="f-' + name + '">' + esc(label) + '</label>' +
      '<div class="hash-input"><input id="f-' + name + '" name="' + name + '" value="' + esc(value || '') + '" placeholder="64 hex characters" spellcheck="false" autocomplete="off" required' +
      (help ? ' aria-describedby="h-' + name + '"' : '') + (dis || '') + '>' +
      (dis ? '' : '<button type="button" class="btn small ghost" data-fill="' + name + '" aria-label="Fill ' + esc(label) + ' with a random placeholder hash">Placeholder</button>') +
      '</div>' + (help ? '<small id="h-' + name + '">' + esc(help) + ' 64 hex characters; a "sha256:" prefix is accepted.</small>' : '') + '</div>';
  }

  function stepRegister(record, s, ro) {
    if (s.registered) {
      var src = s.registered.payload;
      return stepCard(2, 'Register', 'sealed', kv([
        ['AI system', src.ai_system], ['Version', src.version], ['Artifact hash', fullHash(src.artifact_hash), true], ['Model inputs', src.inputs]
      ]) + correctedNote(s, ['ai_system', 'ai_version', 'artifact_hash', 'inputs']), s.registered);
    }
    var dis = ro ? ' disabled' : '';
    return stepCard(2, 'Register', 'ready',
      '<form class="form" id="register-form">' +
        field('ai_system', 'AI system name', '', 'e.g. Plume dispersion surrogate', dis, true) +
        field('version', 'Version', '', 'e.g. 2.3.1', dis, true) +
        hashField('artifact_hash', 'Artifact hash', '', dis, 'SHA-256 of the model artifact, pasted from the team.') +
        '<label class="field"><span>Model inputs</span><textarea name="inputs" rows="2" placeholder="What the system reads, e.g. met-tower wind fields; exhaust flow"' + dis + '></textarea></label>' +
        (ro ? '' : '<div class="form-actions"><button class="btn primary" type="submit">Seal Registered event</button></div>') +
      '</form>');
  }

  function stepValidate(record, s, mode) {
    var ro = mode !== 'open';
    if (s.validated) {
      var p = s.validated.payload;
      return stepCard(3, 'Validate', 'sealed', kv([
        ['Data snapshot hash', fullHash(p.data_snapshot_hash), true], ['Validation type', p.validation_type],
        ['Result', p.summary], ['Reference', p.reference]
      ]) + correctedNote(s, ['data_snapshot_hash', 'validation_type', 'validation_summary']), s.validated);
    }
    var blocked = A.canSeal(record.events, E.VALIDATED);
    if (blocked || ro) return stepCard(3, 'Validate', 'waiting', '<p class="hint">' + esc(mode === 'sample' ? 'Not validated in this sample.' : mode === 'damaged' ? 'Locked: this record is damaged.' : blocked) + '</p>');
    return stepCard(3, 'Validate', 'ready',
      '<form class="form" id="validate-form">' +
        hashField('data_snapshot_hash', 'Data snapshot hash', '', '', 'SHA-256 of the data snapshot the system was validated on.') +
        '<fieldset class="field"><legend>Validation result</legend><div class="radios">' +
          A.VALIDATION_TYPES.map(function (t, i) {
            return '<label class="radio"><input type="radio" name="validation_type" value="' + t + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(t) + '</label>';
          }).join('') +
        '</div></fieldset>' +
        '<label class="field"><span>Result summary</span><textarea name="summary" rows="2" required placeholder="e.g. Compared with 14 held-out runs; all within the stated envelope"></textarea></label>' +
        field('reference', 'Reference', '', 'Memo, paper, or report id', '', false) +
        '<div class="form-actions"><button class="btn primary" type="submit">Seal Validated event</button></div>' +
      '</form>');
  }

  function stepApprove(record, s, mode) {
    var ro = mode !== 'open';
    var body = '';
    if (s.approval) {
      var p = s.approval.payload;
      return stepCard(4, 'Approve', 'sealed', kv([
        ['Person', asEntered(p.person), true], ['Role', p.role], ['Approved at', fmtTime(p.approved_at)], ['Intended use', p.intended_use]
      ]), s.approval);
    }
    if (s.staleApproval) {
      body += '<p class="concern-box">The approval on line ' + esc(s.staleApproval.seq) + ' was sealed before the correction on line ' +
        esc(s.lastCorrectionSeq) + '. A named person must approve the corrected record. Until then, downloads are draft packages.</p>';
    }
    var blocked = A.canSeal(record.events, E.APPROVED);
    if (mode === 'damaged') return stepCard(4, 'Approve', 'waiting', body + '<p class="hint">Locked: this record is damaged.</p>');
    if (ro) return stepCard(4, 'Approve', 'concern', body + '<p class="concern-box">No “Approved for use” event. Downloads from this record are draft packages, and the missing named approval is a concern for the evaluator.</p>');
    if (blocked) return stepCard(4, 'Approve', 'waiting', body + '<p class="hint">' + esc(blocked) + ' Before an Approved for use event, downloads are draft packages.</p>');
    return stepCard(4, 'Approve', s.staleApproval ? 'concern' : 'ready', body +
      '<form class="form" id="approve-form">' +
        field('person', 'Named person (name as entered; allocycle does not verify identity)', '', 'Full name of the person approving use', '', true) +
        field('role', 'Role', '', 'e.g. Model risk lead, project team', '', true) +
        '<label class="field"><span>Approval time</span><input type="datetime-local" name="approved_at" step="1" required value="' + localInputValue(new Date()) + '"><small>Your local time; stored as UTC.</small></label>' +
        '<label class="field"><span>Intended use</span><textarea name="intended_use" rows="2" required placeholder="What this system may be used for on this batch"></textarea></label>' +
        '<div class="form-actions"><button class="btn primary" type="submit">Seal Approved for use event</button></div>' +
      '</form>');
  }

  function stepIssue(record, s, mode, concerns) {
    var ro = mode !== 'open';
    // The record's registry face is shown first. "Default" is kept for
    // Isometric alone, as in the package format.
    var registryFace = (s.claim || record.claim || {}).registry_face || 'isometric';
    var canIssue = !!s.approval;
    var faces = A.FACE_ORDER.slice().sort(function (a, b) { return (a === registryFace ? -1 : 0) - (b === registryFace ? -1 : 0); });
    var cards = faces.map(function (face) {
      var cs = A.coverSheet(s.claim || record.claim, face);
      var stored = (record.packages || []).filter(function (p) { return p.face === face; }).slice(-1)[0];
      var rows = Object.keys(cs).filter(function (k) { return k !== 'face' && k !== 'default_face'; }).map(function (k) {
        var v = cs[k];
        return [k.replace(/_/g, ' '), Array.isArray(v) ? v.join(', ') : v];
      });
      var action;
      if (mode === 'sample') {
        action = stored ? '<button class="btn small" data-download-stored="' + face + '">Download ' + (stored.status === 'issued' ? 'issued' : 'draft') + ' package</button>' : '';
      } else if (mode === 'damaged') {
        action = '<p class="hint">Locked: this record is damaged.</p>';
      } else if (!s.registered) {
        action = '<p class="hint">Seal Register first.</p>';
      } else if (canIssue) {
        action = '<button class="btn small primary" data-issue="' + face + '">Issue ' + esc(faceLabel(face)) + ' package</button>';
      } else {
        action = '<button class="btn small" data-draft="' + face + '">Download draft package</button>';
      }
      if (mode !== 'sample' && stored) {
        // An issued file that a later line (a correction, a new approval)
        // replaced is still offered, but never as the current one.
        var superseded = stored.status === 'issued' && A.deriveStatus(record.events, face) !== 'issued';
        action += ' <button class="btn small ghost" data-download-stored="' + face + '">' +
          (superseded ? 'Re-download superseded issued file' : 'Re-download last ' + esc(stored.status)) +
          ' (' + esc(String(stored.package_hash).slice(0, 8)) + ')</button>' +
          (superseded ? '<p class="hint">A later line replaced this issued file. It is kept for the record; it is not current.</p>' : '');
      }
      return '<div class="face' + (face === registryFace ? ' face-first' : '') + '">' +
        '<h3>' + esc(faceLabel(face)) + (face === registryFace ? ' <span class="pill small">registry face</span>' : '') + '</h3>' +
        kv(rows) + '<div class="face-actions">' + action + '</div></div>';
    }).join('');

    var state = canIssue ? 'ready' : (s.registered ? 'concern' : 'waiting');
    if (s.approval && s.issued.some(function (ev) { return ev.seq > s.approval.seq; })) state = 'sealed';
    var head = canIssue
      ? '<p class="hint">Each issue seals a Package issued event, then writes the package hash into the file.</p>'
      : mode === 'open' && !s.registered
        ? '<p class="hint">Seal Register to download a draft package. Issuing needs a named approval.</p>'
        : '<div class="concern-box"><strong>Draft packages only.</strong><ul>' + concerns.map(function (c) { return '<li>' + esc(c.text) + '</li>'; }).join('') + '</ul></div>';
    return stepCard(5, 'Issue three cover sheets', state, head + '<div class="faces">' + cards + '</div>');
  }

  function correctedNote(s, fields) {
    var hits = s.corrections.filter(function (ev) {
      return ev.payload && typeof ev.payload.field === 'string' && fields.indexOf(ev.payload.field) !== -1;
    });
    if (!hits.length) return '';
    return '<div class="correction-note"><strong>Superseded by later lines</strong><ul>' + hits.map(function (ev) {
      var spec = A.CORRECTABLE[ev.payload.field];
      var v = spec.isHash ? hashSpan(ev.payload.value, 12) : esc(ev.payload.value);
      return '<li>Line ' + esc(ev.seq) + ': ' + esc(spec.label) + ' → ' + v + '</li>';
    }).join('') + '</ul><p class="hint">The sealed line above is unchanged. Correction lines sit on top of it.</p></div>';
  }

  function stepCorrection(record, s, mode) {
    if (mode !== 'open' || !s.registered) {
      return '<article class="card step step-muted"><header class="step-head"><span class="step-n">±</span><h2>Record a change</h2></header>' +
        '<p class="hint">' + (mode === 'sample' ? 'Sample records are read-only.' : mode === 'damaged' ? 'Locked: this record is damaged.' : 'A change in the team’s process is recorded as a new Correction event. Available after Register.') + '</p></article>';
    }
    var opts = Object.keys(A.CORRECTABLE).filter(function (k) {
      var need = A.CORRECTABLE[k].needs;
      return need === E.REGISTERED || (need === E.VALIDATED && s.validated);
    }).map(function (k) { return '<option value="' + k + '">' + esc(A.CORRECTABLE[k].label) + '</option>'; }).join('');
    return '<article class="card step"><header class="step-head"><span class="step-n">±</span><h2>Record a change</h2></header>' +
      '<p class="hint">Sealed lines are never edited. When the team’s own log changes, seal a Correction here. A correction after approval needs a new named approval before a package can be issued.</p>' +
      '<form class="form" id="correction-form">' +
        '<label class="field"><span>Field</span><select name="field">' + opts + '</select></label>' +
        '<label class="field"><span>Current value</span><output id="corr-current" class="current"></output></label>' +
        '<div class="field"><label for="corr-value-input">New value</label><div class="hash-input" id="corr-value"></div><small id="corr-value-help"></small></div>' +
        '<label class="field"><span>Reason</span><textarea name="reason" rows="2" required placeholder="What changed in the team’s process"></textarea></label>' +
        field('autogenic_reference', 'Reference in the team’s own log (optional)', '', 'e.g. internal log entry 14', '', false) +
        '<div class="form-actions"><button class="btn" type="submit">Seal Correction event</button></div>' +
      '</form></article>';
  }

  var EVENT_CLASS = {};
  EVENT_CLASS[E.REGISTERED] = 'registered';
  EVENT_CLASS[E.VALIDATED] = 'validated';
  EVENT_CLASS[E.APPROVED] = 'approved-for-use';
  EVENT_CLASS[E.CORRECTION] = 'correction';
  EVENT_CLASS[E.ISSUED] = 'package-issued';

  function eventLog(record, health) {
    var chain = health.chain;
    var bad = {};
    chain.problems.concat(health.rules.problems).forEach(function (p) {
      bad[p.seq] = (bad[p.seq] ? bad[p.seq] + ' ' : '') + p.message;
    });
    var items = record.events.map(function (ev, i) {
      var line = i + 1;
      var e = ev !== null && typeof ev === 'object' ? ev : {};
      var cls = typeof e.type === 'string' && Object.prototype.hasOwnProperty.call(EVENT_CLASS, e.type) ? EVENT_CLASS[e.type] : 'unknown';
      return '<li class="ev ev-' + cls + (bad[line] ? ' ev-bad' : '') + '">' +
        '<div class="ev-head"><span class="ev-seq">' + line + '</span><span class="ev-type">' + esc(e.type) + '</span>' +
        '<time>' + fmtTime(e.sealed_at) + '</time></div>' +
        '<div class="ev-hashes"><span>prev ' + hashSpan(e.prev_hash, 8) + '</span><span>hash ' + hashSpan(e.hash, 8) + '</span></div>' +
        (bad[line] ? '<p class="fail-text">' + esc(bad[line]) + '</p>' : '') +
        '<details><summary>Details</summary><dl class="kv full-hashes"><dt>hash</dt><dd><code class="hash full">' + esc(e.hash) + '</code></dd>' +
          '<dt>prev</dt><dd><code class="hash full">' + esc(e.prev_hash) + '</code></dd></dl>' +
          '<pre>' + esc(JSON.stringify(e.payload, null, 2)) + '</pre></details></li>';
    }).join('');
    return '<div class="card log">' +
      '<header class="log-head"><h2>Event log</h2><span class="muted small">append-only</span></header>' +
      '<p class="hint">Each line is sealed with SHA-256 over its contents and the hash of the line before it.</p>' +
      (items ? '<ol class="events">' + items + '</ol>' : '<p class="empty">No events yet. Sealing Register writes line 1.</p>') +
      '<p class="chain-head">Chain head <code class="hash full">' + esc(chain.head) + '</code></p></div>';
  }

  function bindRecord(record) {
    var rerender = function () { renderRecord(record.id); };
    var guard = function (fn) {
      return function (e) {
        e.preventDefault();
        var before = record.events.length;
        try {
          fn(e);
          rerender();
          afterWrite(before);
        } catch (err) {
          if (err.cancelled) return;
          if (err.stale) { rerender(); notice(err.message); return; }
          showError(e.target, err.message);
        }
      };
    };
    bindStorageNote();

    $$('[data-fill]').forEach(function (b) {
      b.addEventListener('click', function () { $('input[name="' + b.getAttribute('data-fill') + '"]', b.closest('form')).value = randomHex(); });
    });

    var claimForm = $('#claim-form');
    if (claimForm && !record.sample) {
      // Saving the claim does not redraw the page, so anything typed in the
      // Register form stays where it is.
      claimForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var out = $('#claim-saved');
        try {
          var next = copyOf(record);
          next.claim = formData(claimForm);
          saveRecord(next, headOf(record.events));
          record.claim = next.claim;
          out.textContent = 'Saved.';
        } catch (err) {
          if (err.stale) { rerender(); notice(err.message); return; }
          out.textContent = err.message;
        }
      });
      var discard = $('#discard');
      if (discard) discard.addEventListener('click', guard(function () {
        if (record.events.length) return;
        if (!confirm('Discard this record? It has no sealed events.')) throw cancelled();
        removeRecord(record.id, headOf(record.events));
        location.hash = '#/records';
      }));
    }

    var reg = $('#register-form');
    if (reg && !record.sample) reg.addEventListener('submit', guard(function () {
      if (!claimForm.reportValidity()) throw cancelled();
      var claimData = formData(claimForm);
      var d = formData(reg);
      appendEvent(record, { type: E.REGISTERED, payload: {
        claim: claimData, ai_system: d.ai_system, version: d.version, artifact_hash: tidyHash(d.artifact_hash), inputs: d.inputs || ''
      } }, 'Seal the Registered event? A sealed event cannot be edited or deleted. The claim fields are fixed with it.',
      function (next) { next.claim = claimData; });
    }));

    var val = $('#validate-form');
    if (val) val.addEventListener('submit', guard(function () {
      var d = formData(val);
      appendEvent(record, { type: E.VALIDATED, payload: {
        data_snapshot_hash: tidyHash(d.data_snapshot_hash), validation_type: d.validation_type, summary: d.summary, reference: d.reference || ''
      } }, 'Seal the Validated event? A sealed event cannot be edited or deleted.');
    }));

    var appr = $('#approve-form');
    if (appr) appr.addEventListener('submit', guard(function () {
      var d = formData(appr);
      var when = new Date(d.approved_at);
      appendEvent(record, { type: E.APPROVED, payload: {
        person: d.person, role: d.role, approved_at: isNaN(when) ? d.approved_at : when.toISOString().replace(/\.\d+Z$/, 'Z'), intended_use: d.intended_use
      } }, 'Seal the Approved for use event naming ' + d.person + '?\n\nThe name is recorded as entered; allocycle does not verify who this is. A sealed event cannot be edited or deleted.');
    }));

    var corr = $('#correction-form');
    if (corr) {
      var sel = $('select[name="field"]', corr);
      var cur = $('#corr-current');
      var box = $('#corr-value');
      var help = $('#corr-value-help');
      var currentValue = function () {
        var spec = A.CORRECTABLE[sel.value];
        var st = A.deriveState(record.events);
        return st[spec.section] ? st[spec.section][spec.key] : '';
      };
      // The new-value control fits the field: a list for fixed choices, a
      // hash box with a placeholder button for hashes, text otherwise.
      var sync = function () {
        var spec = A.CORRECTABLE[sel.value];
        var now = currentValue();
        cur.textContent = now || '—';
        var attrs = ' id="corr-value-input" name="value" aria-describedby="corr-value-help"';
        if (spec.options) {
          box.innerHTML = '<select' + attrs + '>' + spec.options.map(function (o) {
            return '<option value="' + esc(o) + '"' + (o === now ? ' disabled' : '') + '>' + esc(o) + (o === now ? ' (current)' : '') + '</option>';
          }).join('') + '</select>';
          var firstFree = spec.options.filter(function (o) { return o !== now; })[0];
          if (firstFree) $('select', box).value = firstFree;
          help.textContent = 'One of: ' + spec.options.join(', ') + '.';
        } else if (spec.isHash) {
          box.innerHTML = '<input' + attrs + ' required spellcheck="false" autocomplete="off" placeholder="Paste the new SHA-256">' +
            '<button type="button" class="btn small ghost" id="corr-fill" title="Fill with a random placeholder hash">Placeholder</button>';
          $('#corr-fill').addEventListener('click', function () { $('#corr-value-input').value = randomHex(); });
          help.textContent = '64 hex characters; a "sha256:" prefix is accepted.';
        } else {
          var mayBeEmpty = spec.key === 'description';
          box.innerHTML = '<input' + attrs + (mayBeEmpty ? '' : ' required') + ' autocomplete="off" placeholder="New value">';
          help.textContent = mayBeEmpty ? 'May be left empty.' : '';
        }
      };
      sel.addEventListener('change', sync);
      sync();
      corr.addEventListener('submit', guard(function () {
        var d = formData(corr);
        var spec = A.CORRECTABLE[d.field];
        // "previous" is left out on purpose: core derives it from the record.
        appendEvent(record, { type: E.CORRECTION, payload: {
          field: d.field, value: spec && spec.isHash ? tidyHash(d.value) : d.value, reason: d.reason, autogenic_reference: d.autogenic_reference || null
        } }, 'Seal a Correction event? Earlier lines stay as they are. If the record was approved, it will need a new named approval.');
      }));
    }

    $$('[data-issue]').forEach(function (b) {
      b.addEventListener('click', guard(function () {
        var face = b.getAttribute('data-issue');
        var pkg = null;
        appendEvent(record, { type: E.ISSUED, payload: { face: face } }, 'Issue the ' + faceLabel(face) + ' package? This seals a Package issued event.',
          function (next) {
            pkg = A.buildPackage({ recordId: next.id, events: next.events, face: face, generatedAt: nowIso() });
            next.packages.push(storedPackage(pkg));
          });
        download(packageFilename(record.id, pkg), pkg);
      }));
    });

    $$('[data-draft]').forEach(function (b) {
      b.addEventListener('click', guard(function () {
        var face = b.getAttribute('data-draft');
        var pkg = A.buildPackage({ recordId: record.id, events: record.events, face: face, generatedAt: nowIso() });
        download(packageFilename(record.id, pkg), pkg);
        // Keep one draft copy per face (drafts can always be rebuilt), so
        // repeated downloads do not fill the browser's storage.
        var next = copyOf(record);
        next.packages = next.packages.filter(function (p) { return !(p.face === face && p.status !== 'issued'); });
        next.packages.push(storedPackage(pkg));
        saveRecord(next, headOf(record.events));
      }));
    });

    $$('[data-download-stored]').forEach(function (b) {
      b.addEventListener('click', function () {
        var face = b.getAttribute('data-download-stored');
        var stored = (record.packages || []).filter(function (p) { return p.face === face; }).slice(-1)[0];
        if (stored) download(packageFilename(record.id, stored.json), stored.json);
      });
    });
  }

  // After a seal: say what was sealed, and move focus to the step to do
  // next (or the event log when there is none).
  function afterWrite(before) {
    var r = view.recordId ? getRecord(view.recordId) : null;
    if (!r || r.events.length <= before) return;
    var ev = r.events[r.events.length - 1];
    announce('Line ' + r.events.length + ' sealed: ' + ev.type + '.');
    var target = $('.step-next h2') || $('.record-log h2');
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: false });
    }
  }

  // Core's messages start with the field's label; that finds the field.
  var FIELD_NAMES = [
    ['Reference in the team\u2019s log', 'autogenic_reference'], ['Project or facility id', 'project_id'], ['Project name', 'project_name'],
    ['Registry face', 'registry_face'], ['Protocol or methodology', 'protocol'], ['Batch or period', 'batch'],
    ['AI system name', 'ai_system'], ['Version', 'version'], ['Artifact hash', 'artifact_hash'], ['Model inputs', 'inputs'],
    ['Data snapshot hash', 'data_snapshot_hash'], ['Validation type', 'validation_type'], ['Validation summary', 'summary'],
    ['Reference', 'reference'], ['Named person', 'person'], ['Role', 'role'], ['Approval time', 'approved_at'],
    ['Intended use', 'intended_use'], ['New value', 'value'], ['The new value', 'value'], ['Reason', 'reason']
  ];
  function fieldFor(message, form) {
    if (form && form.id === 'correction-form') {
      var corrected = Object.keys(A.CORRECTABLE).some(function (k) { return message.indexOf(A.CORRECTABLE[k].label) === 0; });
      if (corrected) return 'value';
    }
    var hit = FIELD_NAMES.filter(function (f) { return message.indexOf(f[0]) === 0; })[0];
    return hit ? hit[1] : null;
  }

  // Shows an error next to what the person was doing, marks the field it
  // is about, and moves focus there. Replaces any earlier error.
  function showError(target, message) {
    var form = target && target.closest ? target.closest('form') : null;
    var box = form || (target && target.closest ? target.closest('.face, .card') : null) || $('.page');
    $$('.form-error').forEach(function (el) { el.remove(); });
    $$('[aria-invalid="true"]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    var p = document.createElement('p');
    p.className = 'form-error';
    p.id = 'form-error';
    p.setAttribute('role', 'alert');
    p.textContent = message;
    var actions = box.querySelector('.form-actions, .face-actions');
    if (actions) box.insertBefore(p, actions); else box.appendChild(p);
    var name = fieldFor(message, form);
    var input = name ? ((form && form.querySelector('[name="' + name + '"]')) || $('[name="' + name + '"]')) : null;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', ((input.getAttribute('aria-describedby') || '').replace(/\bform-error\b/g, '') + ' form-error').trim());
      input.focus();
      input.addEventListener('input', function clear() {
        input.removeAttribute('aria-invalid');
        input.removeEventListener('input', clear);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Live agents (simulated playback)                                    */
  /* ------------------------------------------------------------------ */

  function renderAgents(caseId) {
    var current = CASES.filter(function (c) { return c.id === caseId; })[0] || CASES[0];
    var speed = 1;
    var timer = null;
    var lines = [];
    var stepIndex = 0;
    var running = false;

    app.innerHTML =
      '<section class="page">' +
        '<p class="sim-label">SIMULATED AGENTS · NOT A REAL CREDIT</p>' +
        '<h1>Live agents</h1>' +
        '<p class="muted">Playback writes steps as they happen, standing in for the Autogenic connector, the team’s log and the named person. Each line is hashed onto the line before it (SHA-256 chain). It does not call a real model or issue a package.</p>' +
        '<p class="hint">The connector only records what it <em>observed</em>: a version at the bound location and the hash it computed. Lines marked <em>reported</em> come from the team’s own log. Only a named <em>person</em> (here a sample name) turns an observation into a claim.</p>' +
        '<div class="cases" role="group" aria-label="Cases">' + CASES.map(function (c) {
          return '<button class="case' + (c.id === current.id ? ' active' : '') + '"' + (c.id === current.id ? ' aria-current="true"' : '') + ' data-case="' + c.id + '">' +
            '<span class="case-tag">' + esc(c.tag) + '</span><span class="case-title">' + esc(c.title) + '</span>' +
            '<span class="case-blurb">' + esc(c.blurb) + '</span></button>';
        }).join('') + '</div>' +
        '<div class="card player">' +
          '<div class="controls">' +
            '<button class="btn primary" id="run">Run case</button>' +
            '<label class="speed">Speed <select id="speed">' +
              [0.5, 1, 2, 4].map(function (v) { return '<option value="' + v + '"' + (v === 1 ? ' selected' : '') + '>' + v + '×</option>'; }).join('') +
            '</select></label>' +
            '<button class="btn ghost" id="reset">Reset</button>' +
            '<button class="btn ghost" id="recheck" disabled>Recheck chain</button>' +
            '<span class="muted small" id="progress"></span>' +
          '</div>' +
          '<div class="agents" id="agents">' + current.agents.map(function (a) {
            return '<span class="agent" data-agent="' + esc(a) + '"><i></i>' + esc(a) + '</span>';
          }).join('') + '</div>' +
          '<div role="log" aria-label="Playback log"><ol class="term" id="term"></ol></div>' +
          '<p class="chain-head" id="sim-head">Chain head ' + hashSpan(A.GENESIS, 10) + ' (genesis)</p>' +
          '<p class="hint" id="recheck-out" role="status"></p>' +
        '</div>' +
      '</section>';

    var term = $('#term');
    var progress = $('#progress');
    var runBtn = $('#run');

    function setActive(agent) {
      $$('.agent').forEach(function (el) {
        el.classList.toggle('busy', el.getAttribute('data-agent') === agent);
      });
    }
    function updateProgress() {
      progress.textContent = stepIndex + ' of ' + current.steps.length + ' lines';
      $('#recheck').disabled = !lines.length;
    }
    function writeLine(step) {
      var prev = lines.length ? lines[lines.length - 1].hash : A.GENESIS;
      var line = { seq: lines.length + 1, at: nowIso(), agent: step.agent, kind: step.kind || 'step', text: step.text, prev_hash: prev };
      line.hash = A.hashOf(line);
      lines.push(line);
      var li = document.createElement('li');
      li.className = 'term-line term-' + line.kind;
      li.innerHTML = '<span class="t-seq">' + line.seq + '</span>' +
        '<span class="t-time">' + esc(line.at.slice(11, 19)) + '</span>' +
        '<span class="t-agent">' + esc(line.agent) + '</span>' +
        '<span class="t-text"><span class="t-kind">' + esc(line.kind) + '</span> ' + esc(line.text) + '</span>' +
        '<span class="t-hash">' + hashSpan(line.hash, 8) + '<span class="muted"> ← ' + esc(line.prev_hash.slice(0, 6)) + '</span></span>';
      term.appendChild(li);
      term.scrollTop = term.scrollHeight;
      $('#recheck-out').textContent = ''; // an earlier recheck no longer covers the chain
      $('#sim-head').innerHTML = 'Chain head ' + hashSpan(line.hash, 10) + ' · ' + lines.length + ' line' + (lines.length === 1 ? '' : 's');
    }
    function tick() {
      if (stepIndex >= current.steps.length) {
        running = false; setActive(null);
        runBtn.textContent = 'Run again';
        progress.textContent = 'Done · ' + lines.length + ' lines · no package issued';
        $('#recheck').disabled = false;
        return;
      }
      var step = current.steps[stepIndex];
      setActive(step.agent);
      timer = setTimeout(function () {
        writeLine(step);
        stepIndex++;
        updateProgress();
        tick();
      }, step.wait / speed);
    }
    function reset() {
      clearTimeout(timer); timer = null;
      running = false; lines = []; stepIndex = 0;
      term.innerHTML = '';
      setActive(null);
      runBtn.textContent = 'Run case';
      $('#sim-head').innerHTML = 'Chain head ' + hashSpan(A.GENESIS, 10) + ' (genesis)';
      $('#recheck-out').textContent = '';
      updateProgress();
    }

    runBtn.addEventListener('click', function () {
      if (running) {
        clearTimeout(timer); running = false; setActive(null);
        runBtn.textContent = 'Resume';
        return;
      }
      if (stepIndex >= current.steps.length) reset();
      running = true;
      runBtn.textContent = 'Pause';
      tick();
    });
    // A new speed applies to the line already waiting, too.
    $('#speed').addEventListener('change', function (e) {
      speed = Number(e.target.value) || 1;
      if (running) { clearTimeout(timer); tick(); }
    });
    $('#reset').addEventListener('click', reset);
    $('#recheck').addEventListener('click', function () {
      var prev = A.GENESIS, ok = true;
      lines.forEach(function (l) {
        var copy = {}; Object.keys(l).forEach(function (k) { if (k !== 'hash') copy[k] = l[k]; });
        if (l.prev_hash !== prev || A.hashOf(copy) !== l.hash) ok = false;
        prev = l.hash;
      });
      $('#recheck-out').innerHTML = ok
        ? '<span class="pass-text">Recomputed ' + lines.length + ' line hashes: chain intact.</span>'
        : '<span class="fail-text">Chain broken.</span>';
    });
    $$('[data-case]').forEach(function (b) {
      // The case already shown keeps its playback; another case opens fresh.
      b.addEventListener('click', function () {
        if (b.getAttribute('data-case') !== current.id) location.hash = '#/agents/' + b.getAttribute('data-case');
      });
    });
    updateProgress();
    cleanup = function () { clearTimeout(timer); };
  }

  /* ------------------------------------------------------------------ */
  /* Verify                                                              */
  /* ------------------------------------------------------------------ */

  var MAX_ROWS = 100;
  function ownSample(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SAMPLES.packages, name) ? SAMPLES.packages[name] : null;
  }
  function joinList(items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function renderVerify(preset) {
    app.innerHTML =
      '<section class="page wide">' +
        '<p class="eyebrow">NO ACCOUNT REQUIRED</p>' +
        '<h1>Verify a package</h1>' +
        '<p class="muted">Paste package JSON or upload a file. The hash is recomputed the same way it was written: canonical JSON, keys sorted, whitespace removed, the <code>package_hash</code> field excluded, then SHA-256. An untouched file passes; a changed field fails, unless whoever changed it also rewrote the hash. Packages are not signed yet, so this page checks that a file is internally consistent, not who made it.</p>' +
        '<div class="verify-grid">' +
          '<div class="card">' +
            '<div class="sample-buttons">' +
              '<button class="btn" data-sample="issued">Check untouched sample</button>' +
              '<button class="btn" data-sample="altered">Check a changed field</button>' +
              '<button class="btn ghost" data-sample="unapproved">Check draft sample</button>' +
            '</div>' +
            '<label class="field"><span>Package JSON</span>' +
              '<textarea id="pkg-input" rows="16" spellcheck="false" placeholder="Paste an allocycle package here, or drop a .json file anywhere on this page"></textarea></label>' +
            '<div class="form-actions">' +
              '<button class="btn primary" id="verify-btn">Recompute hash</button>' +
              '<label class="btn ghost file-btn">Upload file<input type="file" id="pkg-file" accept=".json,application/json"></label>' +
              '<button class="btn ghost" id="clear-btn">Clear</button>' +
            '</div>' +
            '<details class="recompute"><summary>Recompute it yourself</summary>' +
              '<p class="hint">This Python command recomputes the hash and prints True when it matches the hash in the file. It gives the same result as this page for the values allocycle writes (text, booleans, null, small integers). Another tool must produce the same canonical form, which for these values is RFC 8785 (JCS).</p>' +
              '<pre>python3 -c "import json,hashlib,sys; d=json.load(open(sys.argv[1])); h=d.pop(\'package_hash\'); ' +
              'c=json.dumps(d,sort_keys=True,separators=(\',\',\':\'),ensure_ascii=False); ' +
              'print(h==hashlib.sha256(c.encode()).hexdigest())" package.json</pre>' +
            '</details>' +
          '</div>' +
          '<div id="verify-out" class="verify-out" role="region" aria-label="Verification result"><div class="card empty-state"><p>Results appear here.</p><p class="hint">Try “Check untouched sample”, then “Check a changed field”.</p></div></div>' +
        '</div>' +
      '</section>';

    var input = $('#pkg-input');
    // Keep the address in step with what is shown, without re-routing.
    var setPreset = function (name) {
      var want = name ? '#/verify/' + name : '#/verify';
      if (location.hash !== want) history.replaceState(null, '', want);
    };
    var run = function (opts) { showVerification(input.value, opts); };
    $('#verify-btn').addEventListener('click', function () { setPreset(null); run({ focus: true }); });
    $('#clear-btn').addEventListener('click', function () {
      setPreset(null);
      input.value = '';
      $('#verify-out').innerHTML = '';
      input.focus();
    });
    $$('[data-sample]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.getAttribute('data-sample');
        setPreset(name);
        input.value = JSON.stringify(ownSample(name), null, 2);
        run({ focus: true });
      });
    });
    var readFile = function (file) {
      if (!file) return;
      var r = new FileReader();
      r.onload = function () { setPreset(null); input.value = String(r.result); run({ focus: true }); };
      r.readAsText(file);
    };
    $('#pkg-file').addEventListener('change', function (e) { readFile(e.target.files[0]); e.target.value = ''; });
    // A dropped file is caught anywhere on the page; dropped text goes into
    // the box as usual.
    var page = $('.page');
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; };
    page.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); input.classList.add('drop'); } });
    page.addEventListener('dragleave', function (e) { if (!page.contains(e.relatedTarget)) input.classList.remove('drop'); });
    page.addEventListener('drop', function (e) {
      input.classList.remove('drop');
      if (!hasFiles(e)) return;
      e.preventDefault();
      readFile(e.dataTransfer.files[0]);
    });

    var sample = ownSample(preset);
    if (sample) {
      input.value = JSON.stringify(sample, null, 2);
      run({ focus: false });
    }
  }

  function showVerification(text, opts) {
    var out = $('#verify-out');
    out.innerHTML = '';
    var html;
    if (!text.trim()) {
      html = '<div class="card"><p class="fail-text" tabindex="-1">Paste a package first.</p></div>';
    } else {
      var r = A.verifyPackage(text);
      if (!r.ok) {
        html = '<div class="card verdict fail"><h2 tabindex="-1">Cannot check</h2><p>' + esc(r.error) + '</p></div>';
      } else {
        try {
          html = verificationHtml(r);
        } catch (e) {
          html = '<div class="card verdict fail"><h2 tabindex="-1">Cannot display this file</h2><p>' + esc(e.message) + '</p></div>';
        }
      }
    }
    out.innerHTML = html;
    var first = out.querySelector('[tabindex="-1"]');
    if (first) announce(first.textContent);
    // Bring the result into view (on a phone it sits below the input).
    if (opts && opts.focus && first) {
      first.focus({ preventScroll: true });
      out.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function verificationHtml(r) {
    var pkg = r.pkg;
    var lineProblems = function (list) {
      return list.map(function (p) { return (p.seq && !/^Line /.test(p.message) ? 'Line ' + p.seq + ': ' : '') + p.message; }).join(' ');
    };

    // The headline covers every check, not only the hash.
    var failed = [];
    if (!r.hash.pass) failed.push('the hash');
    if (r.checked) {
      if (!r.chain.pass) failed.push('the event chain');
      if (!r.rules.pass) failed.push('the event rules');
      if (!r.consistency.pass) failed.push('the outline check');
    }
    var state = !r.hash.pass ? 'fail' : !r.checked ? 'na' : r.consistent ? 'pass' : 'fail';
    var label = state === 'pass' ? 'PASS' : state === 'na' ? 'NOT CHECKED' : 'FAIL';
    var headline = !r.hash.pass
      ? 'Changed. The recomputed hash does not match the hash written into the file.'
      : state === 'na'
        ? 'The hash matches, but this verifier cannot check the rest of a file in this format.'
        : r.consistent
          ? 'Every check passed: the hash matches and the file agrees with its sealed events (origin not checked).'
          : 'The hash matches, but ' + joinList(failed) + ' failed. The file was probably changed and its hash rewritten.';
    var verdict =
      '<div class="card verdict ' + state + '">' +
        '<p class="verdict-label">' + label + '</p>' +
        '<h2 tabindex="-1">' + esc(headline) + '</h2>' +
        '<dl class="kv hashes"><dt>In the file</dt><dd><code class="hash full">' + esc(r.hash.stated) + '</code></dd>' +
        '<dt>Recomputed</dt><dd><code class="hash full">' + esc(r.hash.recomputed) + '</code></dd>' +
        '<dt>Canonical form</dt><dd>' + r.canonicalLength.toLocaleString() + ' characters, ' + esc(A.HASH_FIELD) + ' excluded</dd></dl>' +
      '</div>';

    // The status shown is the one the events support, not the one the file
    // states; the file's own claim is shown only when they differ.
    var derived = r.checked ? r.status.derived : null;
    var shown = derived || pkg.status;
    var statusLabel = shown === 'issued' ? 'Issued' : 'Draft package';
    var scope = !r.checked ? ' (as stated in the file; not checked)'
      : r.asOf.seq ? ' as of line ' + r.asOf.seq : ' (the file has no lines)';
    var concerns = (r.concerns || []).slice();
    if (r.checked && !r.rules.pass) {
      concerns.push({ code: 'RULES_NOT_MET', text: r.rules.problems.length + ' problem' + (r.rules.problems.length === 1 ? '' : 's') +
        ' with the order or fields of the events. See Further checks.' });
    }
    var status =
      '<div class="card status-card ' + (shown === 'issued' && r.consistent ? '' : 'concern') + '">' +
        '<h3>Package status: ' + esc(statusLabel + scope) + ' · ' + esc(faceLabel(pkg.face)) + ' face</h3>' +
        (derived && pkg.status !== derived
          ? '<p class="fail-text">The file says ' + esc(JSON.stringify(pkg.status)) + '; its events support ' + esc(JSON.stringify(derived)) + '.</p>' : '') +
        (failed.length
          ? '<p class="fail-text">Do not rely on this status. Failed: ' + esc(joinList(failed)) + '.</p>' : '') +
        (r.checked
          ? '<p class="hint">This file shows the record up to line ' + esc(r.asOf.seq) + (r.asOf.head ? ' (chain head ' + hashSpan(r.asOf.head, 10) + ')' : '') +
            '. It cannot show anything sealed after that line.</p>' +
            (concerns.length
              ? '<ul class="concerns">' + concerns.map(function (c) { return '<li><strong>' + esc(c.code) + '</strong> ' + esc(c.text) + '</li>'; }).join('') + '</ul>'
              : '<p class="hint">No concerns derived from the events.</p>')
          : '<p class="hint">' + esc(r.reason) + '</p>') +
        // Always the app's own words, never the file's.
        '<p class="hint">' + esc(A.NOTICE + ' ' + A.SCOPE) + '</p>' +
      '</div>';

    var diffs = r.checked && r.consistency.diffs ? r.consistency.diffs : [];
    var diffTable = diffs.length
      ? '<table class="diffs"><thead><tr><th>Field</th><th>In the file</th><th>From the events</th></tr></thead><tbody>' +
        diffs.slice(0, MAX_ROWS).map(function (d) {
          return '<tr><td><code>' + esc(d.path) + '</code></td><td class="fail-text">' + esc(d.stated) + '</td><td>' + esc(d.derived) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (diffs.length > MAX_ROWS ? '<p class="hint">And ' + (diffs.length - MAX_ROWS).toLocaleString() + ' more differing fields not shown.</p>' : '')
      : '';
    var items;
    if (r.checked) {
      var count = Array.isArray(pkg.events) ? pkg.events.length : 0;
      items =
        checkItem(r.chain.pass, 'Event chain', r.chain.pass
          ? count + ' events; each hash recomputes and links to the line before it.'
          : lineProblems(r.chain.problems.slice(0, MAX_ROWS))) +
        checkItem(r.rules.pass, 'Events follow the rules', r.rules.pass
          ? 'Each line was replayed against the envelope, order and payload rules: known event types only, in a valid order, with valid fields and seal times.'
          : lineProblems(r.rules.problems.slice(0, MAX_ROWS))) +
        checkItem(r.consistency.pass, 'Outline matches the events', r.consistency.pass
          ? 'Outline, cover sheet, concerns, status and the fixed notice all re-derive from the sealed events.'
          : r.consistency.error || 'These fields differ from what the sealed events say:', diffTable);
    } else {
      items = checkItem(null, 'Event chain, rules and outline', r.reason);
    }
    items += checkItem(null, 'Origin', r.origin.text);

    var checks =
      '<div class="card">' +
        '<h3>Further checks</h3>' +
        '<ul class="checks">' + items + '</ul>' +
      '</div>';

    return verdict + status + checks + outlineView(pkg, r.consistent);
  }

  // pass: true, false, or null for "not checked". `more` is trusted HTML
  // shown under the text (the field-difference table).
  function checkItem(pass, title, text, more) {
    var cls = pass === null ? 'na' : pass ? 'pass' : 'fail';
    var mark = pass === null ? '–' : pass ? '✓' : '✕';
    var word = pass === null ? 'Not checked' : pass ? 'Passed' : 'Failed';
    return '<li class="' + cls + '"><span class="mark" aria-hidden="true">' + mark + '</span><div><strong>' + esc(title) +
      ' <span class="sr-only">(' + word + ')</span></strong><p>' + esc(text) + '</p>' + (more || '') + '</div></li>';
  }

  // Shows the outline as written in the file; every value is escaped and
  // odd shapes are tolerated, because the file may be hostile.
  function outlineView(pkg, consistent) {
    var obj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null; };
    var o = obj(pkg.outline) || {};
    var cs = obj(pkg.cover_sheet) || {};
    var none = '<p class="hint">None on record.</p>';
    var section = function (title, body, concern) {
      return '<section class="ol-section' + (concern ? ' concern' : '') + '"><h4>' + esc(title) + '</h4>' + body + '</section>';
    };
    var source = obj(o.source), inp = obj(o.inputs), dat = obj(o.data), vali = obj(o.validation), na = obj(o.named_approval), bb = obj(o.batch_binding);
    var src = source ? kv([['AI system', source.ai_system], ['Version', source.version], ['Artifact hash', fullHash(source.artifact_hash), true]]) : none;
    var allMods = Array.isArray(o.modifications) ? o.modifications.filter(obj) : [];
    var modList = allMods.slice(0, MAX_ROWS);
    var mods = modList.length
      ? '<ul class="mods">' + modList.map(function (m) {
          var spec = typeof m.field === 'string' && Object.prototype.hasOwnProperty.call(A.CORRECTABLE, m.field) ? A.CORRECTABLE[m.field] : { label: String(m.field) };
          var fmt = function (v) { return spec.isHash ? hashSpan(v, 10) : esc(v); };
          return '<li><strong>Line ' + esc(m.seq) + '</strong> · ' + esc(spec.label) + ': ' + fmt(m.previous) + ' → ' + fmt(m.value) +
            '<br><span class="muted">' + esc(m.reason) + (m.autogenic_reference ? ' (' + esc(m.autogenic_reference) + ')' : '') + '</span></li>';
        }).join('') + '</ul>' +
        (allMods.length > MAX_ROWS ? '<p class="hint">And ' + (allMods.length - MAX_ROWS).toLocaleString() + ' more not shown.</p>' : '')
      : '<p class="hint">No corrections.</p>';
    var inputs = inp ? kv([['Model inputs', inp.description]]) : none;
    var data = dat ? kv([['Snapshot hash', fullHash(dat.snapshot_hash), true]]) : none;
    var val = vali ? kv([['Type', vali.type], ['Result', vali.summary], ['Reference', vali.reference]]) : none;
    var appr = na
      ? kv([['Person', asEntered(na.person), true], ['Role', na.role], ['Time', fmtTime(na.approved_at)], ['Intended use', na.intended_use]])
      : '<p class="concern-text">Missing. No current “Approved for use” event. This is a concern for the evaluator.</p>';
    var bind = bb
      ? kv([['Project', bb.project_name], ['Project / facility id', bb.project_id], ['Registry face', faceLabel(bb.registry_face)], ['Protocol', bb.protocol],
          ['Batch / period', bb.batch], ['Bound at', 'line ' + bb.bound_at_seq], ['Registered line hash', fullHash(bb.registered_event_hash), true]])
      : none;
    var cover = kv(Object.keys(cs).filter(function (k) { return k !== 'face'; }).map(function (k) {
      var v = cs[k]; return [k.replace(/_/g, ' '), Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)];
    }));
    return '<div class="card outline">' +
      '<h3>Outline' + (consistent ? '' : ' <span class="muted small">(as written in the file; it did not pass every check)</span>') + '</h3>' +
      '<div class="ol-grid">' +
        section('Source', src) +
        section('Modifications', mods) +
        section('Inputs', inputs) +
        section('Data', data) +
        section('Validation', val) +
        section('Named approval', appr, !na) +
        section('Batch binding', bind) +
        section('Cover sheet · ' + (typeof cs.face === 'string' ? cs.face : '—'), cover) +
      '</div></div>';
  }

  route();
})();
