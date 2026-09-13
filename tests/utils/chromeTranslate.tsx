/**
 * @name chromeTranslate
 *
 * Test-support helper (no artifact ID, like `tests/utils/renderWithProviders.tsx`). Shared by
 * PP-CORE-CMP-010 (`Button.test.tsx`, POO-1782) and PP-AUTH-SCR-001 (`AuthMethodButton.test.tsx`,
 * POO-1762).
 *
 * Replays what Chrome page translation (Google Translate, built in or the extension) does to a
 * rendered tree, and catches the commit-phase error React raises when a later render touches the
 * rewritten node. Shared by every regression test for the POO-1762 crash shape.
 */
import { Component, type ReactNode } from "react";

/**
 * Chrome replaces every text node with `<font style="vertical-align: inherit;"><font style=
 * "vertical-align: inherit;">...</font></font>` holding a NEW text node, while React keeps its
 * reference to the old one. Sentry breadcrumbs from the production crash show clicks landing on
 * exactly `font > font`.
 */
export function translateLikeChrome(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }
  for (const node of textNodes) {
    const outer = document.createElement("font");
    const inner = document.createElement("font");
    outer.style.verticalAlign = "inherit";
    inner.style.verticalAlign = "inherit";
    inner.textContent = node.data;
    outer.appendChild(inner);
    node.parentNode?.replaceChild(outer, node);
  }
}

/**
 * A commit-phase DOM exception is caught by the nearest boundary, not thrown from `rerender`, so a
 * test needs one to observe it. In production that boundary is `src/app/[locale]/error.tsx`.
 */
export class CatchBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
