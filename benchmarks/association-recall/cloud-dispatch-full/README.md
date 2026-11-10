# Cloud dispatch comparison across 12 frozen tasks

The owning ValkyrAI HTTP runtime ran all 12 assigned tasks as a real organization MEMBER in an isolated H2 tenant. It used the frozen consumer, SQLite judge, two warmups, seven measured repetitions and 1,024-byte final evidence budget. Each case was assigned to both arms. The repeated trials measure stability within a task.

| Baseline arm | Correct tasks | Available tasks | Unsupported actions |
| --- | ---: | ---: | ---: |
| One source through ENTITY discovery and target read | 0/12 | 0/12 | 0 |
| Paired endpoints through PATH discovery and Bifrost | 8/12 | 9/12 | 0 |

Three anchors of 258, 258 and 261 characters exceeded the actual 255-character filename column. The inserts failed with SQLState 22001, and all three cases stayed in both denominators. The remaining direct case requires an action but has no typed relationship, so the paired arm withheld it. The eight other enrolled paired cases returned the expected action or abstention. The source-only arm received a graph provider error on all nine enrolled cases because the planner required two evidence items in a one-node traversal. Its zero therefore measures availability and cannot establish a retrieval quality advantage. Both targeted READ and MERGE revocation controls denied access to the previously measured receipt and page. [Baseline evidence](observations/baseline-evidence.json) · [Task outcomes](observations/baseline-results.json)

The first run also found a fixture ownership error. ThorAPI used the authenticated auditor to set owner IDs, causing eight enrollment failures. The repaired fixture persisted each detail as the peer principal and each anchor as the requester in the same tenant transaction. The failed capture is retained, and the repaired baseline kept the original product, task mapping, request bounds and scoring inputs. [Original failed run](observations/initial-failed-fixture-results.json) · [Fixture repair](peer-owner-fixture.patch)

## Installed lookup fixes

The exact traversal planner now bounds its configured evidence count by the node budget. The target-read operation resolves a generated entity from the authorized receipt before looking at its synthetic index ID. Existing source locators still resolve to the same receipt item, and the runtime applies the generated target's own access check. Both changes passed 82 owning tests, including a repeat of the complete frozen run. [Installation](../../../.vaix/verification/cloud-generated-source-read/installation.json) · [Candidate evidence](observations/candidate-evidence.json)

| Candidate arm | Correct tasks | Available tasks | Unsupported actions |
| --- | ---: | ---: | ---: |
| One source through ENTITY discovery and target read | 3/12 | 9/12 | 0 |
| Paired endpoints through PATH discovery and Bifrost | 8/12 | 9/12 | 0 |

All nine admitted single-source reads returned the correct anchor. The frozen consumer requires `ALLOW_ANSWER` for single-source action, and those nine receipts all returned `ALLOW_WITH_CAVEAT`. The paired arm accepts the specific typed-path caveat and requires both current endpoints. In a separate post hoc check, treating the single-source caveat as permission scored 4/12 and caused one unsupported action in the conflict case. The frozen results keep their original action gates. [Frozen candidate outcomes](observations/candidate-results.json) · [Caveat sensitivity](observations/source-caveat-sensitivity.json)

Across measured candidate trials that returned complete evidence, median and nearest-rank p95 elapsed times were **369 and 427 ms** for 63 single-source reads and **724 and 784 ms** for 42 paired reads. These are local pipeline timings. Paired trials include context compile and hydration, and the successful evidence sets differ between the arms. [Trial timings](observations/candidate-results.json)

## Reproduce

Apply the [test-only native patch](preparation/native-test.patch) and then the [fixture repair](peer-owner-fixture.patch) in the reviewed isolated owning reactor. The [preparation](preparation/README.md) includes the VAIX command and its three file properties. Use a fresh capture path and the same frozen task files.

To inspect the packaged baseline, run from this directory.

```sh
scratch=$(mktemp -d)
gzip -dc observations/baseline-capture.json.gz > "$scratch/capture.json"
python3 -B preparation/score.py --capture "$scratch/capture.json" \
  --frozen ../dispatch-task --out "$scratch/results.json"
python3 -B preparation/check.py --capture "$scratch/capture.json" \
  --frozen ../dispatch-task --results "$scratch/results.json" \
  --manifest preparation/manifest.json
```

The corpus stores synthetic text in generated domain records and uses a fixed owning FK. Native rival mappings differ. These observations are local and contain neither an OAuth call nor a promoted procedure.
