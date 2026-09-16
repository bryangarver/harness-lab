# Harness Lab

A working, local teaching app that makes an agent harness visible. Read a short lesson, edit a scenario, change a control, and inspect what the harness actually does.

## Start

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open **http://localhost:3000**. The simulator works immediately, without credentials or model API calls. Fonts are bundled locally.

For the built app:

```sh
npm run build
npm start
```

`npm run dev` uses Vite for frontend hot reload. Restart it after changing server files. `npm start` runs the compiled JavaScript backend and serves the built frontend. To use another port, edit `PORT` in `.env` and restart, or run `PORT=3001 npm run dev`.

## Azure private preview

The hosted app uses Azure App Service on Linux, with Microsoft sign-in restricted to the owner. Its deployment runbook, domain setup, and update commands are kept outside this repository. The operational limits are summarized below.

`npm run release:azure` builds an allowlisted ZIP in `releases/`. It excludes `.env`, saved memories, run history, and local dependencies. Azure installs locked production dependencies. Hosted credentials come only from Azure environment variables; hosted mode never reads a local `.env` file.

Hosted mode requires `HARNESS_ALLOWED_ORIGINS` (comma-separated HTTPS origins), `HARNESS_OWNER_ID` (one Microsoft tenant object ID), and Azure App Service Authentication. The app checks Azure's platform authentication flag and injected owner identity on every protected request. Its data lives in `/home/harness-data`, outside release files. Keep one instance and one Node process.

The private preview permits 60 live runs per UTC day by default (`HARNESS_LIVE_DAILY_LIMIT`), counting each comparison column separately and reserving the entire batch before starting it. Reservations survive restart and are not refunded for cancellations or errors. This is a run limit, not a dollar spending cap. Simulator runs do not count. Hosted mutations are limited to 120 requests per minute; reading results is unaffected.

## Connect GPT-5.6 Sol

Copy `.env.example` to `.env`. The file is gitignored.

1. Open `.env` in your editor.
2. Paste your key after `OPENAI_API_KEY=` and save it.
3. In the app, open the connection panel at the top right and click **Refresh connection**.
4. Choose **Live OpenAI** and run an experiment.

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-5.6-sol
PORT=3000
```

The API key stays on the server. It is never returned by an endpoint, placed in browser storage, or included in a trace. The server rereads `.env` for each live request, so adding a key does not require a restart. Refreshing the connection checks configuration only; an actual live run verifies API access. No fallback silently replaces the selected model or substitutes simulated output.

Live mode sends your prompt, instructions, included context, selected memories, and tool results to OpenAI. It uses the Responses API with `store: false`. Account access and API credits are required. The app has local execution limits, not an account-wide spending limit.

## Experiment Studio: compare in one run

Open **http://localhost:3000/studio** for the alternate experience, or use **Experiment studio** in the field guide header. The original lesson-based design remains at `/`.

1. Choose one of ten experiments. Each starts with a shared scenario and two or three contrasting harness configurations.
2. Compare the configuration table: each column is one version of the same agent. Switch features **On** to include them or **Off** to exclude them. Shaded rows identify differences; the selected experiment’s control appears first. Add or remove columns to compare **2–4 versions**. The supplied settings are ready to run unchanged. Expand **Additional settings** once to compare context limits, output limits, instructions, and answer checks across every version in the same table. Its summary flags differences even while collapsed.
3. Click **Run comparison** once. All versions start concurrently, and the view moves to their observed behavior directly below the configurations. Flip one feature and run again to see its impact.
4. Read the explanation, then optionally open **Inspect execution** for diagrams and events. Predictions, additional settings, reflection, saving, and export remain optional.
5. On **Make it remember**, use **Teach a fact** and approve the write before comparing recall with memory off and on.

`POST /api/comparisons` accepts one prompt/context and 2–4 labeled configurations using the same provider. It checks capacity before starting any variant. All variants receive independent copies of the same saved-memory snapshot. Comparison memory writes remain local to that variant; **Teach a fact** uses an ordinary persistent run. Notes remain local run artifacts. Each live column is a separate OpenAI run and incurs its own usage.

The studio restores the current comparison after a refresh. Its notebook stores run references and reflections in browser storage; server history retains only the latest 30 runs, so export JSON to preserve evidence permanently. On narrow screens the columns scroll horizontally while the rest of the page fits the screen. Live outcomes can vary even when only one setting changes.

## A five-minute field guide tour

1. **The agent loop:** Run `Calculate 24 * 7`. Inspect the request, tool result, and final answer. Set the maximum turns to 1 and compare.
2. **Persistent memory:** Run `Remember that I prefer concise answers with one example.` Approve it. Click **Try recall** and run again. Disable memory and repeat; the saved fact is no longer supplied.
3. **Permissions:** Ask `Create a note: Review the launch checklist.` Deny the proposed write, then rerun and approve it. Inspect the result.
4. **Errors & recovery:** Inject the calculator failure. Compare safe retries on and off.
5. **Your scenario:** Choose Live OpenAI and enter an open-ended task. Paste supporting context, change instructions, and inspect the trace. Pin a result to compare it with another run.

Every experiment starts with fresh conversation history. Persistent memory is intentionally the bridge between runs. Editing a scenario does not add a chat follow-up to a previous run.

## What the lessons cover

| Concept | Experiment |
| --- | --- |
| Agent loop | Observe model → tool → result → model → answer |
| Instructions | Change formatting, role, or priorities |
| Tools & actions | Enable or disable the calculator and note tool |
| Context | Trim a brief and observe a missing fact |
| Persistent memory | Save, recall, disable, and forget facts |
| Knowledge retrieval | Search bundled policy documents and inspect sources |
| Planning | Record a plan and measure its extra turn |
| Permissions | Approve or deny an exact write before it executes |
| Budgets & stopping | Limit turns/output or cancel a run |
| Errors & recovery | Inject a temporary failure and toggle a bounded retry |
| Evaluation | Assert that a completed answer contains expected text |
| Traces & state | Inspect events, compare runs, revisit history, export JSON |

Lessons explain the mechanism, key terms, behavioral impact, a concrete experiment, and expandable implementation details.

## The simulator is intentionally limited

The simulator is a deterministic, scripted replacement for the model. **The harness, approval gates, calculator, document search, memory persistence, evaluator, and trace recording are real.** Switching to live mode swaps the provider while preserving the execution path.

Recognized simulator requests include:

- `Calculate (180 * 3) + (45 * 2).`
- `Remember that I prefer short answers.`
- `What do you remember about my preferences?`
- `What is the hotel budget in the travel policy?`
- `Create a note: Check the launch plan.`
- `What codeword appears in the extra context?`

The simulator supports uppercase and bullet-point instruction experiments. It cannot interpret arbitrary tasks or demonstrate the full range of LLM behavior. It explicitly explains this when a request does not match a supported pattern. Live OpenAI accepts freeform scenarios but can only take actions using the included tools.

## How the code fits together

```text
React UI → POST /api/runs → server-owned run
                              │
                  assemble instructions + context + memory
                              │
                       model / simulator ←─────────────┐
                              │                        │
                       validate tool call              │
                              │                        │
                    require approval for writes        │
                              │                        │
                         execute tool ─── tool result ─┘
                              │
                    answer / limit / error / cancel

Every execution event → local checkpoint → polling UI + saved history
```

| File | Responsibility |
| --- | --- |
| `server/harness.ts` | The agent loop, context assembly, permissions, retries, budgets, evaluation, and trace events |
| `server/provider.ts` | OpenAI Responses API adapter and scripted simulator |
| `server/tools.ts` | Strict tool schemas, safe arithmetic parser, and bundled document search |
| `server/store.ts` | Atomic local persistence, with isolated memory stores per mode |
| `server/index.ts` | Local HTTP server, run lifecycle, approval/cancel endpoints, and frontend serving |
| `server/schema.ts` | Input bounds and shared types |
| `src/lessons.ts` | Educational content, examples, and control presets |
| `src/App.tsx` | Original field guide, controls, trace, pinned comparison, and data panels |
| `src/studio/Studio.tsx` | Shared scenario, concurrent variants, memory preparation, and notebook |
| `src/studio/ConfigurationTable.tsx` | Side-by-side feature switches, highlighted differences, budgets, and aligned results |
| `src/studio/VariantColumn.tsx` | Observed behavior, run-setting snapshot, approval, and optional execution inspection |
| `src/studio/experiments.ts` | Ten comparison experiments and evidence-based observations |

The live adapter preserves all model output items, including encrypted reasoning state, across tool turns. It matches each function output to its `call_id`. Private reasoning and credentials are not included in the visible trace.

### Included tools

- `calculate`: a small arithmetic parser supporting numbers, parentheses, `+`, `-`, `*`, `/`, and `%`. No code evaluation or shell.
- `search_knowledge`: keyword-ranked search over travel, launch, and support documents. Edit the `knowledge` array in `server/tools.ts` to add your own documents, then restart the server.
- `save_memory`: persists a fact to the selected mode’s store. Available when memory is enabled.
- `create_note`: stores a structured note **inside the run trace**. It does not send a message or create arbitrary files.
- `make_plan`: records a visible list of intended actions. It does not execute those actions itself.

To add a tool, extend its Zod schema, description and availability in `server/tools.ts`, add its execution branch in `server/harness.ts`, and classify any write for approval. Add tests for the permission boundary. For simulator support, explicitly add a matching pattern in `server/provider.ts`.

## Local state and limits

- `data/memory-simulator.json` and `data/memory-live.json`: separate memory stores; 100 facts maximum, latest 20 supplied per run, each at most 1,000 characters.
- `data/runs.json`: latest 30 runs, checkpointed after every event. Includes prompts, context snapshots, memories used, and results. Exports contain the same application data.
- `data/` and `.env` are excluded by `.gitignore` and blocked from direct development-server file access.
- Forgetting a memory removes it from future runs. Existing traces retain their historical snapshots.
- A server restart marks in-flight runs stopped. It does **not** replay writes or resume execution automatically.
- Run limits: 1–10 model turns, 256–4,096 output tokens per model request, a five-minute deadline, up to four active runs. Approval expires after two minutes.
- Safe retries: one retry for the injected read-only calculator failure; at most one OpenAI SDK retry for transient provider errors. Writes are not automatically retried. SDK retries may add HTTP attempts within one model turn.
- Cancellation stops future work. Completed writes remain. Provider charges may still apply to already submitted requests; failed requests may not report token usage.
- The extra-context control counts **characters**, not tokens, and trims only that field. It is a teaching mechanism, not a full tokenizer or production context compactor.
- Evaluation is an explicit, case-insensitive substring check on a completed answer. It is not a general quality, factuality, or safety metric.

Local mode binds to `127.0.0.1` with host/origin checks. Azure mode binds to its assigned port and requires the owner's Microsoft sign-in. Both modes remain single-user: do not broaden the owner restriction without adding user isolation. JSON persistence assumes one server process per data directory. Other production patterns—vector memory, semantic compaction, workflow engines, sandboxed code tools, multi-agent delegation, reusable skills, and large evaluation suites—can be built around the same boundaries but are not implemented here.

## Verification

```sh
npm run check
```

Runs TypeScript checks, a production build, and 40 automated tests covering the loop, calculator, schemas, budgets, memory, approvals/denials/expiry, cancellation, retrieval, planning, retries, evaluations, the HTTP endpoints, secret-file access, the OpenAI SDK tool-call protocol, comparison isolation and capacity, all ten studio teaching scenarios, hosted owner/origin checks, and persistent daily run reservations.

Tests use temporary isolated stores and a mocked OpenAI transport; they require no real credentials and make no paid model calls. An actual GPT-5.6 Sol request must be verified after you add your key. Browser verification also covers the desktop/mobile interface, running an experiment, approvals, and memory recall.

## Official API references

- [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [Function calling and the tool loop](https://developers.openai.com/api/docs/guides/function-calling)
- [Responses API](https://developers.openai.com/api/docs/guides/text)

Model ID and tool-calling support were checked against the official documentation during implementation.
