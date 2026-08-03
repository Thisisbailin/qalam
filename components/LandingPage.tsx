import React, { memo, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Brain,
  BracketsCurly,
  FilmScript,
  GitBranch,
  GithubLogo,
  Images,
  MapTrifold,
  PenNib,
  Stack,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PRODUCT_REPOSITORIES } from "../constants/productRepositories";

type ArchitectureKey = "manus" | "foundation" | "lookbook" | "cinewor" | "agent";

type ArchitectureItem = {
  id: ArchitectureKey;
  index: string;
  name: string;
  label: string;
  description: string;
  note: string;
  state: "Core" | "In Stylo" | "Independent";
  href?: string;
  Icon: React.ComponentType<{ size?: number; weight?: "regular" | "duotone" | "fill" }>;
};

const architectureItems: ArchitectureItem[] = [
  {
    id: "manus",
    index: "01",
    name: "Manus",
    label: "Screenplay writing wrapper",
    description: "Manus 将 Flow 组织成面向剧本写作的专业界面，结构化处理场景、动作、对白与人物，并提供完整 Fountain 支持。",
    note: "Flow stays visible; writing becomes the interface.",
    state: "Independent",
    href: PRODUCT_REPOSITORIES.manus,
    Icon: FilmScript,
  },
  {
    id: "foundation",
    index: "02",
    name: "Foundation",
    label: "Project structure wrapper",
    description: "以柄、轴、块组织项目顶层数据。Foundation 只保留时间轴与空间轴，角色和场景资产由 Lookbook 统一管理。",
    note: "柄 → 轴 → 块 / time + space",
    state: "Core",
    Icon: MapTrifold,
  },
  {
    id: "lookbook",
    index: "03",
    name: "LookBook",
    label: "Visual development wrapper",
    description: "面向前期美术的角色与场景视觉册，让视觉探索、身份设定和项目资料在同一套 Flow 语义上工作。",
    note: "Developed independently; planned for integration.",
    state: "Independent",
    href: PRODUCT_REPOSITORIES.lookbook,
    Icon: Images,
  },
  {
    id: "cinewor",
    index: "04",
    name: "Cinewor",
    label: "Scheduling design wrapper",
    description: "面向调度与镜头设计的工作层，把空间、节奏和制作意图组织为可推演的视觉调度。",
    note: "Developed independently; planned for integration.",
    state: "Independent",
    href: PRODUCT_REPOSITORIES.cinewor,
    Icon: GitBranch,
  },
];

const sourceHref = PRODUCT_REPOSITORIES.stylo;

const Reveal = memo(function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8%" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
});

const ArchitectureMap = memo(function ArchitectureMap() {
  const [active, setActive] = useState<ArchitectureKey>("foundation");
  const reduceMotion = useReducedMotion();
  const activeItem = active === "agent"
    ? {
        id: "agent" as const,
        name: "Agent",
        label: "Native intelligence layer",
        description: "与 Canvas + Flow 同生的原生大脑。默认由 DeepSeek 驱动，基于 OpenAI Agents SDK，直接读取、理解并操作同一张创作图。",
        note: "DeepSeek · OpenAI Agents SDK · project-native tools",
      }
    : architectureItems.find((item) => item.id === active)!;

  return (
    <div className="stylo-architecture" aria-label="Stylo architecture map">
      <div className="stylo-architecture__rail" aria-hidden="true">
        <span>Creative system / 2026</span>
        <span>Desktop only</span>
      </div>

      <div className="stylo-architecture__stage">
        <button
          type="button"
          className={`stylo-architecture__agent ${active === "agent" ? "is-active" : ""}`}
          onMouseEnter={() => setActive("agent")}
          onFocus={() => setActive("agent")}
          onClick={() => setActive("agent")}
        >
          <span className="stylo-architecture__agent-icon"><Brain size={18} weight="duotone" /></span>
          <span><strong>Agent</strong><small>native brain / DeepSeek</small></span>
          <BracketsCurly size={16} weight="regular" />
        </button>

        <div className="stylo-architecture__connectors" aria-hidden="true">
          <span /><span /><span /><span />
        </div>

        <div className="stylo-architecture__wrappers">
          {architectureItems.map(({ id, name, label, Icon }, index) => (
            <button
              key={id}
              type="button"
              className={`stylo-architecture__wrapper ${active === id ? "is-active" : ""}`}
              onMouseEnter={() => setActive(id)}
              onFocus={() => setActive(id)}
              onClick={() => setActive(id)}
              style={{ "--wrapper-index": index } as React.CSSProperties}
            >
              <span className="stylo-architecture__wrapper-index">0{index + 1}</span>
              <Icon size={20} weight="duotone" />
              <span><strong>{name}</strong><small>{label}</small></span>
            </button>
          ))}
        </div>

        <div className="stylo-architecture__core">
          <div><span>Spatial substrate</span><strong>Canvas</strong></div>
          <span className="stylo-architecture__plus">+</span>
          <div><span>Semantic graph</span><strong>Flow</strong></div>
        </div>
      </div>

      <div className="stylo-architecture__detail" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeItem.id}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <span>{activeItem.label}</span>
            <strong>{activeItem.name}</strong>
            <p>{activeItem.description}</p>
            <code>{activeItem.note}</code>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
});

const SourceLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="stylo-source-link" href={href} target="_blank" rel="noreferrer">
    <GithubLogo size={16} weight="duotone" />
    <span>{children}</span>
    <ArrowUpRight size={13} weight="bold" />
  </a>
);

export const LandingPage: React.FC = () => {
  return (
    <div className="stylo-site">
      <main id="top">
        <section className="stylo-hero">
          <div className="stylo-hero__copy">
            <Reveal>
              <div className="stylo-kicker"><PenNib size={15} weight="duotone" /> stylo /sti.lo/ · nom masculin</div>
              <h1>Stylo</h1>
              <p className="stylo-hero__lede">一支笔，也是一套为影像创作搭建的桌面结构。</p>
              <p className="stylo-hero__body">
                从无限画布和节点流出发，将剧本、项目结构、视觉开发与调度设计包进同一个可阅读、可连接、可推演的创作世界。
              </p>
              <div className="stylo-hero__actions">
                <a className="stylo-hero__action stylo-hero__action--primary" href="/?app=1">
                  立即体验
                </a>
                <button className="stylo-hero__action" type="button" disabled title="桌面版下载后续上线">
                  <span>下载</span>
                  <small>后续上线</small>
                </button>
              </div>
              <div className="stylo-hero__meta">
                <span>macOS desktop</span>
                <span>open source</span>
                <span>local-first direction</span>
              </div>
            </Reveal>
          </div>

          <Reveal className="stylo-hero__visual" delay={0.12}>
            <ArchitectureMap />
          </Reveal>

          <a className="stylo-scroll-cue" href="#architecture">
            <span>Explore the layers</span>
            <ArrowDown size={14} weight="bold" />
          </a>
        </section>

        <section id="architecture" className="stylo-section stylo-section--architecture">
          <Reveal className="stylo-section__heading">
            <span>Architecture / 01</span>
            <h2>一套底层，数种创作界面。</h2>
            <p>包装器不制造彼此隔离的模块。它们只是从不同专业视角，重新组织同一个 Canvas + Flow 世界。</p>
          </Reveal>

          <div className="stylo-layer-ledger">
            {architectureItems.map(({ id, index, name, label, description, state, href, Icon }, itemIndex) => (
              <Reveal key={id} className="stylo-layer-row" delay={itemIndex * 0.05}>
                <div className="stylo-layer-row__index">{index}</div>
                <div className="stylo-layer-row__name">
                  <Icon size={22} weight="duotone" />
                  <div><strong>{name}</strong><span>{label}</span></div>
                </div>
                <p>{description}</p>
                <div className="stylo-layer-row__state">
                  <span>{state}</span>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" aria-label={`${name} source code`}>
                      <GithubLogo size={17} weight="duotone" />
                      <ArrowUpRight size={12} weight="bold" />
                    </a>
                  ) : (
                    <i />
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="stylo-section stylo-section--core">
          <Reveal className="stylo-core-statement">
            <div className="stylo-section__heading stylo-section__heading--light">
              <span>Foundation / 02</span>
              <h2>Canvas 提供空间。<br />Flow 提供意义。</h2>
            </div>
            <p>
              画布负责视口、缩放、选择与空间组织；Flow 负责节点、关系、文档、Foundation 轴线与 Agent 操作。上层能力因此可以共享同一种项目语言。
            </p>
          </Reveal>

          <Reveal className="stylo-core-diagram" delay={0.12}>
            <div className="stylo-core-diagram__axis"><span>wrappers</span><i /></div>
            <div className="stylo-core-diagram__modules">
              <span>Manus</span><span>Foundation</span><span>LookBook</span><span>Cinewor</span>
            </div>
            <div className="stylo-core-diagram__brain"><Brain size={18} weight="duotone" /><span>Agent reads & operates the same graph</span></div>
            <div className="stylo-core-diagram__base">
              <div><small>01</small><strong>Canvas</strong><span>space / viewport / interaction</span></div>
              <div><small>02</small><strong>Flow</strong><span>nodes / links / documents</span></div>
            </div>
          </Reveal>
        </section>

        <section className="stylo-section stylo-section--agent">
          <Reveal className="stylo-agent-mark"><Brain size={36} weight="duotone" /></Reveal>
          <Reveal className="stylo-agent-copy" delay={0.08}>
            <span>Native intelligence / 03</span>
            <h2>Agent 不是悬浮在软件外面的聊天框。</h2>
            <p>它与 Canvas + Flow 共用同一份项目事实，通过原生工具读取、编辑和操作用户眼前的创作结构。</p>
          </Reveal>
          <Reveal className="stylo-agent-runtime" delay={0.16}>
            <div><span>Default model</span><strong>DeepSeek</strong></div>
            <div><span>Runtime</span><strong>OpenAI Agents SDK</strong></div>
            <div><span>Context</span><strong>Canvas + Flow</strong></div>
          </Reveal>
        </section>
      </main>

      <footer className="stylo-footer">
        <div>
          <div className="stylo-footer__brand"><PenNib size={18} weight="duotone" /><strong>Stylo</strong></div>
          <p>Desktop creative system. The web edition is currently closed while its sharing experience is rebuilt.</p>
        </div>
        <div className="stylo-footer__sources">
          <SourceLink href={sourceHref}>Stylo</SourceLink>
          <SourceLink href={PRODUCT_REPOSITORIES.manus}>Manus</SourceLink>
          <SourceLink href={PRODUCT_REPOSITORIES.lookbook}>LookBook</SourceLink>
          <SourceLink href={PRODUCT_REPOSITORIES.cinewor}>Cinewor</SourceLink>
        </div>
        <div className="stylo-footer__note">Open-source creative tooling<br />Designed for the desktop</div>
      </footer>
    </div>
  );
};
