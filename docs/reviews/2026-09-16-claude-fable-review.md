# Harness Lab — independent Claude Code review

Date: September 16, 2026  
Reviewer: Claude Code 2.1.273, **Fable 5.1**, exact model `claude-fable-5-1`  
Reasoning: **Extra-high (`xhigh`)**  
Authentication: existing Claude Max subscription login (`claude.ai`, first-party)

## How this review was run

Claude received a 38-file source snapshot covering the frontend, server, tests, deployment scripts, package files, and documentation. Credentials, all `.env` files, saved user data, backups, releases, build output, dependencies, and local Azure state were excluded. The snapshot also omitted public assets. Claude had only Read, Glob, and Grep, confined to that snapshot. Safe mode disabled project customizations; no extra agents or external tools were allowed. The CLI completed successfully with no permission denials.

The review was explicitly pinned with `--model claude-fable-5-1 --effort xhigh` and `CLAUDE_CODE_EFFORT_LEVEL=xhigh`. All 57 assistant messages, including the report, identify the requested Fable model. CLI accounting additionally records a small auxiliary Haiku operation (14 output tokens); no subagents were spawned. This was not a replacement of the reviewing model. CLI cost estimates are not an invoice for the Max subscription.

The application source hashes still matched the snapshot after the review. No fixes were applied. This report is the only project artifact added by the review.

## Coordinator validation and qualifications

These notes are from Codex, separate from Claude's original report below.

- **Build and tests passed:** `npm run check` completed successfully: TypeScript checks, production frontend/server build, and all **40 tests**. Those tests used isolated stores and mocked OpenAI calls. No paid OpenAI call was made for this review.
- **F1 reproduced:** in a separate production server process using a temporary data directory, making `runs.json.tmp` unwritable by replacing it with a directory caused an `EISDIR` write failure. Starting a simulator run then terminated that isolated process with exit code 1. The development server and hosted site were untouched. A direct harness check also confirmed that the same persistence failure is attempted three times and escapes as a rejected promise. The fix should contain the rejection and stop the affected run safely when persistence is unavailable; merely logging it or continuing tool writes without a reliable trace would not be sufficient.
- **F2 reproduced:** supplying an aborted signal with the exact reason `Run timeout.` produced status `cancelled` and event `Run cancelled`. This verifies the reason-to-status mapping without waiting five minutes or calling a model.
- **F3 reproduced:** both malformed JSON and a JSON body above 64 KB returned HTTP **500** with the generic local-data error in that isolated server. Return curated 400/413 messages; do not blindly echo arbitrary parser internals.
- **F4–F7:** the cited code supports the accessibility, tiny-label, response-parsing, and stale-approval concerns. Screen-reader behavior, computed browser sizing, and timing-dependent clicks were not exercised in this review; those remain browser-validation tasks.
- **F8 needs correction:** the field-guide form includes native number-input `min`/`max` constraints. Claude's statement that out-of-range values fail *only* after submit with Zod is not established and overlooks native form validation. Treat input-editing consistency as a UX recommendation, not a confirmed validation bypass. Do not copy the per-keystroke clamp without checking typing behavior.
- **F9 and F11 are low-priority interpretation issues:** stale reflection/prediction state is cleared or replaced on the next run; tool-call totals currently count requests, including rejected requests. Naming that metric more explicitly may help, but counting requests is not itself a tool-execution defect.
- **F12:** the repository has no automated frontend/browser test suite. The README's browser-verification sentence can describe earlier manual verification; it does not explicitly claim an automated Playwright suite. Clarify that distinction rather than calling the earlier verification nonexistent.
- **H5 resolved:** `public/favicon.svg` exists in the actual project. It was absent only from the review snapshot, so there is no missing-favicon finding.
- **H1–H4 and H6:** no new live OpenAI call, Azure configuration audit, session-expiry test, or dialog-focus browser check was performed as part of this review. Keep these as verification questions, not established defects. Earlier deployment verification included successful live calls; the source-only reviewer could not inspect that live evidence.
- **Additional Codex finding, low severity:** `server/tools.ts:42-43` allows a standalone period through its character check, then silently skips it during tokenization. An isolated check of `calculate('1 + . + 2')` returned `3` instead of rejecting the invalid expression; `24 * 7` still returned `168`. Validate that tokenization consumes every non-whitespace character. This finding is from the coordinator, not Claude's report.

Suggested first work batch: contain storage failures, distinguish deadline expiry from user cancellation, return accurate request-body errors, and announce approval pauses. For the learning experience, connect the explanation under the comparison to the actual outcomes rather than displaying the same conclusion after every run.

## Original Claude report

The following report is preserved verbatim. Its source references are project-relative, and its unverified hypotheses should be read with the qualifications above.

---

## 1. Overall assessment

The core is sound. The agent loop, tool-call protocol, approval gate, comparison isolation, and secret handling are implemented carefully and match what the documentation claims. Every function call receives a matching output, reasoning state is preserved across turns, approvals are server-owned with stale-ID rejection and expiry, and comparison variants really do get cloned memory snapshots. The configuration table meets the stated requirement: On/Off feature switches, aligned setting rows, one collapsible section with a differences count, no per-version popups.

I found no High-severity defects. The most important finding is a robustness gap: a storage write failure during a run becomes an unhandled promise rejection and takes down the whole Node process. The second is a teaching-accuracy bug: the five-minute run timeout is reported to the learner as a user cancellation. The rest are low-severity correctness, error-message, and accessibility issues, plus several hypotheses that need a live environment to confirm.

I could not execute tests or run the app. All findings are from reading the snapshot.

## 2. Prioritized findings

Confirmed code findings first, then hypotheses that need runtime verification.

### Confirmed

**F1. Medium. Storage failure crashes the server via unhandled rejection.**
`server/index.ts:73-74` starts `executeRun` with `void` and a `.finally()` but no `.catch()`. Inside the harness, `event()` at `server/harness.ts:17-22` calls `store.saveRun` unguarded on every event. If that throws, the catch block at `server/harness.ts:125-129` calls `event()` again, which throws again, and the `finally` at `server/harness.ts:130-134` calls `saveRun` a third time. The rejected promise is discarded, and Node's default behavior for an unhandled rejection is to exit the process.
Trigger: any `readFileSync`, `writeFileSync`, or `renameSync` failure in `server/store.ts:10-18`. Examples are disk quota on the Azure Files `/home` share, a transient SMB I/O error, a permissions change, or a corrupted `runs.json`.
Observed: all active runs die, the process restarts, and every in-flight run is marked "Server restarted during this run." Expected: the affected run ends `failed` with a clear message and other runs continue.
Fix: add `.catch()` at the call site that logs and marks the run failed in memory; wrap `store.saveRun` inside `event()` so a persistence error becomes a warning event rather than an exception; register `process.on('unhandledRejection')` logging. Verify by making the data directory read-only after startup and starting a run.

**F2. Medium-Low. Run timeout is labeled as a user cancellation.**
`server/index.ts:65` aborts with `Error('Run timeout.')` and `server/index.ts:105` aborts with `Error('Cancelled by user.')`, but `server/harness.ts:127-129` maps every aborted signal to status `cancelled`, output "Run stopped...", and event title "Run cancelled". The reason is never inspected.
Why it matters: the Budgets & stopping lesson at `src/lessons.ts:13` teaches that runs time out after five minutes, but a learner who hits that limit sees "Cancelled". A live run that stalls looks like something they did.
Fix: read `control.signal.reason?.message` and emit a distinct `limit` event with status `stopped` for the timeout case. Add a test that injects a short deadline.

**F3. Low. Body-parser errors return 500 with a misleading message.**
The error handler at `server/index.ts:108-111` special-cases only `ZodError`. `express.json({ limit: '64kb' })` at `server/index.ts:44` raises 413 for oversized bodies and 400 for malformed JSON, and both become "The server could not complete this request. Check local data files and retry."
Trigger: a four-variant comparison with long instructions plus maximal context and prompt approaches the limit, and the limit is in bytes while the textarea `maxLength` attributes count UTF-16 units, so multibyte text can cross it.
Fix: forward `err.status` when it is a 4xx and return the body-parser message.

**F4. Low. The studio never announces approval pauses to assistive technology.**
`src/studio/VariantColumn.tsx:12` renders the approval block as a plain region and `src/studio/VariantColumn.tsx:48` renders status text with no live region. The only live announcement in the studio is the run-control count at `src/studio/Studio.tsx:165`, which says "N harnesses are working" and never changes when one pauses. The field guide handles this correctly through `src/HarnessMap.tsx:65`.
Fix: announce "Version B is waiting for your approval" through the existing `role="status"` element or add a polite live region for status transitions.

**F5. Low. Diagram labels in the execution inspector render at roughly 7px.**
`src/studio/studio.css:8` sets `.st-circuit-end small` to `.54rem` and `.st-return-wire` to `.53rem`; `src/studio/studio.css:25` sets `.st-detail-machine .st-return-wire` to `.47rem` and `.st-detail-machine .st-capabilities` to `.56rem`. At the 14px root in `src/styles.css:5` these are 6.6 to 7.8px. PRODUCT.md promises readable text. The labels are inside an optional disclosure, so impact is contained, but they are effectively decorative.
Fix: floor these at about `.7rem` or remove the micro-labels and rely on the aria-labels already present.

**F6. Low. Non-JSON server responses surface raw parser errors in the UI.**
`src/studio/api.ts:3` and `src/App.tsx:13` call `response.json()` unconditionally. An Azure 502 page during restart or a sign-in redirect produces "Unexpected token '<'" or "Failed to fetch" in the error banner.
Fix: check the content type before parsing and map failures to "The server is unavailable. Reload the page and sign in again if prompted."

**F7. Low. Approval buttons briefly re-enable after a decision.**
`src/studio/Studio.tsx:141-147` clears the `deciding` flag when the POST returns but does not update the local run. Until the next poll, up to 400ms later, the stale approval block is clickable, and a second click returns 409 and an error banner. `src/App.tsx:91` avoids this by refetching the run immediately.
Fix: refetch the run or optimistically remove `approval` from local state after a successful decision.

**F8. Low. Field-guide number inputs are not clamped.**
`src/App.tsx:139` writes `Number(e.target.value)` directly, so clearing a field yields 0 and out-of-range values fail only at submit with a Zod message. `src/studio/ConfigurationTable.tsx:40` clamps correctly.
Fix: reuse the studio clamp.

**F9. Low. Removing a version leaves stale state.**
`src/studio/Studio.tsx:120-123` resets runs, fingerprint, and comparison ID but not `predictions`, `reflection`, or `explain`. Cosmetic.

**F10. Low. A README example silently triggers retrieval.**
`README.md:107` lists "Create a note: Check the launch plan." as a note example, but `server/provider.ts:61` matches the word "launch" as a policy query, so the simulator searches knowledge first and creates the note on turn two. A reader following the README to learn the note tool sees an unexplained retrieval turn. The lesson and studio prompts avoid this word.
Fix: change the README example or narrow the policy regex when a note is requested.

**F11. Low. Rejected extra tool calls are counted as tool calls.**
`server/harness.ts:59` increments `run.toolCalls` before the one-tool-per-turn rejection at `server/harness.ts:63`. Only a misbehaving provider triggers it, since `parallel_tool_calls: false` is sent. Cosmetic.

**F12. Info. Browser tests referenced but absent.**
`tsconfig.json:8` includes `playwright.config.ts`, `.gitignore:11-12` ignores Playwright output, and `README.md:182` says browser verification covers the interface. The snapshot has no browser tests, no Playwright dependency, and no frontend unit tests. Not a bug, but the README reads as if that coverage is automated.

### Hypotheses requiring runtime verification

**H1. OpenAI strict schemas containing length keywords.**
`server/tools.ts:10-14` declares `min`/`max` on strings and arrays, and `server/tools.ts:29` emits them as `minLength`, `maxLength`, `minItems`, `maxItems` with `strict: true`. OpenAI's strict-mode keyword subset has historically rejected some of these. The mocked transport at `tests/harness.test.ts:125-132` never validates the tools payload. The runbook's deployment record claims a live comparison succeeded, which if accurate means the current API accepts them. Verify with one real call. If rejected, strip length keywords from the emitted schema and keep Zod enforcement on the server.

**H2. Azure authentication flag and health-path exclusion.**
`server/access.ts:27` refuses all hosted requests unless `WEBSITE_AUTH_ENABLED` is truthy, and `server/index.ts:29` places `/healthz` before access control. Whether the platform sets that variable in the container, and whether App Service Authentication is in "require sign-in" mode with `/healthz` excluded rather than "allow anonymous," can only be confirmed in the portal. If it is in allow-anonymous mode the app's owner check is the only gate. That is still correct, but single-layer.

**H3. Sixty-second per-request SDK timeout.**
`server/provider.ts:18` sets `timeout: 60000`. This is not mentioned in the README, which documents only the five-minute deadline. With retries on, one slow turn can consume two minutes, and the resulting error has no status so the learner sees a generic connection message. Verify with a long-output live prompt and consider naming the timeout in the message.

**H4. Hosted session expiry during polling.**
If the sign-in cookie expires mid-session, fetch follows the redirect and fails opaquely. Combined with F6 the learner sees an unhelpful banner and must reload.

**H5. Missing favicon asset.**
`index.html:2` references `/favicon.svg` and there is no `public/` directory in the snapshot. If it is truly absent, `server/index.ts:118` serves `index.html` as the icon. The snapshot may simply have omitted it.

**H6. Dialog focus restoration.**
`src/App.tsx:21-25` unmounts the `<dialog>` instead of calling `close()`. Focus may not return to the triggering button in every browser. Check with keyboard only.

## 3. Learning and UX recommendations

These are design recommendations, not bugs.

- **Say why the run button is disabled on the memory experiment.** `src/studio/Studio.tsx:165` disables it when no memories exist but gives no reason near the button. Put "Teach a fact first" in the status line.
- **Reframe "Inject a test failure."** `src/studio/ConfigurationTable.tsx:13` lists it as a peer of memory and retrieval in every experiment. For a mixed audience it reads as a harness capability. Move it to Additional settings or label it as a test control.
- **Make the reasoning-token claim observable.** `src/lessons.ts:13` teaches that the output budget includes reasoning tokens, but `server/provider.ts:25` records only totals. Capture `output_tokens_details.reasoning_tokens` and show it in the live trace. Likewise surface `incomplete_details.reason` so "Incomplete model response" distinguishes a token limit from a content filter.
- **Make the tool-recovery row truthful for live mode.** `src/studio/ConfigurationTable.tsx:12` describes only the calculator retry, but `server/provider.ts:18` also ties the SDK HTTP retry to the same switch. README line 167 says so; the table should too, since the table is the comparison's source of truth.
- **Show the remaining daily live budget.** `server/index.ts:45` returns the limit but not usage, and the studio ignores both. A learner on the hosted preview learns about the limit only from a 429.
- **Close the prediction loop with a dynamic summary.** The "What this comparison teaches" text at `src/studio/Studio.tsx:191` is static. `observed()` in `src/studio/experiments.ts:121-137` already scores each column, so a one-line generated sentence such as "A stopped at its limit; B and C answered" would connect the insight to what actually happened.
- **The loop experiment's third column adds little in the simulator.** `src/studio/experiments.ts:15` uses budgets 1, 2, and 4; columns B and C behave identically. Either say in the insight that spare budget is harmless or make the third column informative.

What works well pedagogically: the trace event copy explains the mechanism at the moment it happens, `observed()` scores from trace evidence rather than answer text, the dirty-state banner prevents mismatched conclusions, and the copy consistently separates model choices from harness enforcement.

## 4. Architecture and test gaps

- **No frontend tests.** `changedControls`, restore-on-refresh, polling, dirty state, notebook, and the prediction flow are untested. `observed()` is the only studio function covered.
- **Restart recovery is untested.** `server/index.ts:22-27` is verified only by the runbook's manual note.
- **Timeout paths are untested.** Neither the five-minute deadline nor F2's labeling has a test. The approval-expiry test at `tests/harness.test.ts:64-66` mocks the rejection rather than exercising the timer in `server/index.ts:67`.
- **Hosted limits are unit-tested but not wired-tested.** `tests/hosting.test.ts:52-62` covers `reserveLiveRuns`; nothing exercises `server/index.ts:81` or `:89`, and nothing covers the mutation limiter at `server/index.ts:37-43`.
- **Production static serving is untested.** `tests/api.test.ts:19` spawns the dev server, so the deny rules at `server/index.ts:113-118` have no automated coverage.
- **Untested harness branches:** one-tool-per-turn rejection at `server/harness.ts:63`, memory-full in both scopes at `server/harness.ts:88` and `server/store.ts:24`, a provider response with `status: 'failed'`, and containment of a store failure per F1.
- **Persistence design notes.** `server/store.ts:30-34` rewrites the entire 30-run file synchronously on every event of every run. This is fine today and is the first thing to change if concurrency grows. `server/store.ts:10-13` does no schema validation, so a hand-edited or partially restored file fails at startup. That is a reasonable fail-loud choice for one owner but should be documented.
- **Backup exists, restore does not.** `scripts/backup-azure.mjs` is careful about the token and integrity. The runbook calls restore "a separate maintenance operation" with no steps. Note that restoring `live-usage.json` from an older backup silently resets the daily counter.

## 5. Strengths worth preserving

- **Tool protocol correctness.** Every `function_call` gets a `function_call_output`, even when rejected, at `server/harness.ts:111`. Reasoning items are echoed back with `store: false` and `include: ['reasoning.encrypted_content']` at `server/provider.ts:21-22`, and this is tested against a mocked transport at `tests/harness.test.ts:123-144`.
- **Approval gate.** Server-owned promise with unique ID, stale rejection, expiry, abort-listener cleanup, and denied-tool memory at `server/index.ts:66-72` and `server/harness.ts:65-77`. Writes are never retried.
- **Comparison isolation.** `structuredClone` of the snapshot at `server/harness.ts:25` and scoped writes at `:85-92`, with capacity and reservation checks before any variant launches at `server/index.ts:86-93`. Tested end to end at `tests/api.test.ts:84-112`.
- **Secret hygiene.** Sanitized provider errors, a test that asserts the key never appears, hosted mode never reads `.env`, Vite `fs.deny`, and production path denial.
- **Fail-closed hosting.** `server/access.ts:9-14` refuses to start without HTTPS origins and an owner ID, and mutations require an Origin header.
- **Teaching contracts as tests.** `tests/studio.test.ts` pins each experiment's expected observations, which guards the pedagogy against regressions in the simulator or presets.
- **Honest copy.** Character-not-token warnings, "A request is not an action," and "execution events, not private chain of thought" appear where the learner needs them.

## 6. Proposed next actions and review limitations

Next actions in priority order:

1. Add a `.catch()` at `server/index.ts:73` and make `event()` tolerate persistence errors. Add a test that a store failure ends one run as `failed` without affecting others.
2. Distinguish timeout from cancellation at `server/harness.ts:127` and add a short-deadline test.
3. Forward 4xx body-parser errors at `server/index.ts:108`.
4. Add a live-region announcement for approval pauses in the studio.
5. Verify H1 with one real API call and H2 in the Azure portal before relying on either.
6. Add the missing tests listed in section 4, starting with one-tool-per-turn and production static denial.

Limitations of this review:

- I did not execute tests, build, or run the app. The coordinating agent is doing that separately.
- I had no access to the deployed site, Azure configuration, credentials, `node_modules`, `public/`, or any `.env` file. Claims in `docs/azure-deployment-plan.md` about live behavior were treated as unverified prose.
- I could not confirm the current OpenAI strict-schema keyword list, so H1 remains a hypothesis.
- `docs/bluehost-deployment-plan.md` is marked superseded and references a different domain; I did not review it for correctness.
