# Retrieval baseline review

This is a diagnostic snapshot, not an accepted-failure list or a CI waiver.
It records the remaining misses without changing queries, expectations, or the
production retriever. All referenced case IDs live in the golden dataset.

## Comparison inputs

- Dataset version: 2; 42 cases; default top-k: 10.
- Embedding model: `Xenova/bge-small-en-v1.5`.
- Dataset SHA-256: `e0e0f5acdaeb3d5c6d5ddc2f4cb8593e4c35c0015870a4e3e15430a6ec04d0be`.
- Corpus SHA-256: `6fef80d82ed1c3011ca9dd0324599579c8802d02ffaf964e0eb955bcea89fbeb`.
- Observed source hit rate: 37/42 (88.1%); evidence hit@10: 40/42 (95.2%);
  content MRR: 0.714; combined checks: 35/42 pass, 7 fail.

The input hashes identify this snapshot; later reports with different hashes need
a new review. They do not pin downloaded model weights or the execution platform.

## Failure classification

The normal run retrieved ten chunks per case. A separate diagnostic query retrieved
up to 50 chunks for each failed case and located expected sources and markers in
those results. Ranks below are one-based. “Not in 50” does not mean absent from the
corpus: the corpus consistency test confirms the expected evidence exists.

| Case | Observation | Classification and next investigation |
| --- | --- | --- |
| q20 | Expected CI source first appears at rank 40; its evidence markers are not in the first 50 chunks from expected sources. Top results discuss general installation and Grid. | Source/evidence ranking issue under the current rubric. Also review scope: the question is general CI setup, but the expectation is XCUITest-specific. Consider an explicit iOS case and a separate general CI case. |
| q22 | Expected iOS lookup evidence appears at rank 19. Rank 1 is Android's “Element(s) Cannot be Found” troubleshooting section. | Expectation review candidate: the question does not identify an OS, so Android troubleshooting may be relevant. Review or split platform-specific information needs before treating this solely as poor retrieval. |
| q27 | An expected source appears at rank 5, but the `appium driver list` marker is not in its retrieved chunks even at 50. | Correct source, missing evidence chunk. Inspect chunk boundaries and ranking around the CLI list section. |
| q30 | Expected command reference appears at rank 1, but that chunk describes stopping recording. The required recording-start fact appears at rank 21. | Correct source, missing required section within budget. Investigate retrieval of start/stop operations together. A file hit alone would hide this failure. |
| q33 | An expected source appears at rank 13; evidence in expected sources first appears at rank 21. | Source/evidence ranking outside budget. Top results include signing capabilities and preinstalled WDA instructions; inspect their relevance against the troubleshooting need before proposing ranking changes. |
| q35 | Expected installation source appears at rank 15; its installation marker is not in the first 50 chunks from expected sources. A plugin-development page at rank 2 contains an installation command. | Source ranking and possible source-alternative review. Determine whether the development page adequately answers the user's installation need; do not add it merely to obtain a passing score. |
| q37 | Expected ecosystem source and its evidence first appear at rank 33; top results explain driver architecture/proxy mode. | Source/evidence ranking outside budget. Review ranking for named driver/provider queries. |

These classifications separate observed evidence from proposed follow-up work.
They do not establish that every retrieved alternative is wrong, or that increasing
k is an acceptable fix. Larger payloads have costs, and broad legacy markers still
require human interpretation.

## Rechecking

```bash
npm run build
npm run eval-docs -- --label=baseline
npm run eval-docs -- --top-k=50 --label=diagnostic
```

Compare the input hashes first. Use the default-budget report for the baseline;
the larger-budget run is diagnostic only. Reports expose expected-source ranks,
missing facts, and evidence coverage; locating the exact rank of a particular
fact requires inspecting the returned chunks directly.

The next change should resolve ambiguous question/source expectations through
review and then investigate the remaining ranking/section misses. Keep the strict
checks intact and keep retrieval CI observational until a reviewed, reproducible
baseline is ready to gate changes.
