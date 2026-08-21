// Global error boundary (WO11 Stage 0). Permanent infrastructure, not a
// diagnostic probe: today any render-phase throw anywhere in the tree
// unmounts <App/> entirely and blanks the window — the single structural
// reason unrelated defects (B2/C1/F1) were indistinguishable from each
// other. This renders the failure instead of swallowing it: message,
// component stack, and a Reload button, styled with design tokens because
// it is chrome the user will actually see.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Copy } from "lucide-react";

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, "error"> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info, copied: false });
    console.error("Cowtext render error", error, info.componentStack);
  }

  /** The whole report as one plain-text block — what actually gets pasted
   *  into a bug report. `body { user-select: none }` (styles/index.css) makes
   *  the app chrome unselectable, and this panel was inheriting it: the text
   *  below now opts back in with `select-text`, and this button is the
   *  one-click path that does not depend on a drag-select landing right. */
  private report(): string {
    const { error, info } = this.state;
    if (error === null) return "";
    return [
      `Cowtext render error: ${error.name}: ${error.message}`,
      `UA: ${navigator.userAgent}`,
      "",
      "Component stack:",
      info?.componentStack ?? "(none)",
      "",
      "Stack trace:",
      error.stack ?? "(none)",
    ].join("\n");
  }

  private copyReport = (): void => {
    const text = this.report();
    void navigator.clipboard
      .writeText(text)
      .then(() => this.setState({ copied: true }))
      .catch(() => {
        // Clipboard API can be refused; the textual fallback is the
        // now-selectable panel itself.
        this.setState({ copied: false });
      });
  };

  render(): ReactNode {
    const { error, info, copied } = this.state;
    if (error === null) return this.props.children;

    const componentStack = info?.componentStack ?? null;

    return (
      <div role="alert" className="fixed inset-0 z-modal flex items-center justify-center bg-surface-0 p-8">
        <div className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-modal">
          <div className="flex h-topbar flex-none items-center gap-3 border-b border-border-subtle px-4">
            <span className="h-2 w-2 flex-none rounded-pill bg-danger" aria-hidden="true" />
            <span className="text-[15px] font-semibold text-content">Cowtext hit an error</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-sm text-content-secondary">
              A render error was caught here instead of blanking the window. The details below are
              safe to copy into a bug report — reload to get back to a working state.
            </p>

            <div className="select-text border-l-[3px] border-l-danger bg-danger-surface px-3 py-2 font-mono text-xs leading-relaxed text-danger-text">
              {error.name}: {error.message}
            </div>

            {componentStack !== null && (
              <div>
                <p className="mb-1 text-xs font-medium text-content-muted">Component stack</p>
                <pre className="max-h-[36vh] select-text overflow-auto rounded border border-border-subtle bg-surface-inset p-3 font-mono text-2xs leading-relaxed text-content-secondary">
                  {componentStack}
                </pre>
              </div>
            )}

            {error.stack !== undefined && (
              <div>
                <p className="mb-1 text-xs font-medium text-content-muted">Stack trace</p>
                <pre className="max-h-[24vh] select-text overflow-auto rounded border border-border-subtle bg-surface-inset p-3 font-mono text-2xs leading-relaxed text-content-secondary">
                  {error.stack}
                </pre>
              </div>
            )}
          </div>

          <div className="flex h-[50px] flex-none items-center gap-3 border-t border-border-subtle px-4">
            <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
              Reload returns to the title screen or last-opened project; unsaved edits since the
              last autosave may be lost.
            </span>
            <button
              onClick={this.copyReport}
              className="flex h-control flex-none items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
            >
              <Copy size={13} strokeWidth={1.5} />
              {copied ? "Copied" : "Copy details"}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex h-control flex-none items-center rounded bg-accent px-3 text-sm font-semibold text-content-inverse transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
