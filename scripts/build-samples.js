#!/usr/bin/env node
/*
 * Builds the sample records for the browser and checks the sample packages.
 *
 *   samples/issued.json       issued package (Isometric face)
 *   samples/unapproved.json   draft package, no "Approved for use" event
 *   samples/altered.json      issued.json with one outline field changed after issue
 *   samples/issued-verra.json the same record issued under the Verra face
 *   samples/issued-puro.json  the same record issued under the Puro face
 *
 * The sample files are frozen test vectors for format allocycle.package/v1.
 * This script never rewrites them: it rebuilds the packages from fixed
 * inputs and fails if the result differs by one byte, or if a vector file
 * is missing (frozen vectors are never regenerated). It writes only
 * js/samples-data.js, which embeds the frozen files.
 *
 *   node scripts/build-samples.js           check vectors, write js/samples-data.js
 *   node scripts/build-samples.js --check   check vectors and js/samples-data.js; write nothing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const A = require('../js/core.js');

const ROOT = path.join(__dirname, '..');
const fakeHash = (label) => A.sha256Hex('allocycle-sample:' + label);

function sealAll(steps) {
  const events = [];
  for (const step of steps) events.push(A.sealEvent(events, step));
  return events;
}

/* Issued sample: DAC, plume surrogate, one correction before approval. */
const issuedClaim = {
  project_name: 'Sample: Basin Ridge DAC Pilot',
  project_id: 'SAMPLE-DAC-0042',
  registry_face: 'isometric',
  protocol: 'Direct air capture protocol (sample)',
  batch: 'Batch 2026-Q2-07'
};

const issuedEvents = sealAll([
  {
    type: A.EVENT.REGISTERED,
    at: '2026-07-01T14:02:11Z',
    payload: {
      claim: issuedClaim,
      ai_system: 'Plume dispersion surrogate',
      version: '2.3.1',
      artifact_hash: fakeHash('plume-surrogate-2.3.1.onnx'),
      inputs: 'Met-tower wind fields; contactor exhaust temperature and flow; site boundary polygon'
    }
  },
  {
    type: A.EVENT.VALIDATED,
    at: '2026-07-03T09:41:50Z',
    payload: {
      data_snapshot_hash: fakeHash('snapshot-2026-Q2-07-v1'),
      validation_type: 'hold-out',
      summary: 'Surrogate compared with 14 held-out full dispersion runs; all 14 within the stated screening envelope.',
      reference: 'Project team validation memo VM-07 (sample)'
    }
  },
  {
    type: A.EVENT.CORRECTION,
    at: '2026-07-05T16:20:03Z',
    payload: {
      field: 'data_snapshot_hash',
      previous: fakeHash('snapshot-2026-Q2-07-v1'),
      value: fakeHash('snapshot-2026-Q2-07-v2'),
      reason: 'The team re-exported the data snapshot after a time-zone fix. Line 2 stays as it was; this line records the change.',
      autogenic_reference: 'Project team internal log, entry 14 (sample)'
    }
  },
  {
    type: A.EVENT.APPROVED,
    at: '2026-07-08T11:05:27Z',
    payload: {
      person: 'M. Ortega (sample)',
      role: 'Model risk lead, project team',
      approved_at: '2026-07-08T11:00:00Z',
      intended_use: 'Screening support for plume checks on batch 2026-Q2-07. Not used to quantify removals.'
    }
  }
]);

const issuedPackages = {};
const issueTimes = { isometric: '2026-07-09T08:30:00Z', verra: '2026-07-09T08:31:12Z', puro: '2026-07-09T08:32:40Z' };
for (const face of A.FACE_ORDER) {
  issuedEvents.push(A.sealEvent(issuedEvents, {
    type: A.EVENT.ISSUED,
    at: issueTimes[face],
    payload: { face: face }
  }));
  issuedPackages[face] = A.buildPackage({
    recordId: 'sample-issued',
    events: issuedEvents.slice(),
    face: face,
    generatedAt: issueTimes[face]
  });
}

/* Unapproved sample: CCUS pressure screen, registered and validated, no approval. */
const draftClaim = {
  project_name: 'Sample: Gulf Coast Saline Storage',
  project_id: 'SAMPLE-CCUS-0117',
  registry_face: 'isometric',
  protocol: 'Geologic storage monitoring protocol (sample)',
  batch: 'Injection period 2026-03'
};

const draftEvents = sealAll([
  {
    type: A.EVENT.REGISTERED,
    at: '2026-04-02T10:12:44Z',
    payload: {
      claim: draftClaim,
      ai_system: 'Bottom-hole pressure screen',
      version: '0.9.4',
      artifact_hash: fakeHash('pressure-screen-0.9.4.pkl'),
      inputs: 'Downhole gauge pressure and temperature; injection rate; step-rate test record'
    }
  },
  {
    type: A.EVENT.VALIDATED,
    at: '2026-04-06T15:27:09Z',
    payload: {
      data_snapshot_hash: fakeHash('gauge-export-2026-03'),
      validation_type: 'empirical',
      summary: 'Screen flags compared with engineer-reviewed step-rate test intervals; 2 of 2 known excursions flagged.',
      reference: 'Reservoir engineering note RE-22 (sample)'
    }
  }
]);

const draftGeneratedAt = '2026-04-07T09:00:00Z';
const draftPackages = {};
for (const face of A.FACE_ORDER) {
  draftPackages[face] = A.buildPackage({
    recordId: 'sample-unapproved',
    events: draftEvents,
    face: face,
    generatedAt: draftGeneratedAt
  });
}

/* Altered sample: one field changed after issue, hash left as it was. */
const altered = JSON.parse(JSON.stringify(issuedPackages.isometric));
altered.outline.validation.type = 'peer-review';

const records = [
  {
    id: 'sample-issued',
    sample: true,
    created_at: '2026-07-01T14:00:00Z',
    claim: issuedClaim,
    events: issuedEvents,
    packages: A.FACE_ORDER.map((face) => ({
      face: face,
      status: issuedPackages[face].status,
      package_hash: issuedPackages[face].package_hash,
      generated_at: issuedPackages[face].generated_at,
      json: issuedPackages[face]
    }))
  },
  {
    id: 'sample-unapproved',
    sample: true,
    created_at: '2026-04-02T10:00:00Z',
    claim: draftClaim,
    events: draftEvents,
    packages: A.FACE_ORDER.map((face) => ({
      face: face,
      status: draftPackages[face].status,
      package_hash: draftPackages[face].package_hash,
      generated_at: draftPackages[face].generated_at,
      json: draftPackages[face]
    }))
  }
];

const pretty = (v) => JSON.stringify(v, null, 2) + '\n';
const CHECK = process.argv.includes('--check');
const vectors = {
  issued: issuedPackages.isometric,
  unapproved: draftPackages.isometric,
  altered: altered,
  'issued-verra': issuedPackages.verra,
  'issued-puro': issuedPackages.puro
};
const frozen = {};
let mismatch = false;
for (const name of Object.keys(vectors)) {
  const rel = 'samples/' + name + '.json';
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error('MISSING ' + rel + ' (frozen vectors are never regenerated; restore it from version control)');
    mismatch = true;
    continue;
  }
  const onDisk = fs.readFileSync(file, 'utf8');
  if (onDisk !== pretty(vectors[name])) {
    console.error('MISMATCH ' + rel + ': the builder no longer reproduces this frozen v1 test vector.');
    mismatch = true;
  }
  frozen[name] = JSON.parse(onDisk);
}
if (mismatch) {
  console.error('Nothing was written. If the package format changed on purpose, add new vectors under a new format version instead of editing these.');
  process.exit(1);
}
console.log('ok   samples/*.json match the builder (frozen v1 vectors, not rewritten)');

// The Verify page offers the three original samples.
const shown = { issued: frozen.issued, unapproved: frozen.unapproved, altered: frozen.altered };
const out = 'js/samples-data.js';
const bundle = '/* Generated by scripts/build-samples.js. Do not edit by hand. */\n' +
  'window.ALLOCYCLE_SAMPLES = ' + JSON.stringify({ records: records, packages: shown }, null, 2) + ';\n';
if (CHECK) {
  if (fs.readFileSync(path.join(ROOT, out), 'utf8') !== bundle) {
    console.error('MISMATCH ' + out + ': run `npm run build:samples` to regenerate it.');
    process.exit(1);
  }
  console.log('ok   ' + out + ' is up to date (not written)');
} else {
  fs.writeFileSync(path.join(ROOT, out), bundle);
  console.log('wrote', out);
}
