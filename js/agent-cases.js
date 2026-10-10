/*
 * Scripted cases for the Live agents page. Simulated playback only: nothing
 * here calls a model, and no case issues a package.
 *
 * The playback follows the reviewed connector design: the connector only
 * records what it observed (a version at the bound location and the hash it
 * computed). It never asserts what a batch used. A named person turns an
 * observation into a claim (Registered, Validated, Correction).
 *
 * Each step: agent, kind, text, wait (ms before the line is written at 1x).
 * kind: observed (connector saw it) · reported (the team's own log says it)
 *       person (a named person decided it) · sealed (a record event)
 *       correction (a Correction event) · note
 */
(function () {
  'use strict';
  var h = function (label) { return window.Allocycle.sha256Hex('allocycle-sim:' + label); };
  var short = function (hex) { return hex.slice(0, 12) + '…'; };

  window.ALLOCYCLE_CASES = [
    {
      id: 'dac',
      tag: 'DAC SCREENING',
      title: 'Plume surrogate',
      blurb: 'A surrogate model screens contactor exhaust plumes against the site boundary.',
      agents: ['connector', 'team: surrogate', 'person', 'record'],
      steps: [
        { agent: 'connector', kind: 'observed', wait: 400, text: 'New version at the bound location: plume-surrogate v2.3.1 (onnx). Fetched by version id; sha256 ' + short(h('plume-2.3.1')) + '. An observation, not a claim.' },
        { agent: 'person', kind: 'person', wait: 900, text: 'Claim opener confirms: this is the AI system for batch SIM-2026-Q2-07.' },
        { agent: 'record', kind: 'sealed', wait: 600, text: 'Registered: "Plume dispersion surrogate" v2.3.1, pinned to the version id the connector fetched.' },
        { agent: 'connector', kind: 'observed', wait: 900, text: 'Data snapshot export at the bound location: met-tower + contactor exhaust, Q2 window. sha256 ' + short(h('snap-q2')) + '.' },
        { agent: 'team: surrogate', kind: 'reported', wait: 1000, text: 'Team log: screening runs 1–3 complete (plume extent vs. site boundary).' },
        { agent: 'team: surrogate', kind: 'reported', wait: 1000, text: 'Team log: hold-out check, surrogate vs. 14 held-out dispersion runs, 14 of 14 within the stated envelope.' },
        { agent: 'person', kind: 'person', wait: 900, text: 'Named person enters the validation result: hold-out, against snapshot ' + short(h('snap-q2')) + '.' },
        { agent: 'record', kind: 'sealed', wait: 600, text: 'Validated: hold-out result recorded. The connector supplied only the snapshot hash.' },
        { agent: 'record', kind: 'note', wait: 900, text: 'No "Approved for use" event in this playback. Any download would be a draft package.' }
      ]
    },
    {
      id: 'ccus',
      tag: 'CCUS SCREENING',
      title: 'Pressure screen',
      blurb: 'A screening model checks bottom-hole pressure during injection against an operating envelope.',
      agents: ['connector', 'team: pressure-screen', 'person', 'record'],
      steps: [
        { agent: 'connector', kind: 'observed', wait: 400, text: 'New version at the bound location: pressure-screen v0.9.4 (pkl). Fetched by version id; sha256 ' + short(h('pscreen-0.9.4')) + '.' },
        { agent: 'person', kind: 'person', wait: 900, text: 'Claim opener confirms: this is the AI system for injection period SIM-2026-03.' },
        { agent: 'record', kind: 'sealed', wait: 600, text: 'Registered: "Bottom-hole pressure screen" v0.9.4, pinned to the fetched version id.' },
        { agent: 'connector', kind: 'observed', wait: 900, text: 'Gauge export at the bound location, March. sha256 ' + short(h('gauge-03')) + '.' },
        { agent: 'team: pressure-screen', kind: 'reported', wait: 1100, text: 'Team log: 744 hourly intervals screened; 2 flagged for engineer review. Flags only; no quantity computed.' },
        { agent: 'team: pressure-screen', kind: 'reported', wait: 1100, text: 'Team log: empirical check against the step-rate test record, 2 of 2 known excursions flagged.' },
        { agent: 'person', kind: 'person', wait: 900, text: 'Named person enters the validation result: empirical, against snapshot ' + short(h('gauge-03')) + '.' },
        { agent: 'record', kind: 'sealed', wait: 600, text: 'Validated: empirical result recorded.' },
        { agent: 'record', kind: 'note', wait: 900, text: 'Playback ends here. No package is issued from a simulation.' }
      ]
    },
    {
      id: 'correction',
      tag: 'CORRECTION',
      title: 'New line, not an edit',
      blurb: 'A new file appears after a line was written. The connector records it as an observation; only a named person turns it into a correction.',
      agents: ['connector', 'team: surrogate', 'person', 'record'],
      steps: [
        { agent: 'connector', kind: 'observed', wait: 400, text: 'New version at the bound location: plume-surrogate v2.3.0. sha256 ' + short(h('plume-2.3.0')) + '.' },
        { agent: 'person', kind: 'person', wait: 800, text: 'Claim opener confirms: this is the AI system for batch SIM-2026-Q3-02.' },
        { agent: 'record', kind: 'sealed', wait: 600, text: 'Registered: "Plume dispersion surrogate" v2.3.0.' },
        { agent: 'team: surrogate', kind: 'reported', wait: 1000, text: 'Team log: screening run complete.' },
        { agent: 'connector', kind: 'observed', wait: 1100, text: 'New version at the bound location: v2.3.1. sha256 ' + short(h('plume-2.3.1')) + '. Recorded as an observation, not a correction: a new file does not show which one the run used.' },
        { agent: 'person', kind: 'person', wait: 1000, text: 'Claim opener classifies line 5: the run used v2.3.1 (the team re-exported it; the team’s own log says so).' },
        { agent: 'record', kind: 'correction', wait: 800, text: 'Correction (corrects line 3, cites line 5): version v2.3.0 → v2.3.1. Line 3 is not edited.' },
        { agent: 'record', kind: 'note', wait: 900, text: 'Line 3 still hashes to the same value. Any approval sealed before line 7 is now out of date and needs a new named approval.' }
      ]
    }
  ];
})();
