# Fiat on-ramp on the Privy rail: supporting work for the hackathon demo

**Supporting package.** The submission's premise and main deliverables are the hook risk tool and
the Tools page, documented in [`docs/_hackathon_hookrisk/`](../_hackathon_hookrisk/). This package
records the on-ramp port that lets the demo account be funded without leaving the app.

> **Narrative status: placeholder.** The thought process below is the working version recorded while
> the code was ported (2026-09-13). The pitch, the event name and the evidence section are refined
> before submission. Everything that is a claim about the code is checkable today.

| File | What it holds |
|---|---|
| [`00_GOAL.md`](00_GOAL.md) | The goal statement, scope, the decisions taken and why |
| [`01_PRIVY_ONRAMP_FLOW.md`](01_PRIVY_ONRAMP_FLOW.md) | The end-to-end flow, module by module, with artifact IDs |
| [`02_DEMO_RUNBOOK.md`](02_DEMO_RUNBOOK.md) | How to run the demo against the dev API and a Privy dev app |
| [`03_PRE_EXISTING_VS_NEW.md`](03_PRE_EXISTING_VS_NEW.md) | What pre-dates the event, what was ported, what was written here |
| [`../../hookrisk/`](../../hookrisk/) | The companion tool: risk analysis and a full report for a Uniswap v4 hook |

## The pitch in one paragraph

An institution's treasury team should be able to put company funds to work in an on-chain strategy
the way they open any SaaS account: sign in with Google, pay with the company card, done. Today that
path is blocked by wallet setup, seed phrases, buying crypto on an exchange, bridging it to the right
chain and holding gas. This track removes every one of those steps with Privy: a Google sign-in mints
an embedded wallet, a fiat checkout funds it on Base, the provisioning gate turns that balance into
exactly what the strategy needs, and the investment settles. The user never sees a private key, a
chain switch or a token symbol they did not ask for.
