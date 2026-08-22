# Real tariff data: what changed and what to say about it

Every `mfn_rate` in this kit used to be a guess marked `PLACEHOLDER-verify-USITC`, and
`surcharges.json` invented the Section 301 rates. Both are now read from a USITC
Harmonized Tariff Schedule export (**2026 revision 7**, 35,496 rows).

Rebuild at any time:

```bash
node scripts/build_hts_from_usitc.mjs --archive engine/data/usitc/hts_2026_rev_7.json
```

Originals are kept beside the new files as `*.placeholder.bak`.

## Why the whole duty stack is sourceable from one public file

The USITC export carries both halves of the stack:

- The MFN rate sits in the line's `general` field (`"12.5%"`, `"Free"`).
- Section 301 membership is a footnote on the line (`"See 9903.88.03."`), and the
  Chapter 99 heading it points at states its own surcharge in plain text:
  `"The duty provided in the applicable subheading plus 25%"`.

So the surcharge is **read, not assumed**, and every one cites the heading that set it.
`surcharges.json` now carries an `authority_by_prefix` map for exactly this reason. When
a judge asks "where did 25% come from?", the answer is a Chapter 99 heading, not a
config file someone typed.

**The gotcha that eats an hour:** rates and footnotes live on the nearest *ancestor*
with a value. Read a 10-digit line on its own and `general` is almost always blank.
You have to walk the `indent` hierarchy. That is what `build_hts_from_usitc.mjs` does.

## Corrections the swap produced

**Rates.** 15 of the 16 curated lines had a correct placeholder. One did not:

| HTS | was | is | why |
|---|---|---|---|
| 9405.11.60.10 | 3.9% | **7.6%** | 3.9% is the rate on `9405.11.40` (of brass) and `9405.11.80` (other). `9405.11.60` is 7.6%. |

**Two codes did not exist.** They were not missing from the schedule, they were invalid
statistical suffixes:

| was | is | note |
|---|---|---|
| `4016.93.50.00` | `4016.93.50.50` | real suffixes are `.10` O-Rings / `.20` Oil seals / `.50` Other |
| `0306.17.00.40` | `0306.17.00.41` | real suffixes are `.41` Farmed / `.42` Not farmed |

Both appeared as `hts_declared` in samples 004 and 002, and both are fixed there too.

**Section 301: three real corrections.**

| prefix | placeholder | actual | authority |
|---|---|---|---|
| 8471 (laptops) | 0% | **25%** | 9903.88.03 |
| 4202 (bags) | 7.5% | **25%** | 9903.88.03 |
| 9503 (toys) | 7.5% | **none** | no Chapter 99 reference on the line |

The memo's worked example is `reclassify: 8471.30`, laptops. That line carries 25%
Section 301, which the placeholder table said was zero.

**Section 122 is disabled.** It was applying a flat 10% to every line. No `9903`
subchapter implementing a Trade Act of 1974 §122 balance-of-payments surcharge appears
anywhere in the 2026 rev 7 schedule, and §122 has no history of being invoked. Ten points
of fabricated duty on every memo is the fastest way to lose a customs broker's trust.
To restore it you need a citation to a live Chapter 99 heading:

```json
"section_122": { "enabled": true }
```

## Demo numbers moved, so update the pitch script

Sample 006, the precedent flip, with the corrected 9405 rate and §122 off:

| | cold | warm (precedent applied) |
|---|---|---|
| HTS | 8513.10.20.00 | 9405.11.60.10 |
| confidence | 0.60 | 0.95 |
| status | NEEDS_REVIEW | READY |
| rate | 37.5% (12.5 MFN + 25 §301) | 32.6% (7.6 MFN + 25 §301) |
| duty on $6,300 | **$2,362.50** | **$2,053.80** |

The swing is **$308.70**. Any earlier script quoting a $541.80 swing, a $2,450.70 warm
figure, or a $2,992.50 cold figure is stale. Those were computed on the placeholder 3.9%
rate and/or with the fabricated §122 surcharge still switched on.

These are the numbers the shipped config produces. Verified by running the sweep from a
clean extract of this zip.

## Open finding: sample 001 does not reach READY

`HACKATHON_BIBLE.md` §3.4 claims sample 001 → READY. It does not, and it did not before
the data swap either. Line 1 is:

> "Cast iron pump casing for centrifugal liquid pump, without engine"

The engine scores `8413.70.20.05` (a complete centrifugal pump) at 15 and
`8413.91.90.96` (parts of pumps) at 13 → confidence 0.54 → `LOW_CONFIDENCE`.

**The engine's second choice is the right one.** A casing is a part of a pump, not a pump.
The parts-vs-whole logic at `engine/triage.mjs:141-145` is already there and firing. The
problem is data, not logic: `8413.70.20.05` carries the keywords `liquid pump` and
`centrifugal pump`, both of which match a line describing a *casing for* a centrifugal
liquid pump, and the multi-token bonus (+4 each) outruns the halving penalty.

Two ways to close it, both a one-line change, both needing a full re-sweep afterwards:

1. Trim the greedy keywords on `8413.70.20.05` (drop `liquid pump`, keep `centrifugal pump`).
2. Strengthen the whole-machine penalty at `engine/triage.mjs:145` from `0.5` to about `0.35`.

Option 1 is narrower and cannot affect non-pump lines. Whoever owns the rules engine should
make this call early, because it changes the first beat of the demo, and it is the difference
between "the engine caught something a clerk would miss" and "the engine got it wrong but
hedged."

## Provenance

`engine/data/usitc/hts_2026_rev_7.json` is a Harmonized Tariff Schedule export published by
the U.S. International Trade Commission (hts.usitc.gov → Export). Public U.S. government
data. `hts_full.csv` (19,856 ten-digit lines) is derived from it by the build script, so the
pitch line "swap in the full USITC schedule" is already true rather than aspirational.

## Added since the swap: entry-level fees

`engine/triage.mjs:265` computes MPF and HMF on the ENTRY, not per line.

- **MPF** 0.3464% of the entry's total entered value, clamped to a per-entry minimum and
  maximum. Modelled at entry level deliberately: folding it into a per-line ad-valorem rate
  breaks the clamp on any multi-line entry and silently over-collects. Across the six
  samples the minimum clamp fires on four of them, so this is not a theoretical concern.
- **HMF** 0.125% of entered value, vessel shipments only, no minimum or maximum, keyed off
  the shipment's `mode` field. Not charged on air, truck or rail.

Both are reported as `shipment_summary.fees[]`, `estimated_fees` and
`estimated_total_payable`. `effective_rate` deliberately stays duty-only.

**The MPF minimum and maximum are reset every fiscal year by CBP.** The committed figures
are marked `VERIFY-CBP-FY2026` and must be confirmed before anyone quotes a number. The
0.3464% rate and the 0.125% HMF rate have both been stable for years.
