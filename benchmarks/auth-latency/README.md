# Authentication and receipt latency

Measured on November 6, 2026, on the same Apple M4 Pro development host.
The two alternating comparisons used the generated JARs pinned in
[artifacts.json](artifacts.json). At 1,024 owned memories, median receipt
inspection improved by roughly 8–10 times. Each table entry has 48 requests.

| Run | Eligible memories | Original p50 / p95, ms | Optimized p50 / p95, ms |
| --- | ---: | ---: | ---: |
| First | 8 | 122.690 / 250.720 | 14.621 / 30.973 |
| First | 1,024 | 129.202 / 198.377 | 15.041 / 49.500 |
| Second | 8 | 104.464 / 154.638 | 10.601 / 28.244 |
| Second | 1,024 | 103.399 / 156.602 | 11.763 / 21.276 |

For authenticated health, the median fell from 102–108 ms to 4–8 ms at
that scale. Source-scope verification remained enabled on every receipt
read. The measurements describe warm authentication for one account.
Other test processes were active on the shared host, so preserve the
individual runs when interpreting the tail times.

[First baseline](baseline-first.json) · [First optimized](optimized-first.json)
· [Second baseline](baseline-second.json) · [Second optimized](optimized-second.json)

This experiment measures the same current receipt under the original v4 Basic
authentication path and a candidate that reuses successful password checks.
Every request goes through HTTP authentication and the receipt freshness check.
The candidate reads the current account on each request.

The fixture is frozen before scoring the candidate. It reuses the earlier
inspection workload with 8 and 1,024 owner rows, an 8-row tag filter and a
filter matching all rows, and a receipt containing one source. The query,
source texts, concurrency, heap and processor count are the same in both builds.
Each route has 12 warmups followed by 48 measured requests in rotating order.
Anonymous health and authenticated health provide controls. A wrong password
must receive 401 before measurement.

The runner starts each JAR on loopback with a fresh temporary database and
credentials. Pass the expected artifact SHA-256 explicitly. It records
every elapsed time, the artifact, fixture and runner digests, runtime versions
and timestamps. Startup, source ingestion and context compilation precede timing.
The clock covers the HTTP call through the full response body.

```sh
node benchmarks/auth-latency/probe.cjs baseline /path/to/baseline.jar BASELINE_SHA256 > baseline.json
node benchmarks/auth-latency/probe.cjs optimized /path/to/optimized.jar OPTIMIZED_SHA256 > optimized.json
node benchmarks/auth-latency/check.cjs baseline.json optimized.json
```

Recompute all four saved observations with
`node benchmarks/auth-latency/check.cjs benchmarks/auth-latency/{baseline-first,optimized-first,baseline-second,optimized-second}.json`.

Rerun in alternating build order on the same host. Each observation is a local
loopback test with one active principal, fixed request credentials and warm
successful authentication. The cache's cold, expired and invalid-credential
behavior has separate correctness tests. These timings characterize the tested
memory requests and authentication path. A concurrent multi-user deployment
requires its own workload.

The process stores keyed proof digests and timestamps for at most 128
successful comparisons. Their authorization lifetime is 60 seconds. Idle
entries can remain until eviction or shutdown. Protecting this state relies
on process isolation. A complete heap snapshot containing both the key and
digests can support fast offline guesses against the cached comparisons.
The ordinary BCrypt verifier remains the stored account credential.
