import React from "react";

type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Stylo renderer error boundary", {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="min-h-screen bg-[var(--app-bg,#f6f6f4)] px-6 py-16 text-[var(--app-text-primary,#171717)]">
        <section className="mx-auto max-w-xl rounded-2xl border border-[var(--app-border,#d8d8d2)] bg-[var(--app-panel,#fff)] p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Stylo 工作区遇到异常</h1>
          <p className="mt-3 text-sm text-[var(--app-text-secondary,#666)]">
            当前页面状态已停止更新，项目的云端数据不会因此被覆盖。重新载入后可以继续工作。
          </p>
          <button
            type="button"
            className="mt-6 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
          >
            重新载入
          </button>
        </section>
      </main>
    );
  }
}
