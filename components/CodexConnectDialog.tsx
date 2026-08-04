import React, { useEffect, useState } from "react";
import { Check, Link2, ShieldCheck, X } from "lucide-react";

type Props = {
  isOpen: boolean;
  initialCode?: string;
  initialScope?: "project_read" | "project_full";
  onClose: () => void;
  onInspect: (userCode: string) => Promise<"project_read" | "project_full">;
  onApprove: (userCode: string, scope: "project_read" | "project_full") => Promise<void>;
};

const normalizeCode = (value: string) => {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

export const CodexConnectDialog: React.FC<Props> = ({
  isOpen,
  initialCode = "",
  initialScope = "project_read",
  onClose,
  onInspect,
  onApprove,
}) => {
  const [code, setCode] = useState(() => normalizeCode(initialCode));
  const [status, setStatus] = useState<"idle" | "approving" | "approved">("idle");
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"project_read" | "project_full">(initialScope);
  const [scopeVerified, setScopeVerified] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCode(normalizeCode(initialCode));
    setStatus("idle");
    setError("");
    setScope(initialScope);
    setScopeVerified(false);
  }, [initialCode, initialScope, isOpen]);

  useEffect(() => {
    if (!isOpen || code.length !== 9 || status !== "idle") return;
    let active = true;
    const timer = window.setTimeout(() => {
      void onInspect(code).then((verifiedScope) => {
        if (!active) return;
        setScope(verifiedScope);
        setScopeVerified(true);
        setError("");
      }).catch((cause) => {
        if (!active) return;
        setScopeVerified(false);
        setError(cause instanceof Error ? cause.message : "无法核对 Codex 授权范围。");
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [code, isOpen, onInspect, status]);

  if (!isOpen) return null;

  const approve = async () => {
    if (code.length !== 9 || !scopeVerified || status === "approving") return;
    setStatus("approving");
    setError("");
    try {
      await onApprove(code, scope);
      setStatus("approved");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "无法完成 Codex 授权。");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-connect-title"
        className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-text-primary)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-[var(--app-border)] bg-[var(--app-panel-muted)]">
              <Link2 size={19} />
            </span>
            <div>
              <h2 id="codex-connect-title" className="text-[17px] font-semibold tracking-[-0.03em]">连接 Codex</h2>
              <p className="mt-1 text-[11px] leading-5 text-[var(--app-text-secondary)]">把 Codex 作为 Stylo 的外部 Agent Host 接入。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 Codex 连接"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] hover:text-[var(--app-text-primary)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="space-y-5 px-6 py-6">
          {status === "approved" ? (
            <div className="rounded-[22px] border border-emerald-500/25 bg-emerald-500/10 p-5 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                <Check size={20} />
              </span>
              <div className="mt-3 text-[14px] font-semibold">Codex 已获授权</div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--app-text-secondary)]">本机正在完成连接。你可以关闭此窗口。</p>
            </div>
          ) : (
            <>
              <div className="rounded-[20px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-600" />
                  <div className="text-[11px] leading-5 text-[var(--app-text-secondary)]">
                    {scope === "project_full" ? (
                      <>
                        <p>此 Codex 将获得项目完整操作能力：读取与创建文档、更新普通内容、移动/连接 Flow 节点，以及操作 Foundation。</p>
                        <p className="mt-2">不包含账户、凭证、项目删除、发布或直接启动图像/视频生成。每次非只读工具仍由 Codex 审批。授权最长 8 小时，可随时撤销。</p>
                      </>
                    ) : (
                      <p>此授权只允许查阅你的 Stylo 项目，不能修改项目。授权最长 8 小时，可随时撤销。</p>
                    )}
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-secondary)]">配对码</span>
                <input
                  autoFocus
                  value={code}
                  onChange={(event) => {
                    setCode(normalizeCode(event.target.value));
                    setScopeVerified(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void approve();
                  }}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD-EFGH"
                  className="mt-2 h-14 w-full rounded-[18px] border border-[var(--app-border)] bg-[var(--app-bg)] px-4 text-center font-mono text-[20px] tracking-[0.18em] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-strong)]"
                />
              </label>

              {error ? <p className="text-[11px] leading-5 text-red-500">{error}</p> : null}

              <button
                type="button"
                disabled={code.length !== 9 || !scopeVerified || status === "approving"}
                onClick={() => void approve()}
                className="flex h-12 w-full items-center justify-center rounded-[16px] bg-[var(--app-text-primary)] px-4 text-[12px] font-semibold text-[var(--app-bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {status === "approving"
                  ? "正在授权…"
                  : scope === "project_full"
                    ? "授权项目完整能力"
                    : "授权只读能力"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
