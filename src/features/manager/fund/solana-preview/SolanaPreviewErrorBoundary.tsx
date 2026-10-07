/**
 * @id PP-MGR-SCR-009
 * @name SolanaPreviewErrorBoundary
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events solana_preview_error
 */
"use client";

import { Component, type ReactNode } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";

interface Props {
  children: ReactNode;
  fallback(retry: () => void): ReactNode;
  onError(): void;
}
/** Catches a genuine render exception without logging exception contents or creating network errors. */
export class SolanaPreviewErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed
      ? this.props.fallback(() => this.setState({ failed: false }))
      : this.props.children;
  }
}

/** Actual render failures emit here; bounded metadata only, never raw exception contents. */
export function SolanaPreviewRenderBoundary({
  children,
  fallback,
  hasLocalChanges,
}: Omit<Props, "onError"> & { hasLocalChanges: boolean }) {
  const { track } = useAnalytics();
  return (
    <SolanaPreviewErrorBoundary
      fallback={fallback}
      onError={() =>
        track("solana_preview_error", {
          error_code: "SOLANA_PREVIEW_RENDER_FAILED",
          error_origin: "app",
          has_local_changes: hasLocalChanges,
        })
      }
    >
      {children}
    </SolanaPreviewErrorBoundary>
  );
}
