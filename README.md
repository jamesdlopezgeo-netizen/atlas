# allocycle

**Allogenic record. Autogenic log.**

allocycle is an external log of the AI system (and the carbon model, if any) used on one CDR or CCUS carbon-credit batch. It is written outside the project team that produced the carbon quantity. It does not score the credit, quantify tons, or submit anything to a registry. It is a checkable record a later reviewer can hold next to the project team's own folder.

> Prototype. Not a registry submission. Sample data only. No real model connectors.

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
npm start            # python3 -m http.server 8080, then open http://localhost:8080
npm test             # node test runner: hashing, chain, verify, samples
npm run build:samples
```

## Pages

| Route | What it does |
| --- | --- |
| `#/` | Home: what allocycle is, why, how it works |
| `#/records`, `#/new` | Sample records and records you start (stored in this browser's local storage) |
| `#/record/:id` | Claim → Register → Validate → Approve → Issue three cover sheets; record corrections; append-only event log |
| `#/agents` | Live agents: simulated playback of three cases, each line SHA-256-chained onto the last. The connector only records what it observed; a named person turns an observation into a claim |
| `#/verify` | No account. Paste or upload package JSON; recompute the hash; see the outline |

## Rules the code enforces

- **Append-only.** The only write path seals a new event (`appendEvent` in `js/app.js`, which calls `sealEvent` in `js/core.js`). Each event's hash covers its contents and the previous event's hash. A correction is a new `Correction` event; earlier lines stay as they were.
- **One set of rules, in core.** `sealEvent` runs the order rules (`canSeal`: `Registered` fixes the claim → `Validated` → `Approved for use` → `Package issued`) and the payload rules (`validateEvent`: a per-type field allowlist, hash format, validation types, registry faces, which fields a Correction may change and when, no no-op corrections). A Correction's `previous` value is derived from the record, never taken from the caller. The form, the sample builder and any later connector all go through this one path.
- **Issued vs draft.** A package is `issued` only when the record has a current `Approved for use` event and a `Package issued` event for that face after it. Otherwise it is a draft package, and the concerns list says why (`MISSING_APPROVAL`, or `APPROVAL_PRECEDES_CORRECTION` if a correction came after the approval).
- **Three faces.** Isometric (default; labeled `G-K6MR-0`, `G-6VGD-0`), Verra (project id, `VM0049`, monitoring period), Puro (facility id, methodology, production batch).

## Hashing rule

`package_hash` = SHA-256 (hex) of the canonical JSON of the package: object keys sorted, whitespace between tokens removed, the top-level `package_hash` field excluded. Verify recomputes it the same way.

For the values allocycle seals (strings, booleans, null, integers, ASCII keys), this canonical form is the same as RFC 8785 (JCS), and Python's `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)` produces it too. That equivalence is not general: it can break for floats, lone surrogates, and keys outside the Basic Multilingual Plane, none of which allocycle writes. For allocycle packages:

```sh
python3 -c "import json,hashlib,sys; d=json.load(open(sys.argv[1])); h=d.pop('package_hash'); c=json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=False); print(h==hashlib.sha256(c.encode()).hexdigest())" samples/issued.json
```

Verify also re-checks the event chain, replays every line against the order and payload rules (an unknown event type is reported, never skipped), and re-derives the outline, cover sheet, concerns and status from the sealed events, so a changed field is located, not only detected. A file shows the record only up to its last line, so Verify reports status "as of line N".

**What a passing hash does not show.** A changed field fails, unless whoever changed it also rewrote the hash. The hash rule is published and packages are not signed yet, so anyone can build a file that passes every check. Verify says so: it reports "hash matches (origin not checked)", and treats `recorded_by` and the approver's name as self-asserted ("name as entered, not verified"). Signing packages is planned before any real team data is used.

## Samples

The three sample files are frozen test vectors for format `allocycle.package/v1`. `scripts/build-samples.js` rebuilds them from fixed inputs and fails if the result differs by a single byte; it never rewrites them. It writes only `js/samples-data.js`. Verify checks `format` and only re-derives `allocycle.package/v1` files; for any other format it recomputes the hash and says the rest was not checked.

- `samples/issued.json`: issued Isometric package (DAC plume surrogate, one correction, named approval).
- `samples/unapproved.json`: draft package (CCUS pressure screen, no `Approved for use` event).
- `samples/altered.json`: the issued package with `outline.validation.type` changed after issue. It fails.

## Files

- `js/core.js`: SHA-256, canonical JSON, events, outline, packages, verification (shared by browser, builder and tests)
- `js/app.js`: router and views
- `js/agent-cases.js`: scripted playback cases
- `js/samples-data.js`: generated sample records and packages
- `css/style.css`: styles (light and dark)
