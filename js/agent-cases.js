/*
 * Scripted cases for the Live agents page. Simulated playback only: nothing
 * here calls a model, and no case issues a package.
 *
 * Each step: agent, text, wait (ms before the line is written at 1x speed).
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
      agents: ['connector', 'surrogate', 'screen', 'record'],
      steps: [
        { agent: 'connector', wait: 400, text: 'Artifact appeared: plume-surrogate v2.3.1 (onnx). sha256 ' + short(h('plume-2.3.1')) },
        { agent: 'record', wait: 700, text: 'Registered: AI system "Plume dispersion surrogate" v2.3.1 bound to batch SIM-2026-Q2-07.' },
        { agent: 'connector', wait: 900, text: 'Data snapshot appeared: met-tower + contactor exhaust, Q2 window. sha256 ' + short(h('snap-q2')) },
        { agent: 'surrogate', wait: 1100, text: 'Loaded surrogate v2.3.1. Run 1 of 3: exhaust plume extent vs. site boundary.' },
        { agent: 'surrogate', wait: 1000, text: 'Run 2 of 3: low-wind stratified case.' },
        { agent: 'surrogate', wait: 1000, text: 'Run 3 of 3: high-wind case. Screening outputs written.' },
        { agent: 'screen', wait: 1200, text: 'Hold-out check: surrogate vs. 14 held-out full dispersion runs. 14 of 14 within stated envelope.' },
        { agent: 'record', wait: 800, text: 'Validated: hold-out result recorded against snapshot ' + short(h('snap-q2')) + '.' },
        { agent: 'record', wait: 900, text: 'No "Approved for use" event in this playback. Any download would be a draft package.' }
      ]
    },
    {
      id: 'ccus',
      tag: 'CCUS SCREENING',
      title: 'Pressure screen',
      blurb: 'A screening model checks bottom-hole pressure during injection against an operating envelope.',
      agents: ['connector', 'pressure-screen', 'reviewer', 'record'],
      steps: [
        { agent: 'connector', wait: 400, text: 'Artifact appeared: pressure-screen v0.9.4 (pkl). sha256 ' + short(h('pscreen-0.9.4')) },
        { agent: 'record', wait: 700, text: 'Registered: AI system "Bottom-hole pressure screen" v0.9.4 bound to injection period SIM-2026-03.' },
        { agent: 'connector', wait: 900, text: 'Data snapshot appeared: downhole gauge export, March. sha256 ' + short(h('gauge-03')) },
        { agent: 'pressure-screen', wait: 1100, text: 'Screening 744 hourly intervals against the operating pressure envelope.' },
        { agent: 'pressure-screen', wait: 1100, text: '2 intervals flagged for engineer review. Flags only; no quantity computed.' },
        { agent: 'reviewer', wait: 1200, text: 'Empirical check: flags compared with step-rate test record. 2 of 2 known excursions flagged.' },
        { agent: 'record', wait: 800, text: 'Validated: empirical result recorded against snapshot ' + short(h('gauge-03')) + '.' },
        { agent: 'record', wait: 900, text: 'Playback ends here. No package is issued from a simulation.' }
      ]
    },
    {
      id: 'correction',
      tag: 'CORRECTION',
      title: 'New line, not an edit',
      blurb: 'The team’s own log changes after a line was written. The external record adds a line; it never rewrites one.',
      agents: ['connector', 'surrogate', 'record'],
      steps: [
        { agent: 'connector', wait: 400, text: 'Artifact appeared: plume-surrogate v2.3.0. sha256 ' + short(h('plume-2.3.0')) },
        { agent: 'record', wait: 700, text: 'Registered: AI system "Plume dispersion surrogate" v2.3.0 bound to batch SIM-2026-Q3-02.' },
        { agent: 'surrogate', wait: 1000, text: 'Screening run complete with v2.3.0.' },
        { agent: 'connector', wait: 1200, text: 'Team’s autogenic log changed: the run used v2.3.1, re-exported. sha256 ' + short(h('plume-2.3.1')) },
        { agent: 'record', wait: 900, kind: 'correction', text: 'Correction (corrects line 2): version v2.3.0 → v2.3.1; artifact hash updated. Line 2 is not edited.' },
        { agent: 'record', wait: 900, text: 'Line 2 still hashes to the same value. The chain now carries both the original line and the correction.' }
      ]
    }
  ];
})();
