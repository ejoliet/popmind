# popmind — Import + Semantic Map Spike

> Proves that any browser's exported history file can be read in the browser and turned into a readable semantic map, entirely on-device.

## Overview

The weakest assumption in popmind was never the extension — it was whether **titles and hostnames alone carry enough signal** to cluster history into topics you'd recognise. Imported history has no page text, so if title-only clustering is mush, the whole file-import path (and with it the cross-browser story) collapses.

This spike attacks that assumption plus the two mechanical unknowns underneath it: schema detection across Chrome/Firefox/Safari, and whether the numeric pipeline runs fast enough in a browser tab to feel interactive.

Scope: import → embed → cluster → 2D map → streamgraph → trail drill-down. No extension, no capture, no storage.

## Files

| File | What it is | Verified |
|------|-----------|----------|
| `popmind-spike.html` | The spike. Single file, open in a browser. | Syntax + numeric core, not the CDN/WebGPU path |
| `validate.py` | Builds fake Chrome/Firefox/Safari history DBs, asserts detection + epoch math | ✅ passing |
| `core_test.mjs` | Runs the numeric core **sliced verbatim out of the HTML** through 22 assertions | ✅ 22/22 |
| `scale_probe.mjs` | Times kNN/layout/k-means at n = 1k…16k | ✅ ran |

## Quick Start

```bash
# 1. Prove the import path (no network needed)
python3 validate.py

# 2. Prove the numeric core
node core_test.mjs
node scale_probe.mjs

# 3. Run the real thing — needs network for sql.js + the MiniLM weights
python3 -m http.server 8080     # file:// blocks the module imports
open http://localhost:8080/popmind-spike.html
```

Then copy your own history file (the app prints the commands in its empty state):

```bash
cp ~/Library/Application\ Support/Google/Chrome/Default/History ~/Desktop/   # Chrome, macOS
cp ~/Library/Safari/History.db ~/Desktop/                                    # Safari
cp ~/.mozilla/firefox/*.default*/places.sqlite ~/                            # Firefox, Linux
```

> ⚠️ Copy the file, don't open the live one. Browsers hold a write lock, and sql.js reads a snapshot.

## What Is Proven

**Schema detection and epoch normalization.** All three flavours detected from `sqlite_master` alone. Chrome (µs since 1601), Firefox (PRTime µs since 1970) and Safari (seconds since 2001) all converge to Unix ms with **0 ms drift**, and the three normalize to byte-identical rows for identical logical history.

**Session reconstruction degrades gracefully.** Chrome and Firefox expose `from_visit`, so real trails are reconstructable. Safari has no chain — only redirect links — so it falls back to 30-minute inactivity gaps. Both branches tested, including a corrupted `from_visit` cycle that must not hang the tab.

**The numeric core is sound.** 22/22 assertions: no NaN anywhere, L2 normalization holds, k-means produces no empty or runaway field, kNN never returns self and stays sorted, the 2D layout stays bounded, and — the check that matters — **silhouette scored on scrambled labels returns −0.026**, so the quality metric isn't rigged.

**Local structure is good even with the weak lexical vectorizer.** Neighbour purity 85% against ground truth (chance = 17%), 2D between/within separation 1.49. That means the *map* is readable even in the control arm.

## What Is Not Proven

**A3 itself is still open.** Both offline proxies are floors, not answers:

| Method | Corpus | ARI vs truth | Note |
|--------|--------|--------------|------|
| word TF-IDF | 32 real titles | 0.23 | too few shared literal tokens |
| char 3-5 + LSA | 32 real titles | 0.61 | best sparse result |
| hashed char n-gram (shipped control) | 416 synthetic | 0.44 | global partition weaker than local kNN |

The characteristic lexical failure is visible in the spot check: *"PeerJS Documentation"* → nearest neighbour *"DAGs — Airflow Documentation"*. Shared boilerplate, unrelated topic. That is precisely the error embeddings exist to fix — **so run the app twice, MiniLM vs lexical, and read the silhouette delta.** That number is the real A3 answer.

**The browser-only path is untested here.** sql.js, transformers.js and WebGPU can't be reached from this sandbox. Failure modes are surfaced in the UI rather than swallowed, but first run is where you'll find out.

## Findings That Change the Design

**kNN is the wall, and it arrives early.** Exact kNN is O(n²), even after a Johnson–Lindenstrauss cut to 64 dims:

| pages | kNN | layout | total |
|------:|----:|-------:|------:|
| 1,000 | 0.3 s | 0.1 s | 1.7 s |
| 4,000 | 4.0 s | 0.3 s | 6.7 s |
| 8,000 | 15.3 s | 0.6 s | 19.7 s |
| 16,000 | 59.8 s | 1.1 s | 65.4 s |

Hence the 4,000 default cap, sampled by visit count rather than randomly — attention-weighted, so the map shows what you actually returned to. 8,000 is the practical ceiling before it feels broken. A real history of 50k+ pages needs approximate kNN (HNSW or RP-trees) and a Web Worker. That is the next gate, not a detail.

**Host tokens cluster well but label badly.** First run named fields `readthedocs · mozilla · ncbi` — true and useless. Hosts are now penalised 0.35× in labelling while still contributing to the vectors, which produced `kubectl · cluster · node` and `stronger · science · creatine` instead.

**Visit-to-page collapse is where the cost savings live.** Embedding unique URLs instead of visits is a large multiplier on real history — the exposure log prints your actual visits/page ratio, which is worth knowing before sizing anything.

## Gates

| Gate | Test | Kill condition |
|------|------|----------------|
| G1 import | Your own file loads, plausible span and page count | Schema unrecognised, or dates absurd |
| G2 signal | MiniLM silhouette meaningfully above lexical, fields you recognise | Fields are mush, or the delta is noise → titles aren't enough; import becomes URL-only and the extension carries the product |
| G3 usability | Clusters match your memory of your own months | Labels true but uninformative |
| G4 speed | 4k pages develop in under ~15 s in-browser | Needs Worker + approximate kNN before any demo |

G2 is the one that decides whether the file-import product exists.

## Next Steps

1. Run it on your real Chrome history. Note visits/page, silhouette for both emulsions, and whether the fields match your memory.
2. If G2 passes: swap exact kNN for approximate, move the pipeline into a Web Worker, lift the cap to full history.
3. If G2 fails: the import path still works for the streamgraph and calendar views (timestamps need no embeddings) — the semantic map moves behind the extension's full-text capture.
4. Either way, before anything ships: run `ship-check`, and confirm the manifest/network story is verifiable, since this reads the most sensitive file a person has.
