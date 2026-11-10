# Cloud dispatch: body mapping (unexecuted)

This is a separate lossless-text mapping of the same twelve frozen tasks. It leaves the outbound benchmark and every prior observation unchanged. There are no native results for this variant yet.

Each complete anchor text is stored once in `ContentData.contentData`; each complete detail text is stored once in `ContentMediaLink.fileName`. All anchors are at most 261 characters and all details at most 206. Native enrollment reads the stored values back without reconstructing or truncating them. Both arms use the same rows and original query. The source-only arm discovers the body through query-only ENTITY and uses owning target-read. The treatment uses query-only INBOUND PATH, followed by owning paired endpoint compile and hydration.

The supplied anchor→detail association is represented by traversing the detail's owning `contentData` FK in reverse. The canonical path remains `ContentMediaLink.contentData.ContentData`. The two direct tasks have no supplied link and get no invented child, self-edge or fallback. Source-only actions still require ALLOW_ANSWER. Paired actions still require the existing typed-path caveat, a current receipt and successful paired hydration. A path claim does not certify the business facts; the unchanged consumer and SQLite judge handle them.

The text mapping is lossless; metadata equivalence is limited. ContentMediaLink has no tags relation. The two supplied `unresolved` tags and all free link labels are retained exactly in enrollment metadata, but are not inserted into source text, query, native policy or consumer input. No `supersedes` authority is invented. Conflicting original facts remain in their original text. The scorer verifies this mapping and disclosure.

The new body runtime separately caps each seed/child search at eight two-candidate pages, following effective-ACL continuation and refusing unresolved uniqueness; both arms use that same seed rule. The protocol keeps all 12 assignments, both arms, 2 warmups and 7 measured repetitions, a 1200 ms plan budget, 8 candidates, 1024-byte frozen consumer bound, and the original plan/action settings. Seven repetitions are repeated measurements, not seven new tasks. Setup errors, provider exceptions and selected-source target-read failures earn no abstention credit. Excluded sources are stored with effective object READ/MERGE denied. Native post-capture controls revoke authority on an actual measured receipt/page pair. ORM is used only to enroll the synthetic dataset, under the actual row author's identity; it is never an output fallback.

Prerequisites are the separately reviewed body-discovery product candidate and generated-entity source-read repair, qualified through normal canonical VAIX/AJC. Neither is simulated by this fixture. Query-body projection remains limited to 8,000 characters per field; all frozen texts fit, but larger general bodies need their own evaluation.

Apply `native-body-corpus.patch` only in the parent's isolated backend qualification checkout. It adds `CloudDispatchBodyCorpusJpaTest#allFrozenCasesThroughLosslessBodyMapping`. Supply these test properties to the normal canonical `./vaix mvn` test invocation:

```text
-Dgraymatter.dispatch.fixture=/absolute/GrayMatter/benchmarks/association-recall/dispatch-task/fixture.json
-Dgraymatter.dispatch.body.protocol=/absolute/body-variant/protocol.json
-Dgraymatter.dispatch.body.capture=/private/tmp/new-body-capture.json
```

The capture path must not exist. Retain the normal offline/loopback-only runtime and all authorization/provisioning gates. No JVM or database was launched during preparation.

After an actual capture:

```bash
python3 -B score.py --capture /private/tmp/new-body-capture.json --frozen /absolute/GrayMatter/benchmarks/association-recall/dispatch-task --out /private/tmp/new-body-results.json
python3 -B check.py --capture /private/tmp/new-body-capture.json --frozen /absolute/GrayMatter/benchmarks/association-recall/dispatch-task --results /private/tmp/new-body-results.json --manifest manifest.json
```

The 22 validator tests pass. Their adapted body envelopes are deliberately synthetic and are not persisted as benchmark observations. They exercise the mapping, same-query/budget/identity checks, full matrix, current source lineage, metadata disclosure, failed-read/provider unavailability and revocation receipt matching. The frozen consumer and judge are imported unchanged and their exact hashes are verified.

```bash
DISPATCH_FROZEN=/absolute/GrayMatter/benchmarks/association-recall/dispatch-task DISPATCH_PRIOR_NATIVE=/absolute/GrayMatter/benchmarks/association-recall/cloud-dispatch-query-discovery/native-capture.json python3 -B -m unittest -v test_score
```
