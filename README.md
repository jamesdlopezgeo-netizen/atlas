# allocycle

**Allogenic record. Autogenic log.**

allocycle is an external log of the AI system (and the carbon model, if any) used on one CDR or CCUS carbon-credit batch. The prototype keeps one system per record, so a carbon model gets its own record. It is written outside the project team that produced the carbon quantity. It does not score the credit, quantify tons, or submit anything to a registry. It is a checkable record a later reviewer can hold next to the project team's own folder.

> Prototype. Not a registry submission. Use sample data only. No real model connectors.

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
npm start            # python3 -m http.server 8080, then open http://localhost:8080
npm test             # core tests, plus browser tests when Playwright is installed
npm run test:core    # core only: hashing, chain, rules, verify, frozen samples
npm run test:app     # browser only: the real pages in Chromium
npm run build:samples          # check the frozen samples, rewrite js/samples-data.js
npm run build:samples -- --check   # check both, write nothing
```

Brand fonts load from Google Fonts when you're online. Offline, system fonts stand in.

## Pages

| Route | What it does |
| --- | --- |
| `#/` | Home: what allocycle is, why, how it works |
| `#/records`, `#/new` | Sample records and records you start (stored in this browser's local storage) |
| `#/record/:id` | Claim → Register → Validate → Approve → Issue three cover sheets; record corrections; append-only event log. A "Next" marker shows the step to do next |
| `#/agents` | Live agents: simulated playback of three cases, each line SHA-256-chained onto the last. The connector only records what it observed; a named person turns an observation into a claim |
| `#/verify` | No account. Paste, upload or drop package JSON; recompute the hash; replay the rules; see the outline |

## Rules the code enforces

- **Append-only.** The only write path seals a new event (`appendEvent` in `js/app.js`, which calls `sealEvent` in `js/core.js`). Each event's hash covers its contents and the previous event's hash. A correction is a new `Correction` event; earlier lines stay as they were.
- **One set of rules, in core.** `sealEvent` runs the order rules (`canSeal`: `Registered` fixes the claim → `Validated` → `Approved for use` → `Package issued`) the payload rules (`validateEvent`: a per-type field allowlist, hash format, validation types, registry faces, real calendar dates, well-formed text, which fields a Correction may change and when, no no-op corrections) and the envelope rules (exact event fields, an ISO 8601 seal time, a non-empty `recorded_by`). A Correction's `previous` value is derived from the record, never taken from the caller. The form, the sample builder and any later connector all go through this one path.
- **Time order.** Lines are sealed in time order, and an approval time falls between registration (by the minute) and the moment the approval is sealed.
- **No sealing on a damaged record.** If a stored record's chain is broken or a line breaks the rules (edited outside allocycle, or written under older rules), `sealEvent` refuses, and the Record page locks the record and says why.
- **Browser storage.** Records live in this browser's local storage. Every write re-reads storage and saves one record, and is refused if another tab moved that record on in the meantime. A write that fails (storage full or blocked) is reported and nothing is shown as sealed. Stored text that cannot be read is never overwritten.
- **Issued vs draft.** A package is `issued` only when the record has a current `Approved for use` event and a `Package issued` event for that face after it. Otherwise it is a draft package, and `status_note` says why: the concerns (`MISSING_APPROVAL`, or `APPROVAL_PRECEDES_CORRECTION` if a correction came after the approval), or, for an approved record, that no Package issued event for this face was sealed after the approval. An issued file that a later line replaced is offered on the Record page as "superseded", never as current.
- **Three faces.** Isometric (default; labeled `G-K6MR-0`, `G-6VGD-0`), Verra (project id, `VM0049`, monitoring period), Puro (facility id, methodology, production batch). The record's own registry face is shown first.

## Hashing rule

`package_hash` = SHA-256 (hex) of the canonical JSON of the package: object keys sorted, whitespace between tokens removed, the top-level `package_hash` field excluded. Verify recomputes it the same way.

For the values allocycle writes (text, booleans, null, small integers, ASCII keys), this canonical form is the same as RFC 8785 (JCS), and Python's `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)` produces it too. Outside those values the forms can differ: Python's output differs for floats, integers above 2^53 and keys outside the Basic Multilingual Plane; JCS differs only for unpaired surrogates, which allocycle refuses to seal. For allocycle packages:

```sh
python3 -c "import json,hashlib,sys; d=json.load(open(sys.argv[1])); h=d.pop('package_hash'); c=json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=False); print(h==hashlib.sha256(c.encode()).hexdigest())" samples/issued.json
```

`package_hash` is compared exactly as written (no `sha256:` prefix, lower case), as the Python check does.

Verify also re-checks the event chain, replays every line against the envelope, order and payload rules in one pass (an unknown event type is reported, never skipped; a malformed line fails the checks rather than switching them off), and re-derives the outline, cover sheet, concerns and status from the sealed events, so a changed field is located, not only detected. The fixed text in a v1 package (`notice`, `scope`, `status_note`, `hash_rule`) is checked too, and the page always shows its own notice, never the file's. The headline is PASS only when every check passes. A file shows the record only up to its last line, so Verify reports status "as of line N", and it shows the status the events support, noting when the file claims a different one.

**What a passing hash does not show.** A changed field fails, unless whoever changed it also rewrote the hash. The hash rule is published and packages are not signed yet, so anyone can build a file that passes every check. Verify says so: its origin check reads "not checked", and it treats `recorded_by` and the approver's name as self-asserted ("name as entered, not verified"). Signing packages is planned before any real team data is used.

## Samples

The sample files are frozen test vectors for format `allocycle.package/v1`. `scripts/build-samples.js` rebuilds them from fixed inputs and fails if the result differs by a single byte; it never rewrites them. It writes only `js/samples-data.js`, and with `--check` it writes nothing. The tests pin each file's package hash and its exact bytes. Verify checks `format` and only re-derives `allocycle.package/v1` files; for any other format it recomputes the hash and says the rest was not checked.

- `samples/issued.json`: issued Isometric package (DAC plume surrogate, one correction, named approval).
- `samples/unapproved.json`: draft package (CCUS pressure screen, no `Approved for use` event).
- `samples/altered.json`: the issued package with `outline.validation.type` changed after issue. It fails.
- `samples/issued-verra.json`, `samples/issued-puro.json`: the issued record under the Verra and Puro faces.

## Files

- `js/core.js`: SHA-256, canonical JSON, events, outline, packages, verification (shared by browser, builder and tests)
- `js/app.js`: router and views
- `js/agent-cases.js`: scripted playback cases
- `js/samples-data.js`: generated sample records and packages
- `test/core.test.js`: core tests; `test/app.test.js`: browser tests (skipped without Playwright)
- `css/style.css`: styles (light and dark) built on the brand tokens
- `brand/`: logo, mark, app icons, favicon, and the brand rules (color meanings, type, usage) in `brand/README.md`
