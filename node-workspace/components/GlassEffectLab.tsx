import React, { useEffect, useRef, useState } from "react";
import { ArrowsOutCardinal, CornersOut, X } from "@phosphor-icons/react";
import {
  GLASS_DIFFUSION_PRESETS,
  GlassDiffusionField,
  GlassDiffusionPresetKey,
  MaterialGlassShadow,
  STYLO_GLASS_LAB_CONFIG,
  STYLO_GLASS_LAB_SHADOW,
} from "./GlassDiffusionField";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;

type RangeControl = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  set: React.Dispatch<React.SetStateAction<number>>;
};

const presetLabels: Record<GlassDiffusionPresetKey, string> = {
  bare: "Bare",
  mist: "Mist",
  veil: "Veil",
  stylo: "Stylo",
};

export const GlassEffectLab: React.FC<Props> = ({ isOpen, onClose }) => {
  const [preset, setPreset] = useState<GlassDiffusionPresetKey>("stylo");
  const [posX, setPosX] = useState(112);
  const [posY, setPosY] = useState(88);
  const [width, setWidth] = useState(GLASS_DIFFUSION_PRESETS.stylo.width);
  const [height, setHeight] = useState(GLASS_DIFFUSION_PRESETS.stylo.height);
  const [blur, setBlur] = useState(STYLO_GLASS_LAB_CONFIG.blur);
  const [fillAlpha, setFillAlpha] = useState(STYLO_GLASS_LAB_CONFIG.fillAlpha);
  const [saturate, setSaturate] = useState(STYLO_GLASS_LAB_CONFIG.saturate);
  const [fadeInsetX, setFadeInsetX] = useState(STYLO_GLASS_LAB_CONFIG.fadeInsetX);
  const [fadeInsetY, setFadeInsetY] = useState(STYLO_GLASS_LAB_CONFIG.fadeInsetY);
  const [fade, setFade] = useState(STYLO_GLASS_LAB_CONFIG.fade);
  const [edgeAlpha, setEdgeAlpha] = useState(STYLO_GLASS_LAB_CONFIG.edgeAlpha);
  const [curve, setCurve] = useState(STYLO_GLASS_LAB_CONFIG.curve);
  const [showMaterialShadow, setShowMaterialShadow] = useState(true);
  const [shadowX, setShadowX] = useState(STYLO_GLASS_LAB_SHADOW.offsetX);
  const [shadowY, setShadowY] = useState(STYLO_GLASS_LAB_SHADOW.offsetY);
  const [shadowBlur, setShadowBlur] = useState(STYLO_GLASS_LAB_SHADOW.blur);
  const [shadowAlpha, setShadowAlpha] = useState(STYLO_GLASS_LAB_SHADOW.alpha);
  const [shadowSpread, setShadowSpread] = useState(STYLO_GLASS_LAB_SHADOW.spread);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showField, setShowField] = useState(true);
  const dragStateRef = useRef<DragState>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const applyPreset = (key: GlassDiffusionPresetKey) => {
    const next = GLASS_DIFFUSION_PRESETS[key];
    setPreset(key);
    setWidth(next.width);
    setHeight(next.height);
    setBlur(next.blur);
    setFillAlpha(next.fillAlpha);
    setSaturate(next.saturate);
    setFadeInsetX(next.fadeInsetX);
    setFadeInsetY(next.fadeInsetY);
    setFade(next.fade);
    setEdgeAlpha(next.edgeAlpha);
    setCurve(next.curve);
    if (key === "stylo") {
      setShadowX(STYLO_GLASS_LAB_SHADOW.offsetX);
      setShadowY(STYLO_GLASS_LAB_SHADOW.offsetY);
      setShadowBlur(STYLO_GLASS_LAB_SHADOW.blur);
      setShadowAlpha(STYLO_GLASS_LAB_SHADOW.alpha);
      setShadowSpread(STYLO_GLASS_LAB_SHADOW.spread);
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: posX,
      originY: posY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    const stage = stageRef.current;
    if (!state || !stage || state.pointerId !== event.pointerId) return;
    const bounds = stage.getBoundingClientRect();
    const maxX = Math.max(16, bounds.width - width - 16);
    const maxY = Math.max(16, bounds.height - height - 16);
    setPosX(Math.min(maxX, Math.max(16, state.originX + event.clientX - state.startX)));
    setPosY(Math.min(maxY, Math.max(16, state.originY + event.clientY - state.startY)));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) dragStateRef.current = null;
  };

  const geometryControls: RangeControl[] = [
    { label: "Position X", value: posX, min: 0, max: 960, step: 1, set: setPosX },
    { label: "Position Y", value: posY, min: 0, max: 720, step: 1, set: setPosY },
    { label: "Width", value: width, min: 160, max: 720, step: 2, set: setWidth },
    { label: "Height", value: height, min: 180, max: 900, step: 2, set: setHeight },
  ];
  const materialControls: RangeControl[] = [
    { label: "Blur", value: blur, min: 0, max: 96, step: 1, set: setBlur },
    { label: "Fill", value: fillAlpha, min: 0, max: 0.12, step: 0.002, set: setFillAlpha },
    { label: "Saturation", value: saturate, min: 80, max: 160, step: 1, set: setSaturate },
    { label: "Inset X", value: fadeInsetX, min: 0, max: 120, step: 1, set: setFadeInsetX },
    { label: "Inset Y", value: fadeInsetY, min: 0, max: 160, step: 1, set: setFadeInsetY },
    { label: "Edge blur", value: fade, min: 0, max: 48, step: 1, set: setFade },
    { label: "Edge alpha", value: edgeAlpha, min: 0.04, max: 0.56, step: 0.01, set: setEdgeAlpha },
    { label: "Curve", value: curve, min: 2.2, max: 5.4, step: 0.05, set: setCurve },
  ];
  const shadowControls: RangeControl[] = [
    { label: "Offset X", value: shadowX, min: -80, max: 80, step: 1, set: setShadowX },
    { label: "Offset Y", value: shadowY, min: -80, max: 120, step: 1, set: setShadowY },
    { label: "Blur", value: shadowBlur, min: 0, max: 96, step: 1, set: setShadowBlur },
    { label: "Alpha", value: shadowAlpha, min: 0, max: 0.48, step: 0.01, set: setShadowAlpha },
    { label: "Spread", value: shadowSpread, min: -48, max: 64, step: 1, set: setShadowSpread },
  ];

  if (!isOpen) return null;

  const renderControls = (controls: RangeControl[]) => controls.map((item) => (
    <label key={item.label} className="grid gap-2 py-2.5">
      <span className="flex items-center justify-between gap-3 text-[11px] text-[var(--app-text-secondary)]">
        <span>{item.label}</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--app-text-muted)]">
          {Number(item.value).toFixed(item.step < 1 ? 3 : 0)}
        </span>
      </span>
      <input
        type="range"
        min={item.min}
        max={item.max}
        step={item.step}
        value={item.value}
        onChange={(event) => item.set(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[var(--app-accent-strong)]"
      />
    </label>
  ));

  return (
    <div className="pointer-events-auto fixed inset-0 z-[85] flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--app-text-primary)]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-panel-strong)] px-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-muted)]">Visual Lab</div>
            <h1 className="truncate text-[18px] font-semibold tracking-[-0.025em]">Glass Lab</h1>
          </div>
          <div className="hidden h-7 w-px bg-[var(--app-border)] sm:block" />
          <div className="hidden items-center gap-1 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-1 sm:flex">
            {(Object.keys(presetLabels) as GlassDiffusionPresetKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`rounded-[6px] px-3 py-1.5 text-[11px] font-medium transition active:scale-[0.98] ${
                  preset === key
                    ? "bg-[var(--app-panel-strong)] text-[var(--app-text-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                    : "text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                }`}
              >
                {presetLabels[key]}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] active:scale-[0.96]"
          title="Close"
          aria-label="Close Glass Lab"
        >
          <X size={15} weight="bold" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_332px]">
        <main ref={stageRef} className="relative min-h-[420px] overflow-hidden bg-[#d8d8d2]">
          <div className="absolute inset-0 grid grid-cols-3" aria-hidden="true">
            <div className="bg-[#c6cbc8]" />
            <div className="bg-[#d9d5cc]" />
            <div className="bg-[#bfc6cb]" />
          </div>
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage: "linear-gradient(rgba(28,28,30,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(28,28,30,0.08) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
            aria-hidden="true"
          />
          <div className="absolute left-5 top-5 border-l border-[rgba(28,28,30,0.34)] pl-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgba(28,28,30,0.56)]">
            Material test field
          </div>

          <div
            className="absolute touch-none"
            style={{ left: posX, top: posY, width, height }}
          >
            <GlassDiffusionField
              className="absolute inset-0"
              width={width}
              height={height}
              config={{ blur, fillAlpha, saturate, fadeInsetX, fadeInsetY, fade, edgeAlpha, curve }}
              showField={showField}
              showBoundary={showBoundary}
              boundaryColor="rgba(28,28,30,0.42)"
            />
            {showMaterialShadow ? (
              <MaterialGlassShadow
                width={width}
                height={height}
                curve={curve}
                offsetX={shadowX}
                offsetY={shadowY}
                blur={shadowBlur}
                alpha={shadowAlpha}
                spread={shadowSpread}
              />
            ) : null}
            <div
              onPointerDown={beginDrag}
              onPointerMove={updateDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="relative flex h-full w-full cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <div className="flex items-center gap-2 rounded-full border border-[rgba(28,28,30,0.16)] bg-[rgba(255,255,255,0.78)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(28,28,30,0.62)] shadow-[0_4px_14px_rgba(28,28,30,0.08)]">
                <ArrowsOutCardinal size={13} />
                Drag field
              </div>
            </div>
          </div>
        </main>

        <aside className="scrollbar-none min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-panel-strong)]">
          <section className="border-b border-[var(--app-border)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold">Display</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-text-muted)]">Isolate the material layers shown on the test field.</p>
              </div>
              <CornersOut size={16} className="mt-0.5 text-[var(--app-text-muted)]" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {[
                { label: "Field", active: showField, toggle: setShowField },
                { label: "Boundary", active: showBoundary, toggle: setShowBoundary },
                { label: "Shadow", active: showMaterialShadow, toggle: setShowMaterialShadow },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.toggle((value) => !value)}
                  className={`rounded-[7px] border px-2 py-2 text-[10px] font-medium transition active:scale-[0.98] ${
                    item.active
                      ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                      : "border-[var(--app-border)] text-[var(--app-text-muted)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="border-b border-[var(--app-border)] px-5 py-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--app-text-muted)]">Geometry</div>
            <div className="divide-y divide-[var(--app-border)]">{renderControls(geometryControls)}</div>
          </section>
          <section className="border-b border-[var(--app-border)] px-5 py-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--app-text-muted)]">Material</div>
            <div className="divide-y divide-[var(--app-border)]">{renderControls(materialControls)}</div>
          </section>
          <section className="px-5 py-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--app-text-muted)]">Shadow</div>
            <div className="divide-y divide-[var(--app-border)]">{renderControls(shadowControls)}</div>
          </section>
        </aside>
      </div>
    </div>
  );
};
