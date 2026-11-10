# Cloud query-free dispatch diagnostic

Both native paths passed. Neither completed the frozen dispatch task: the Cloud tool flattened the target's `FACT` line into its prose snippet, and the unchanged consumer returned `insufficient` for all four evidence views. No unsupported dispatch packet was emitted.

This is a two-case internal backend diagnostic, not a complete agent-accessible Cloud benchmark. It uses the exact `query-free-1` and `query-free-2` inputs from [the frozen dispatch task](../dispatch-task/README.md). No rival run, original fixture, consumer, judge, or existing result was changed.

| Case | Native typed path | Target only | Source plus target |
|---|---|---|---|
| Garnet shipment | Current authorized receipt | Insufficient, 260 bytes | Insufficient, 483 bytes |
| Heron shipment | Current authorized receipt | Insufficient, 260 bytes | Insufficient, 480 bytes |

The fixed consumer requires a line beginning exactly `FACT `. The source query returns its original multiline `fileName`, but the target tool snippet contains `title: Packaging instruction. FACT {...}` on one line. `RetrievalContextAssembler.normalizeItemText` collapses whitespace before the Omega tool exposes the block as a snippet. The scorer passes those actual bytes unchanged; it does not rebuild the missing line from the fixture.

The native test performs this sequence for each original query:

1. An ordinary member with `FREE` and `GRAYMATTER_USER` roles searches the real generated `ContentMediaLinkService.findAllMatching` using the standard QBE parser: `fileName.$contains = originalQuery`, page 0, size 8. The query contains no source ID, target ID, shipment ID, or expected packet field.
2. The returned source supplies its original `fileName` and actual `contentData.id`. Only that returned relationship identity becomes the PATH target.
3. The owning HTTP plan and graph tool verify `ContentMediaLink.contentData.ContentData`, outbound, one hop, with the original query. The plan requests 8 candidates and 1,200 ms; the tool follows the issued limit of 3 results and uses a 6-node ceiling.
4. The owning receipt GET verifies the current proof. The source query is repeated to recheck access and unchanged source content before the explicit client union.
5. Offline, the unchanged consumer and independent SQLite judge evaluate target-only and source-plus-target views of the same captured native result. These are two views per native trial, not four independent retrieval runs.

The fixture stores literal bodies in `ContentMediaLink.fileName` and `ContentData.title`; both fit their real field limits. It seeds audited rows and explicit ACL grants through the existing native test setup. The target is peer-owned and grants the reader READ and MERGE. This typed FK and authorization are a stronger admission contract than the original free `packing note` association; the label itself supplies no authority. Only outbound startup email/research beans are suppressed. Persistence, tenant provisioning, source authorization, graph traversal, proof, HTTP handling, and receipt reload are real.

There are two distinct remaining boundaries:

- The generated source-list HTTP operation is CORE-only. The model supports tenant placement, and the internal ACL-filtered service query succeeds, but this test does not establish an ordinary tenant agent's public discovery entrypoint.
- The receipt grants `ALLOW_WITH_CAVEAT` with `typed_path_and_endpoint_projection_only`. It does not grant generic `ALLOW_ANSWER`, prove a multi-source packet, or preserve a line-oriented record through its snippet. A future lossless, currently authorized endpoint projection could address the output boundary; changing the frozen parser would change the task.

Canonical `./vaix mvn ... test-compile surefire:test@default-test` completed with **1/1 JUnit tests passing**, containing both native cases. The fixed task judge scores **0/2 completed packets** in each evidence view. JDK 17.0.20, AArch64 macOS, isolated H2 in MySQL mode, the normal VAIX JVM envelope, and a TCP-loopback-only OS sandbox were used. No model or hosted service was called. The 443 actual dependency JARs came from the sealed local Maven repository; startup-to-completion hashes agree. The qualification records exact class/source hashes, generated UUID-example differences, and the single build-refreshed derived `api-out.yaml` file.

Whole native pipeline time was 5,734.5 ms for the first case and 572.2 ms for the second; tool-reported time was 1,760 and 459 ms. The first tool wall time exceeds the requested 1,200 ms plan budget, which is not asserted here as an end-to-end deadline. Native credit fields report 0 actual and 0.75 estimated per tool call; these are not measured infrastructure costs. Offline consumer time is recorded separately. The final consumer bound remains 1,024 UTF-8 bytes and 16 sources. These single cold/warm observations do not support a speed comparison.

Verify the captured result without Java or services:

```bash
python3 benchmarks/association-recall/cloud-dispatch-query-free/check.py
```

For a fresh native run, first create an isolated copy of a canonical ValkyrAI reactor with matching source/resources and its already available private Maven cache. No host dependency installation is performed:

```bash
python3 benchmarks/association-recall/cloud-dispatch-query-free/run.py \
  --reactor /private/tmp/YOUR_ISOLATED_REACTOR \
  --maven-repo /private/tmp/YOUR_PINNED_MAVEN_CACHE
```

`run.py` refuses a non-temporary reactor and runs the mandatory canonical compilation/weaving path. The macOS sandbox launcher may require environment approval. It writes a fresh capture and log outside the repository. Re-score that capture with `score.py --capture FILE --frozen benchmarks/association-recall/dispatch-task --out NEW_FILE`. A fresh source revision is a new observation, not a replacement for these pinned results.

`native-capture.json` preserves the returned source fields, tool evidence, plan, exact receipt, and loaded class hashes. `results.json` contains the four replayable consumer outputs. `qualification.json` pins the canonical report/log, source boundaries, dependency bytes, and immutable frozen inputs. The planted identity map is used only to check citations after capture; it is never read by the retrieval path.
