# Cloud dispatch with long-body discovery

The owning ValkyrAI runtime ran all 12 frozen dispatch tasks as an organization MEMBER in an isolated H2 tenant. Each complete anchor was stored in `ContentData.contentData` and read back byte-for-byte. Each detail used `ContentMediaLink.fileName`. This admitted the three anchors that exceeded the original 255-character filename column. The two arms used the same stored rows and original queries.

| Retrieval arm | Correct tasks | Available tasks | Unsupported actions |
| --- | ---: | ---: | ---: |
| Body ENTITY discovery and owning source read | 4/12 | 12/12 | 0 |
| Body INBOUND PATH discovery and Bifrost paired hydration | 10/12 | 12/12 | 0 |

Both arms kept the original consumer, SQLite judge, 1,024-byte evidence bound, two warmups, and seven measured repetitions. All 12 task outputs were stable within each arm. Paired evidence handled six action cases, both conflict cases, and both excluded-scope abstentions. The two direct cases required action from one complete anchor and had no relationship to traverse. Source-only retrieved every anchor, but its ordinary caveat withheld direct action under the frozen policy. [Task outcomes](observations/results.json)

Source-only returned complete evidence in 84 trials, with median and nearest-rank p95 elapsed times of 450 and 541 ms. Paired retrieval returned complete evidence in 56 trials, with median and p95 times of 852 and 953 ms. Paired timings include context compile and hydration. The two timing populations differ. Effective target READ denial and independent MERGE revocation each denied the same measured receipt and page. [Run evidence](observations/evidence.json) · [Independent check](observations/checked.json)

The source mapping preserves all original text and uses the generated owning FK. The two supplied unresolved tags and free relationship labels are retained in fixture metadata. The native policy receives neither signal. The result is a local comparison on synthetic tasks. Live OAuth, promoted execution, and head-to-head outcome and cost comparisons require separate runs. [Mapping and controls](preparation/README.md)

The public MCP adapter also replayed the 56 completed paired response sets with the captured plan clock. It verified the owning receipt GET, returned a caveated locator, and reproduced both hydrated endpoint projections. For the offline replay, the captured compile snapshot stands in for the pre-hydration page GET. The package's separate HTTP suite checks bearer forwarding and response handling. [Adapter replay](observations/public-adapter-replay.txt)

## Reproduce

The [test preparation](preparation/README.md) preserves the prereun inputs, including the owning VAIX test, exact test patch, and input paths. To replay scoring and authorization checks from this directory, unpack the synthetic capture into a disposable directory.

```sh
scratch=$(mktemp -d)
gzip -dc observations/native-capture.json.gz > "$scratch/capture.json"
python3 -B preparation/score.py --capture "$scratch/capture.json" \
  --frozen ../dispatch-task --out "$scratch/results.json"
python3 -B preparation/check.py --capture "$scratch/capture.json" \
  --frozen ../dispatch-task --results "$scratch/results.json" \
  --manifest preparation/manifest.json
cmp "$scratch/results.json" observations/results.json
node replay-public.cjs "$scratch/capture.json"
```
