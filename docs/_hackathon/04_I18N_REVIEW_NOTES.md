# Universal Funding, i18n sweep: glossary and native-review queue

**POO-1049 (UF-27) · artifact `PP-CORE-I18N-001` · epic POO-1022 · rules v1.**

The Universal Funding copy was written by several agents over two days, so it drifted the way copy
written in parallel always drifts: three surfaces (the funding-source selector, the cost breakdown,
the recovery banner) each grew their own tone, their own word for "your funds", and in de / nl / zh
their own second-person register, all inside one file. `pnpm i18n:check` was green throughout,
because parity and ICU were never the problem.

This file records what the sweep standardised on, and what it deliberately did **not** touch.
`tests/i18n-universal-funding.test.ts` enforces every rule below, so the next person to write this
copy inherits the constraints rather than the sentences.

---

## 1. The scope

96 keys, in two namespaces:

| Block | Surface |
|---|---|
| `swap.*` | the standalone /swap screen |
| `strategies.flow.error.kinds.wrongChain*`, `.gasBlocked*` | the two funding-rail error kinds |
| `strategies.provisioning.gasVerdict.*` | the gas classifier's verdict and escapes |
| `strategies.provisioning.fundingSources.*` | the funding-source selector |
| `strategies.provisioning.costs.*` | the cost breakdown |
| `strategies.provisioning.bridge.*` | the cross-chain wait and the settling notice |
| `strategies.provisioning.requote.*` | the re-quote prompt |
| `strategies.provisioning.recovery.*` | the interrupted-funding banner |
| `strategies.provisioning.captions.swapGas`, `.approve` | plan-card captions |
| `strategies.provisioning.gas.conversionNote` | rewritten by the epic inside a POO-411 block |
| `strategies.provisioning.steps.swapGas`, `.swapToken` | POO-411 step titles pulled onto epic screens |

Explicitly **out of scope**, and still carrying jargon in `en`: the rest of
`strategies.provisioning.gas.*`, which is the standalone BuyGasModal top-up sheet (POO-411). Its
title still reads "Not enough gas". See §5.

---

## 2. Register, per locale

Measured against the namespaces this epic never touched (`home`, `deposit`, `portfolio`, `wallet`,
`profile`, `rewards`, `auth`, `shell`, `errors`, `cards`), which is the house style these screens
have to sit beside:

| Locale | House register | Measured | Epic before the sweep |
|---|---|---|---|
| `de` | formal `Sie` / `Ihr` | 161 formal vs 27 informal | flipped to `du` on 6 values |
| `nl` | formal `u` / `uw` | 67 vs 24 | flipped to `je` on 33 values |
| `zh-CN` | formal 您 | 81 vs 25 | flipped to 你 on 15 values |
| `zh-TW` | formal 您 | 80 vs 24 | flipped to 你 on 15 values |
| `es` | informal `tú`, neutral Latin American | 100 vs 8 | consistent |
| `pt-BR` | `você` | consistent | consistent |
| `fr` | `vous` | consistent | consistent |
| `ja` | polite です / ます | consistent | consistent |
| `ko` | polite 해요체 | consistent | consistent |
| `vi` | `bạn` | consistent | consistent |

`de` and `nl` formality is also mandated directly by the `i18n-translation-rules` skill.

---

## 3. Glossary: one word per concept

| Concept | `en` | Standardised on | Variant removed |
|---|---|---|---|
| the user's funds | funds / money | `de` **Guthaben** | `Geld` (5), `Mittel` (2) |
| the user's funds | funds / money | `nl` **geld** | `tegoed` (1) |
| network running cost | network costs | `de` **Netzwerkkosten** | `Netzwerkgebühren` (1) |
| network running cost | network costs | `ja` **ネットワーク費用** | ネットワーク手数料 (1) |
| network running cost | network costs | `ko` **네트워크 비용** | 네트워크 수수료 (1) |
| cost | cost | `es` **costo** | `coste` (2, Peninsular) |
| amount | amount | `es` **monto** | `importe` (3, Peninsular) |
| cent | cent | `es` **centavo** | `céntimo` (1, Peninsular) |
| a plan step | Step | `pt-BR` **Etapa** | `Passo` (1 among 10 `Etapa`) |
| crypto | crypto | `vi` **crypto** | `tiền mã hóa` (1 among 9 `crypto`) |
| payment card | card | `zh-TW` **銀行卡** | 金融卡 (2; means debit card specifically) |
| first person plural | we | `pt-BR` **nós / vamos** | `a gente` (2, colloquial) |

---

## 4. Jargon removed (investor app abstracts DeFi terms)

`bridge`, `swap`, `gas` and `slippage` are Manager-Console-only terms. The funding rail is investor
surface, so it names the user's intent, not the mechanism.

| Key | Was | Now |
|---|---|---|
| `provisioning.costs.leg.swapGas` | "Add gas on {network}" | "Cover fees on {network}" |
| `provisioning.steps.swapGas` | "Add gas" | "Cover fees" |
| `provisioning.steps.swapToken` | "Swap to {token}" | "Convert to {token}" |
| `provisioning.gas.conversionNote` | "...into network gas" | "...to cover network costs" |

`costs.leg.swapGas` is the sharpest case: `FundingRecoveryBanner` renders it, and that component's
own header promises "no leg, nonce, receipt or bridge vocabulary reaches the screen".

Two of these are POO-411 keys, corrected here rather than left: `en` was the **outlier**. Eight
locales already abstracted `steps.swapGas` ("Ajouter des frais de réseau", "Netzwerkgebühr
aufladen", "手数料を補充", "Nạp phí mạng"), and nine already said "Convert" rather than "Swap".
The sweep aligned `en` to its own translations, plus the two locales (`pt-BR`, `es`) that had
copied `en`'s jargon.

---

## 5. Actionability

Blocked and failure copy has to say what the user can DO.

- `fundingSources.unreachable` was the one blocked state with **no** escape affordance:
  `FundingSourceSelector` suppresses the escape buttons when a source is unreachable
  (`!unreachable && verdict === "BLOCKED"`), so the sentence is the only way out and it did not
  offer one. Now: "...Pick something else from the list."
- The recovery banner carries no failure vocabulary at all. The money is fine and in transit
  (`02_BRIDGE_ARCHITECTURE.md` §3.9); "Nothing is lost" is the only sentence in the block that
  names loss, and it names it in order to deny it.

---

## 6. PP-I18N: queued for native review

Per the machine-translation policy, a rendering that cannot be verified is **flagged, not silently
rewritten**. These are open questions for a native speaker (POO-231), not defects.

| Locale | Key | Term | PP-I18N note |
|---|---|---|---|
| `vi` | `strategies.provisioning.costs.leg.swapGas` | "Chuẩn bị phí" | PP-I18N: "prepare the fee" is a literal rendering of "cover fees". A native speaker may prefer a set phrase. |
| `vi` | `strategies.provisioning.gasVerdict.topUp` | mạng / mạng lưới | PP-I18N: the epic says bare "mạng" on the provisioning screens and "mạng lưới" on /swap, and the untouched `deposit` namespace uses "mạng lưới" 6 times. Not normalised: "phí mạng lưới" may be unnatural where "phí mạng" is idiomatic. A native speaker should pick one rule. |
| `ja` | `strategies.provisioning.costs.leg.swapGas` | 費用を用意 | PP-I18N: "prepare the cost" for "cover fees". 手数料を用意 was rejected to keep 費用 as the single word for network cost, but the resulting phrase is not idiomatic Japanese. |
| `ja` | `strategies.provisioning.costs.priceBuffer` | 価格バッファー | PP-I18N: katakana loanword for "price buffer". Likely understood, but a native financial term may exist. |
| `ko` | `strategies.provisioning.costs.leg.swapGas` | 비용 준비 | PP-I18N: "cost preparation" for "cover fees". Terse to the point of ambiguity in a step list. |
| `ko` | `strategies.provisioning.costs.priceBuffer` | 가격 버퍼 | PP-I18N: loanword for "price buffer", same question as `ja`. |
| `zh-CN` | `strategies.provisioning.costs.leg.swapGas` | 准备 {network} 的费用 | PP-I18N: "prepare the fees for {network}" for "cover fees". Reads as an instruction to the user rather than a description of a step the app runs. |
| `zh-TW` | `strategies.provisioning.costs.leg.swapGas` | 準備 {network} 的費用 | PP-I18N: same question as `zh-CN`. |
| `zh-TW` | `strategies.provisioning.costs.buyCrypto.hint` | 銀行卡 | PP-I18N: changed from 金融卡 (debit card specifically) to match the untouched namespaces, but Taiwan copy often says 信用卡 for a card payment. |
| `de` | `strategies.provisioning.costs.priceBuffer` | Preispuffer | PP-I18N: compound is grammatical but may read as jargon; "Preisreserve" is the likelier product word. |
| `nl` | `strategies.provisioning.costs.priceBuffer` | Prijsbuffer | PP-I18N: same question as `de`. |
| `fr` | `strategies.provisioning.gasVerdict.escape.bridgeNative` | "Envoyez ... depuis" | PP-I18N: `en` says "Move ... over from another network"; the French says "send from", which reads as an instruction to use another app rather than an action this one offers. |

---

## 7. What this sweep did NOT change

- **Key names.** Values only. `swapGas`, `bridgeNative`, `leg`, `rederive` stay as identifiers even
  where the word they contain is banned from copy, because the code reads them.
- **`strategies.provisioning.gas.*`** beyond `conversionNote`: the BuyGasModal sheet is POO-411, has
  its own tests, and still says "Not enough gas" / "Add {amount} gas" / "Gas added" in `en`.
  It should get the same treatment in a follow-up.
- **Pre-existing register drift outside the epic.** `nl` and `zh` `strategies.json` still mix
  registers on POO-4xx keys (nl 13 informal vs 22 formal; zh-CN 14 vs 37). Normalising those is a
  separate, much larger change; this sweep only guarantees the funding surfaces are internally
  consistent.
- **`fundingSources.empty`** ("There's nothing here we can spend yet."). It is a blocked state with
  no next step, but the honest fix is a CTA in the component, not a longer sentence. Copy alone
  cannot make it actionable.
