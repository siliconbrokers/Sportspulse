---
name: PE V4.4 Commercial Evaluation — Accuracy vs Business Plan
description: Strategic conclusions from evaluating V4.4 walk-forward results (54.9%, 806 matches) against business plan commercial targets
type: project
---

V4.4 walk-forward backtest results (PD + PL + BL1, ~806 matches, 2025-26):
- Overall: 54.9% accuracy
- Pinnacle argmax benchmark: 54.1% (+0.8pp margin)
- Draw prediction: 20.2% prediction rate, 28.2% recall (~35% precision)
- Per-league: BL1=60.2%, PL=54.0%, PD=51.4%

**Verdict:** APPROVE WITH NARROWING — sufficient to monetize, but accuracy page requires corrected numbers.

**Key decisions reached:**

1. **54.9% is enough to launch commercially.** Business plan §7.2 explicitly says 52% with 200 audited matches beats any competitor in the Hispanic market. The paywall gates depth (scoreline, xG, confidence, per-team history), not the headline accuracy.

2. **Business plan §9.8 accuracy table is broken.** It shows "SportsPulse general ~57%" as a current reference. V4.4 empirical number is ~55%. That table must be corrected before the accuracy page goes live, or it creates a credibility trap.

3. **Do NOT lead with "+0.8pp over Pinnacle" as a headline.** Statistically fragile at 806 matches. Use the draw prediction story instead: "when we call a draw, we're right ~35% of the time — no competitor does this."

4. **Per-league breakdown is mandatory on the accuracy page.** PD at 51.4% cannot be hidden. Hiding it is the actual credibility risk. Showing it with context (comparison table) is fine.

5. **Walk-forward disclosure must be prominent UI copy, not a footnote.** The MVP spec §5.7 and business plan §10.3 both require it. "Evaluación walk-forward histórica — validación forward activa desde [fecha]."

6. **The real moat is still the live forward track record clock running now.** V4.4 accuracy at 54.9% is sufficient to start accumulating it. The ≥200 live predictions threshold (business plan §10.1 / MVP spec §5.7) gates public accuracy display per competition.

**Why:** Evaluated as part of the V4.4 milestone review, 2026-03-17.

**How to apply:** When anyone proposes delaying public predictions pending accuracy improvement, or suggests showing 57% as a current claim, or wants to hide per-league breakdown — reject based on these conclusions.
