import React, { useState } from "react";
import { ArrowUpRight, FileText, Path, Target } from "@phosphor-icons/react";

export type InfoSectionKey = "about" | "roadmap";

type Props = {
  onOpenLanding?: () => void;
  initialSection?: InfoSectionKey;
  activeSection?: InfoSectionKey;
  onActiveSectionChange?: (section: InfoSectionKey) => void;
  showSidebar?: boolean;
};

export const InfoPanel: React.FC<Props> = ({
  onOpenLanding,
  initialSection = "about",
  activeSection,
  onActiveSectionChange,
  showSidebar = true,
}) => {
  const [internalActive, setInternalActive] = useState<InfoSectionKey>(initialSection);
  const active = activeSection ?? internalActive;
  const handleSectionSelect = (section: InfoSectionKey) => {
    if (activeSection === undefined) {
      setInternalActive(section);
    }
    onActiveSectionChange?.(section);
  };

  return (
    <div className="space-y-4 text-[var(--app-text-primary)]">
      <div className={`grid grid-cols-1 gap-5 ${showSidebar ? "lg:grid-cols-[280px_1fr]" : ""}`}>
        {showSidebar ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">账户 · IO</div>
              {[
                { key: "about" as const, label: "关于", Icon: FileText },
                { key: "roadmap" as const, label: "路线图", Icon: Target },
              ].map(({ key, label, Icon }) => {
                const activeItem = active === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSectionSelect(key)}
                    className={`flex items-center justify-between gap-2 rounded-[20px] border px-3 py-2.5 text-[12px] transition active:translate-y-px ${
                      activeItem
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                        : "border-[var(--app-border)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon size={14} weight="duotone" />
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 text-[11px] text-[var(--app-text-secondary)] space-y-2">
              <div className="uppercase tracking-[0.28em]">产品信息</div>
              <div>Stylo 正在从工具集合收束为一块连续的创作工作面。</div>
              <div>这里集中呈现产品结构、发展方向和 landing page 入口。</div>
            </div>
          </div>
        ) : null}

        <div className="rounded-[32px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-5 space-y-5">
          {active === "about" ? (
            <>
              <div className="grid grid-cols-1 gap-5 border-b border-[var(--app-border)] pb-5 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="flex items-start gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-soft)]">
                    <img className="h-full w-full object-cover" src="/icon-128.png" alt="" />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">关于 Stylo</div>
                    <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">Stylo</div>
                    <div className="text-[12px] text-[var(--app-text-secondary)]">v0.3 · Flow Workspace</div>
                    <div className="mt-3 max-w-xl text-[13px] leading-7 text-[var(--app-text-secondary)]">
                      以 Script 为创作基础的无限画布，用于组织档案、规划资产并连接创作节点。
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">工作面</div>
                  <div className="mt-3 space-y-3">
                    {[
                      { label: "工作区", value: "Flow 工作区" },
                      { label: "结构链", value: "Script → 档案 → Nodes" },
                      { label: "访问方式", value: "无需登录即可打开" },
                    ].map((item) => (
                      <div key={item.label} className="border-b border-[var(--app-border)] pb-3 last:border-b-0 last:pb-0">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--app-text-secondary)]">
                          {item.label}
                        </div>
                        <div className="mt-1 text-[13px] font-semibold">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                {[
                  {
                    label: "核心方向",
                    value: "理解 / 组织 / 生成",
                    detail: "把剧本、角色、场景和节点工作流放在同一条连续操作链上。",
                  },
                  {
                    label: "Agent 层",
                    value: "Stylo System",
                    detail: "代理能力、视觉路径和视频路径现在共用同一块入口结构。",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4"
                  >
                    <div className="text-[11px] text-[var(--app-text-secondary)] uppercase tracking-[0.28em]">
                      {item.label}
                    </div>
                    <div className="mt-2 text-[15px] font-semibold tracking-[-0.02em]">{item.value}</div>
                    <div className="mt-2 text-[12px] leading-6 text-[var(--app-text-secondary)]">{item.detail}</div>
                  </div>
                ))}
              </div>

              {onOpenLanding ? (
                <div className="grid grid-cols-1 gap-4 border-t border-[var(--app-border)] pt-5 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">
                      <Path size={14} weight="duotone" />
                      入口说明
                    </div>
                    <div className="text-[20px] font-semibold tracking-[-0.03em]">为项目新增独立落地页入口</div>
                    <div className="max-w-2xl text-[13px] leading-7 text-[var(--app-text-secondary)]">
                      从这里进入 landing page，查看更完整的产品结构，并可通过“立即体验”直接返回主工作台。
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenLanding}
                    className="group flex min-h-[148px] flex-col justify-between rounded-[24px] border border-[var(--app-border-strong)] bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.03))] p-4 text-left transition hover:-translate-y-[1px] hover:border-emerald-400/60"
                  >
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">
                      <span>Landing</span>
                      <ArrowUpRight size={16} weight="bold" className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                    <div>
                      <div className="text-[16px] font-semibold tracking-[-0.02em]">打开落地页</div>
                      <div className="mt-2 text-[12px] leading-6 text-[var(--app-text-secondary)]">
                        查看 Stylo 的 Agent 能力与产品结构，再从“立即体验”回到主工作面。
                      </div>
                    </div>
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--app-text-secondary)]">路线图 · Roadmap</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  {
                    title: "时间线与回放",
                    desc: "浏览生成历史、比较不同版本，并从任意节点分支继续编辑。",
                  },
                  {
                    title: "资产管理",
                    desc: "集中整理图片、视频和 prompts，并通过标签建立检索关系。",
                  },
                  {
                    title: "协作",
                    desc: "支持团队审阅、批注以及发布确认流程。",
                  },
                  {
                    title: "发布",
                    desc: "完善导出 pipeline、交付链路和带版本记录的正式发布。",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4 space-y-2"
                  >
                    <div className="text-[13px] font-semibold">{item.title}</div>
                    <div className="text-[12px] text-[var(--app-text-secondary)]">{item.desc}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
