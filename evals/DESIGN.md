# Documentation evaluation design

Automation tool evaluation often asks: did the model call the correct action with
correct arguments? Documentation correctness spans several independent failure points:

```text
user question -> documentation tool selection -> query generation
              -> retrieval -> answer synthesis

Level 1: code-level deterministic tests (indexing, chunking, tools, schemas)
    ↓
Level 2: known query -> production retriever -> expected sources/evidence
    ↓
Level 3: natural-language question -> model-generated query -> retrieval (future)
    ↓
Level 4: retrieved evidence -> final answer; correctness/groundedness (future)
    ↓
Level 5: Codex/other MCP client -> Appium MCP -> documentation plugin (future)
```

This change implements Levels 1–2. Failures at later stages must remain attributable
to those stages; a retrieval regression should not be hidden by query rewriting.

## Ownership and dimensions

| Dimension | Question | Primary owner |
| --- | --- | --- |
| Tool routing | Did the caller choose the correct documentation capability? | `appium-mcp`: cross-tool routing and behavioral trajectories |
| Query quality | Does the query preserve the user's information need? Equivalent queries are valid. | `appium-mcp-documentation` |
| Retrieval correctness | Are expected sources, sections, and fact-bearing chunks present at useful ranks? | `appium-mcp-documentation` |
| Answer correctness | Does the answer contain expected information without incorrect claims? | `appium-mcp-documentation` |
| Groundedness | Does retrieved evidence support the answer? | `appium-mcp-documentation` |
| Real client compatibility | Does the complete client/MCP/plugin interaction work? | `appium-mcp` |
| Efficiency | How many calls, bytes, milliseconds, tokens, and dollars were used? | Observe per layer; initially no hard gates |

Keep documentation facts and golden cases here. Integration tests in `appium-mcp`
should reference case IDs or consume this dataset, not duplicate golden answers.

## Existing implementation and scope

`src/scripts/eval-documentation-rag.ts` already called `queryVectorStore` directly.
It measured normalized verbatim evidence-span recall, any-span hit@1/3/5/10,
content MRR, spans per thousand characters, and diagnostic file hits@5/10.
Its `fileRecall` fields were binary any-source hits, **not** multi-document recall.
It did not measure answer correctness, groundedness, query generation, or latency.

We retain that baseline and command. `answerAppiumQuery` uses the same retriever
(default 25 chunks), then formats chunks for the caller's LLM. The registered
`appium_documentation_query` tool validates its query and retries initialization
on error. Level 1 covers implementation; Level 2 bypasses tool routing and that
wrapper, using an explicit context budget (default 10). `reasoning-rag.ts` has
separate local summarization/QA models; the registered tool and this eval do not
invoke them. No LLM judge or API credential is needed for Level 2.

## Golden dataset contract

`src/scripts/rag-eval-dataset.json` version 2 is validated by the existing Zod
dependency in `rag-eval-checks.ts`. IDs are unique and arrays/strings are validated
before retrieval. Existing IDs and fixed queries are retained for comparison.

| Field | Meaning |
| --- | --- |
| `id` | Stable case ID |
| `question` | User information need, available to future model-driven evals |
| `query` | Fixed Level 2 input; may be identical to the question; never generated at runtime |
| `expectedSources` | Nonempty list of acceptable authoritative source alternatives; one suffices |
| `answerSpans` | Optional any-of evidence markers, preserving the original diagnostic semantics |
| `requiredFacts` | Optional all-of short verbatim fact markers; each must occur within a chunk from an expected source |
| `difficulty`, `category` | Difficulty grouping and optional topic |

For example, `q01` requires `npm install -g appium` in the installation source;
`q39` requires `mobile: tap` in an expected iOS source. Spans `x`/`y` were removed
from q39, and generic fallback markers were removed from q15/q27/q35/q42.
The UiAutomator2 README paths in q08/q34/q38 were corrected against the checked-in
index. q30 now targets the video recording command reference and real command
names, replacing an audio-capture source and nonexistent `mobile:` command names. These
changes intentionally make dataset v2 stricter; do not compare scores across
versions without accounting for the changed markers.

Both marker types lowercase and collapse whitespace before substring matching
within **individual chunks**, never across chunk boundaries. Formatting or wording
changes can require dataset maintenance. `requiredFacts` denotes evidence presence,
not semantic truth or answer grading. Legacy markers such as capability names may
be broad and can match unrelated sources. Source checks and stricter fact markers
help expose that limitation; they do not eliminate the need for future semantic
review. Prefer a distinctive section heading or short factual phrase over a generic
word, single letter, or large expected-answer string. Review changed markers against
the indexed corpus; do not weaken them just to make retrieval pass.

Source comparison accepts an exact path or a suffix at a path boundary, normalizing
path separators. Missing source metadata retains its original retrieval rank.
An empty result fails source expectations. Source-only cases may omit both marker
arrays; required facts and legacy evidence spans have independent semantics.

## Metrics and failure reports

The JSON report preserves legacy metrics and adds explicit evidence checks:

- `sourceHit` per case and mean `sourceHitRate`: any acceptable source in top-k.
  `sourceFirstHitRank` and `matchedSources` explain the hit. Alternatives are not
  all mandatory, so multi-source Recall@k would be misleading here.
- `answerSpanRecall`: fraction of supplied markers found in top-k; aggregate is
  macro-averaged over cases declaring markers. `hitAnyAt1/3/5/10` and `mrr` retain
  content-based any-span semantics. Omitted markers are not scored as evidence failures.
- `fileRecallAt5/10`: legacy names for any-source hits; rank cutoffs use original
  chunks, including those without source metadata. Fixed cutoffs larger than the
  requested budget are `null` (N/A), not falsely reported as measured.
- `requiredFactsPresent` (null when not applicable), `requiredFactsMissing`, and
  individual failure reasons. All declared facts are required in expected sources.
- `contextEfficiency`: spans per thousand characters, averaged over cases with
  evidence hits within the requested budget. This is diagnostic, not a quality score.
- `latencyMs` and `averageLatencyMs`: wall-clock retrieval only. The first query
  includes model/index initialization; this is a cold-inclusive average, not a
  warmed latency benchmark. Other cases reuse the in-memory store.
- `topKChunks`, `topKChars`, `uniqueFiles`, `payloadBytes`, `averagePayloadBytes`:
  bytes measure UTF-8 serialized returned documents including metadata, not MCP
  wire bytes or tokens. Exactly one retrieval call is made per case.

No composite quality score or performance gate is introduced. A case fails when no
expected source appears, no declared legacy evidence marker appears, or a required
fact is missing. Reports show the case ID, question, missing expectations, and
actual retrieved sources, including with `--quiet`. Execution errors name the case.

## Running and CI

```bash
npm test                           # Level 1: implementation and evaluator unit tests
npm run build
npm run eval-docs                   # Level 2: observational report
npm run eval-docs -- --strict       # Exit 1 on quality failures, after saving report
npm run eval-docs -- --top-k=5 --label=experiment --no-save
npm run lint
npm run format:check
```

Reports are saved in ignored `src/scripts/eval-results/`: timestamped JSON,
`<label>-latest.json`, and `latest.json`. Labels permit letters, digits, underscores,
and hyphens. `--quiet` suppresses per-case success output/table, but not failures or
summaries. Default report mode retains exit 0 for completed runs even with quality
misses; execution/schema/argument errors always exit 1. Use `--strict` for a gate.

The checked-in `src/uploads/documents.json` is copied by the build. Retrieval uses
local `Xenova/bge-small-en-v1.5` embeddings (or `SENTENCE_TRANSFORMERS_MODEL`).
Credential-free is not necessarily offline: the first run can download public model
weights and embed the corpus. Later runs use local model and fingerprinted embedding
caches. `npm test` rebuilds `dist`, so run it before generating a cache there. To
rebuild the corpus, initialize documentation submodules and run `npm run index-docs`;
review corpus/dataset changes together rather than fetching moving docs in CI.

Required CI should continue running unit tests. A required Level 2 `--strict` job
is appropriate only once the golden expectations pass, corpus and embedding model
assets are pinned/cached, and measured runtime is reasonable. Record repository
revision, dataset version, model (also in the JSON), corpus/cache identity, and top-k
when comparing runs. No new required CI job is introduced here.

Saved reports include `datasetSha256` and `corpusSha256`: SHA-256 of the raw bytes
of the dataset and built `dist/uploads/documents.json` actually used by the run.
These distinguish same-version edits and stale build assets; even whitespace
changes alter the hashes. Inputs must remain unchanged during a run. Hashes do
not pin model weights or identify the runtime, so equal hashes alone are not a
complete reproducibility guarantee. Compare model, top-k, and code revision too.

Level 1 CLI regression tests run the compiled evaluator in an isolated temporary
package with a fixed retriever fixture. They cover strict/report-only exit codes,
failure output, report persistence, `--no-save`, input hashes, invalid arguments,
retrieval errors, and unmeasured cutoffs. They do not download a model or measure
retrieval quality; `npm run eval-docs` still exercises the production retriever.

Keep future model-generated queries, answer/groundedness checks, model matrices,
cost comparisons, and real-client runs scheduled or non-blocking initially.

## Future Levels 3–5

Level 3 reuses `question -> model -> generated query -> retriever -> expected source`.
Judge information-need preservation and retrieved evidence, never exact generated
query text. Track semantic query relevance where deterministic retrieval outcomes
are insufficient, retrieval quality, and redundant query count. Keep generated queries
and traces so a failure can be reproduced directly at Level 2.

Level 4 isolates `question + retrieved evidence -> model answer`. Check stable
required facts, forbidden/incorrect claims, citation/source consistency, and support
in retrieved chunks. Deterministic checks come first; semantic/LLM graders handle
cases that cannot be adequately expressed that way. Level 2 fact hits alone do not
prove an answer is correct or grounded.

Level 5 runs real clients such as Codex through Appium MCP and this plugin, testing
tool selection, generated arguments, and end-to-end outcomes. It belongs at the
integration boundary, with no Codex CLI dependency in `eval-docs`.

When a model is involved, record input/output/total tokens, tool/retrieval payload
size, calls, latency, and cost. Compare token usage with a baseline for the same
model and task, not one universal threshold. Level 2 does not invent token accounting.

## Frameworks considered

- **Existing custom RAG eval (selected):** already integrated, understands the
  production document shape, adds no framework dependency, and stays credential-free.
- **[mcp-eval](https://github.com/lastmile-ai/mcp-eval):** tool selection, arguments,
  redundant-call trajectories, and OpenTelemetry-backed agent execution. Better
  suited to `appium-mcp` behavioral/client tests than core retrieval scoring.
- **[DeepEval](https://deepeval.com/docs/metrics-faithfulness):** likely Level 3/4
  candidate for semantic query/answer quality and faithfulness. Do not add it merely
  to duplicate source assertions.
- **[Promptfoo](https://www.promptfoo.dev/docs/configuration/guide/):** prompt/model
  matrices and CI-oriented LLM comparisons; unnecessary for this retrieval baseline.
- **[Braintrust](https://www.braintrust.dev/docs)** / **[LangSmith](https://docs.langchain.com/langsmith/evaluation):**
  consider when experiment tracking, trace comparison, cost/token dashboards, or
  large qualification datasets justify extra infrastructure.
- **[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):** useful
  for manually verifying the MCP tool surface; does not provide our retrieval rubric.
- **Codex CLI / real clients:** Level 5 integration runners, kept separate from Level 2.

The next increment is to review current retrieval misses and replace broad evidence
markers with distinctive source-scoped facts, then establish a reproducible CI baseline
before adding model-driven evaluation.

See [the baseline review](BASELINE.md) for the current seven misses, identified
input hashes, observed source/evidence ranks, and follow-up investigations. This
review does not exempt failures or lower the strict checks.
