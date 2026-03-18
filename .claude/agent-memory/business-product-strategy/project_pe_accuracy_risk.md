---
name: PE Accuracy Risk — Commercial Consequences and Launch Threshold
description: Analysis of what happens if the PE misses accuracy targets — includes V4.4 results (54.9%) and what actually gates launch
type: project
---

**History:**
- Pre-V4.4: PE was at 50.7% (log_loss 1.0066, brier 0.5999) against a business plan target of 55%.
- V4.4 (2026-03-17): 54.9% walk-forward accuracy on ~806 matches (PD + PL + BL1), beating Pinnacle argmax (54.1%) by +0.8pp.

**Core conclusions (apply to all future accuracy discussions):**

1. The accuracy threshold that gates launch is NOT "does it beat 55%?" — the moat is an auditable, timestamped, growing track record. A competitor with 52% and a transparent log beats a competitor with 55% claimed but unverified.

2. The correct "good enough to launch and charge" test: predictions are calibrated (not systematically wrong), track record is honest, paywall is on depth (scorelines, xG, BTTS, per-team history) not on 1X2.

3. Track record publication threshold: ≥200 live forward-evaluated predictions per competition before displaying live accuracy (MVP spec §5.7, business plan §10.1). Walk-forward historical results can be shown earlier with mandatory disclosure.

4. Business plan §9.8 shows "~57% general" in the accuracy comparison table. This was a forward-looking target. V4.4 empirical result is ~55%. The table must be corrected before the accuracy page goes live.

5. PE Phase 5 (calibration improvements / V4 roadmap) remains deferred pending Decision Gate. V4.4 is sufficient for commercial launch.

**Why:** Recorded to prevent re-litigating accuracy as a blocking condition for commercial launch.

**How to apply:** When anyone proposes delaying Pro paywall launch until PE reaches a higher accuracy target, challenge the premise. When anyone references "57%" as a current claim, flag the correction needed in business plan §9.8.
