#!/usr/bin/env node
/*
 * Builds the sample records and sample packages from fixed inputs.
 *
 *   samples/issued.json       issued package (Isometric face)
 *   samples/unapproved.json   draft package, no "Approved for use" event
 *   samples/altered.json      issued.json with one outline field changed after issue
 *   js/samples-data.js        the same, plus the sample records, for the browser
 *
 * Output is deterministic: run it again and the files do not change.
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

const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), text);
  console.log('wrote', rel);
};
const pretty = (v) => JSON.stringify(v, null, 2) + '\n';

write('samples/issued.json', pretty(issuedPackages.isometric));
write('samples/unapproved.json', pretty(draftPackages.isometric));
write('samples/altered.json', pretty(altered));
write(
  'js/samples-data.js',
  '/* Generated by scripts/build-samples.js. Do not edit by hand. */\n' +
    'window.ALLOCYCLE_SAMPLES = ' +
    JSON.stringify({ records: records, packages: { issued: issuedPackages.isometric, unapproved: draftPackages.isometric, altered: altered } }, null, 2) +
    ';\n'
);
