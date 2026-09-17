# Harness Lab agent instructions

Harness Lab is a local teaching app that makes an agent harness visible. `src/` holds a React field guide and an experiment studio, `server/` holds an Express server that owns the agent loop, and a scripted simulator lets everything run without credentials. Read `README.md` for the product walkthrough and `PRODUCT.md` for the design principles.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server with Vite hot reload. Restart after server changes. | `npm run dev` |
| Type check, frontend build, server build | `npm run build` |
| Tests. Isolated temp stores, mocked OpenAI transport, no key needed. | `npm test` |
| Everything CI runs | `npm run check` |

Node 24 is pinned in `.nvmrc`; the app itself requires 22 or newer. The simulator and the test suite need no API key. Do not add a real `OPENAI_API_KEY` to run them.

## Open work

Start from the prioritized findings in `docs/reviews/2026-09-16-claude-fable-review.md`. Still open as of 2026-09-16:

- [ ] F1. A storage write failure during a run becomes an unhandled rejection. `server/index.ts` starts `executeRun` with no `.catch()`, and `event()` in `server/harness.ts` calls `store.saveRun` unguarded. End the affected run as `failed`, keep other runs alive, and add a test.
- [ ] F2. The five-minute run timeout is reported as a user cancellation because `server/harness.ts` maps every aborted signal to `cancelled`. Inspect `signal.reason` and emit a `limit` event with status `stopped` for the timeout case.
- [ ] F3. Malformed or oversized JSON bodies return 500 because the error handler in `server/index.ts` only special-cases `ZodError`. Forward 4xx errors from the body parser.
- [ ] `calculate('1 + . + 2')` returns 3. `server/tools.ts` lets a lone period through the character check and the tokenizer then skips it. Reject any expression where tokenization does not consume every non-whitespace character.

## Invariants

Do not change these without discussing them first.

- The OpenAI key never leaves the server. No endpoint returns it, it is never written to a trace or run JSON, and provider errors are sanitized. `tests/harness.test.ts` asserts this.
- Hosted mode never reads `.env`. Credentials come only from environment variables. See `server/environment.ts`.
- Hosted mode fails closed. Startup throws without HTTPS `HARNESS_ALLOWED_ORIGINS` and a `HARNESS_OWNER_ID`, and every hosted request must carry Azure's owner identity headers. See `server/access.ts`. The only public paths are `/healthz`, the landing page at `/`, and `/robots.txt`; they are registered before the access middleware in `server/index.ts`, excluded from App Service authentication, and must stay static with no app data.
- The calculator is a hand-written parser. Never introduce `eval`, `Function`, or shell execution.
- Approvals are server-owned: a unique ID per approval, stale IDs rejected with 409, a two-minute expiry, and writes are never retried automatically.
- Comparison variants receive a `structuredClone` of the memory snapshot. Their memory writes must never reach the persistent store.
- Every `function_call` from the model gets a matching `function_call_output`, including rejected ones. Reasoning items are echoed back and requests use `store: false`.

## Conventions

- `server/schema.ts` is the single source of types and Zod validation for both server and client. The frontend imports its types from there. Change shapes there first.
- Routes: `/` is the public landing page rendered from `server/landing.ts`, `/guide` is the field guide, and `/studio` is the experiment studio. `src/main.tsx` renders the studio for `/studio` and the field guide for every other path.
- Persistence is synchronous atomic JSON writes in `server/store.ts`, one process per data directory. Do not add a second process or worker without redesigning storage.
- Existing JSX is dense, with long single-line elements. Match the surrounding style in a file rather than reformatting it.
- Tests use `node:test` through `tsx --test tests/*.test.ts`, temporary directories, and a mocked `fetch` for OpenAI. New behaviour needs a test. `tests/studio.test.ts` pins what each teaching experiment must demonstrate.
- Adding a tool means a Zod schema and description in `server/tools.ts`, an execution branch in `server/harness.ts`, approval classification if it writes, and a matching pattern in the simulator in `server/provider.ts`.

## Data and secrets

- `data/` holds `runs.json` with the latest 30 runs, `memory-simulator.json`, `memory-live.json`, and the hosted `live-usage.json`. It is gitignored and blocked from dev-server file access.
- `.env` is gitignored. `.env.example` documents the variables.
- `private/` is gitignored and holds the owner's deployment runbooks and Azure scripts. Do not reference it from tracked files.
- `npm run release:azure` builds an allowlisted ZIP in `releases/`, which is gitignored.
