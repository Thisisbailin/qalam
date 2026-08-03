import React from "react";
import type { LucideIcon } from "lucide-react";

export type ModuleKey =
  | "characters"
  | "scenes"
  | "glassLab"
  | "agentLab"
  | "cineworLab"
  | "designSystemLab";

type ModuleItem = {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
};

type Props = {
  modules: ModuleItem[];
  onOpen: (key: ModuleKey) => void;
};

export const ModuleBar: React.FC<Props> = ({ modules, onOpen }) => {
  const accent: Record<ModuleKey, string> = {
    characters: "#34d399",
    scenes: "#22d3ee",
    glassLab: "#a3a3a3",
    agentLab: "#f26b4f",
    cineworLab: "#6f8f88",
    designSystemLab: "#7c827d",
  };

  return (
    <div className="flex h-12 items-center gap-2 rounded-full app-panel px-3">
      {modules.map((mod) => {
        const Icon = mod.icon;
        return (
          <button
            key={mod.key}
            type="button"
            onClick={() => onOpen(mod.key)}
            className="group h-10 w-10 flex items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] transition"
          >
            <Icon size={18} style={{ color: accent[mod.key] }} />
          </button>
        );
      })}
    </div>
  );
};
