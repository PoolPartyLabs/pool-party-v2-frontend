---
name: a11y-checklist
description: Accessibility checklist for the Pool Party investor app. Focus management in sheets and transactional modals, contrast on the dark theme, aria for dynamic monetary values, full keyboard support on the deposit keypad and custom controls. Used by qa-reviewer on every PR and by react-component-blueprint when building new components.
---

# Accessibility Checklist

Pool Party is a money app on a dark theme: a11y failures here cost users real funds (a mis-read amount, an untrappable modal mid-transaction). Run this checklist when building a component (`react-component-blueprint`) and when reviewing a PR (`qa-reviewer`).

## 1. Focus management (sheets, dialogs, transactional modals)

- Opening a Dialog/Sheet moves focus INTO it (first focusable or the title); closing returns focus to the trigger. The Radix primitives do this; do not break it with `autoFocus` on arbitrary children or manual `blur()`.
- Focus is trapped while open; Esc and overlay-click close (unless the flow is a confirm-step, then Esc only).
- Multi-step transactional flows (deposit, withdraw, swap): each step change announces itself; focus lands on the step heading, not on a button that could be activated by a stray Enter.
- Never auto-close a modal that holds an in-flight transaction state; an aria-live region reports pending/confirmed/failed.

## 2. Contrast (dark theme)

- Text on `bg/midnight` (#171717) and `surface/1` (#1f1f1f): `text/primary` #efefef and `text/secondary` #a3a3a3 pass AA; `text/muted` #737373 is for non-essential text ONLY (placeholder, timestamps), never for values or labels the user acts on.
- Gold on dark: `accent/gold` #f7ce02 text on #171717 passes; dark-on-gold buttons use `text/on-gold` #0b0b0b.
- Never convey state by color alone: pair red/green P&L with a sign (+/-) or an icon; risk bands have labels, not just colored dots.
- Check disabled states still hit 3:1 against their surface for the control outline.

## 3. Dynamic monetary values (aria)

- Values that update live (balances, P&L, quotes, countdowns) sit in `aria-live="polite"` containers; never `assertive` for price ticks.
- Format the accessible name as the user would read it: `aria-label="Balance: $1,234.56"`, not raw `1234.56`.
- Skeletons/loading: the region exposes `aria-busy="true"`; do not announce intermediate skeleton flashes.
- Trend arrows/sparklines are `aria-hidden` with an adjacent textual summary (the rule: every chart has a text equivalent of its takeaway).

## 4. Keyboard (deposit keypad and custom controls)

- The custom deposit keypad: every key is a real `<button>` (digits, decimal, backspace), reachable in DOM order, and the hardware keyboard works too (digits, `.`, Backspace, Enter to continue).
- Toggles use `role="switch"` + `aria-checked`; sliders (slippage) support arrow keys with sensible steps and announce the value.
- Copy-to-clipboard buttons have an aria-label naming WHAT is copied ("Copy referral code") and announce success ("Copied") via live region, not only a visual check icon.
- No keyboard traps outside open modals; `focus-visible` ring on every interactive element (the ring token, never `outline: none` without replacement).

## PR review quick pass (qa-reviewer)

- [ ] New modal/sheet: focus in, trap, restore on close, Esc behavior defined.
- [ ] New copy/value displays: live regions where values change; aria-labels read naturally with currency.
- [ ] New interactive element: keyboard reachable + operable, visible focus ring, real semantic element (button/a, not div onClick).
- [ ] Color is never the only signal; contrast spot-check on new tinted surfaces.
- [ ] `aria-hidden` on decorative icons; meaningful icons have text or labels.
