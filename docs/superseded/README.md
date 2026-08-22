# Superseded

Folded into `/PLAN.md` on 2026-08-22. Kept only so you can check what changed.
**Do not brief anyone from these.**

They contradict the current plan on three things that matter:

- **Review channel.** The bible says Telegram. An intermediate draft said Matrix. Neither
  is right. Human review is a local web console on 127.0.0.1, and the network policy is
  drop with no allowlist at all.
- **Tariff data.** They describe placeholder rates. The rates are real, read from a
  committed USITC export. See `docs/DATA_SWAP.md`.
- **Demo numbers.** They quote figures computed on a placeholder rate and on a fabricated
  Section 122 surcharge. Every number in `PLAN.md` is asserted by `scripts/smoke.sh`.

The lane files also predate the entry-level fee work (MPF and HMF) and predate the console
being built.
