import React, { useEffect, useMemo, useRef } from "react";
import { AudioLines, Image as ImageIcon, Sparkles, Video, Plus } from "lucide-react";
import { BookOpen, FilePdf } from "@phosphor-icons/react";
import { NodeType } from "../types";

export type ConnectionDropMenuOption<T extends string = NodeType> = {
  label: string;
  hint: string;
  type: T;
  Icon: React.ComponentType<{ size?: number }>;
  group?: string;
  meta?: string;
  tone?: string;
  surface?: string;
  disabled?: boolean;
  disabledHint?: string;
};

type Props<T extends string = NodeType> = {
  position: { x: number; y: number };
  onCreate: (type: T) => void;
  onClose: () => void;
  options?: ConnectionDropMenuOption<T>[];
  subtitle?: string;
};

const defaultOptions: ConnectionDropMenuOption<NodeType>[] = [
    { label: "Manus", hint: "剧本包装器 · Fountain", type: "scriptPage", Icon: Plus, group: "wrapper", meta: "Fountain" },
    { label: "Lookbook", hint: "角色与场景视觉册", type: "lookbook", Icon: BookOpen, group: "wrapper", meta: "Identity", disabled: true, disabledHint: "由剧本身份生成" },
    { label: "文本", hint: "Markdown 文本节点", type: "text", Icon: Plus, group: "input", meta: "Text" },
    { label: "图片", hint: "参考图或分镜", type: "imageInput", Icon: ImageIcon, group: "input", meta: "Input" },
    { label: "音频", hint: "对白或声音参考", type: "audioInput", Icon: AudioLines, group: "input", meta: "Input" },
    { label: "视频", hint: "动态参考", type: "videoInput", Icon: Video, group: "input", meta: "Input" },
    { label: "PDF", hint: "阅读资料与关联笔记", type: "pdfInput", Icon: FilePdf, group: "input", meta: "Document" },
    { label: "图像生成", hint: "生成概念图", type: "imageGen", Icon: Sparkles, group: "generation", meta: "Image" },
    { label: "Nano Banana", hint: "图像生成", type: "nanoBananaImageGen", Icon: Sparkles, group: "generation", meta: "Image" },
    { label: "WAN 图像", hint: "图像工作流", type: "wanImageGen", Icon: Sparkles, group: "generation", meta: "Image" },
    { label: "Vidu 视频", hint: "参考生成视频", type: "viduVideoGen", Icon: Video, group: "motion", meta: "Video" },
    { label: "WAN 视频", hint: "参考生成视频", type: "wanReferenceVideoGen", Icon: Video, group: "motion", meta: "Video" },
    { label: "Seedance", hint: "多模态视频", type: "seedanceVideoGen", Icon: Video, group: "motion", meta: "Video" },
  ];

const groupLabels: Record<string, string> = {
  wrapper: "创作包装器",
  input: "输入",
  generation: "图像",
  motion: "视频",
  edit: "编辑",
  Flow: "Flow",
};

export const ConnectionDropMenu = <T extends string = NodeType>({
  position,
  onCreate,
  onClose,
  options,
  subtitle = "从连接线创建节点",
}: Props<T>) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const resolvedOptions = (options || defaultOptions) as ConnectionDropMenuOption<T>[];
  const groupedOptions = useMemo(() => {
    const groups: Array<{ key: string; options: ConnectionDropMenuOption<T>[] }> = [];
    resolvedOptions.forEach((option) => {
      const rawKey = option.group || option.meta || "Flow";
      const key = groupLabels[rawKey] || rawKey;
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.options.push(option);
      else groups.push({ key, options: [option] });
    });
    return groups;
  }, [resolvedOptions]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="connection-menu absolute z-20"
      style={{ left: position.x, top: position.y }}
    >
      <div className="connection-menu-header">
        <div className="connection-menu-title">新增节点</div>
        <div className="connection-menu-subtitle">{subtitle}</div>
      </div>
      <div className="connection-menu-list">
        {groupedOptions.map((group) => (
          <div key={group.key} className="connection-menu-group">
            <div className="connection-menu-group-label">{group.key}</div>
            <div className="connection-menu-grid">
              {group.options.map((opt) => (
                <button
                  key={opt.type}
                  className={`connection-menu-item ${opt.disabled ? "is-disabled" : ""}`}
                  disabled={opt.disabled}
                  onClick={() => {
                    if (opt.disabled) return;
                    onCreate(opt.type);
                    onClose();
                  }}
                >
                  <span className="connection-menu-icon">
                    <opt.Icon size={15} />
                  </span>
                  <span className="connection-menu-text">
                    <span className="connection-menu-label">{opt.label}</span>
                    <span className="connection-menu-hint">{opt.disabledHint || opt.meta || opt.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
