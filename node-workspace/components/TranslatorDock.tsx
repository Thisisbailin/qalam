import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowsLeftRight,
  Check,
  CircleNotch,
  Copy,
  Cpu,
  Gauge,
  NotePencil,
  PaperPlaneTilt,
  Translate,
  X,
} from "@phosphor-icons/react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  DEFAULT_TRANSLATOR_PREFERENCES,
  TRANSLATOR_DEFAULT_SYSTEM_PROMPT,
  TRANSLATOR_LANGS,
  TRANSLATOR_MAX_INPUT_LENGTH,
  TRANSLATOR_MODEL_LABEL,
  TRANSLATOR_REASONING_EFFORTS,
  translateText,
  type TranslatorPreferences,
} from "../../services/translatorService";

export const TRANSLATOR_DOCK_WIDTH = 360;

type Props = {
  onClose?: () => void;
};

type TranslateStatus = "idle" | "loading" | "done" | "error";
type OpenControl = "source" | "target" | "system" | null;

const langLabel = (value: TranslatorPreferences["sourceLang"]) =>
  TRANSLATOR_LANGS.find((item) => item.value === value)?.label || value;

export const TranslatorDock: React.FC<Props> = ({ onClose }) => {
  const [prefs, setPrefs] = usePersistedState<TranslatorPreferences>({
    key: "manus.translator.preferences.v1",
    initialValue: DEFAULT_TRANSLATOR_PREFERENCES,
    debounceMs: 220,
  });
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [status, setStatus] = useState<TranslateStatus>("idle");
  const [error, setError] = useState("");
  const [openControl, setOpenControl] = useState<OpenControl>(null);
  // 系统提示词：默认内置固定版本；用户可临时自定义，仅当前会话生效，不持久化。
  const [systemPrompt, setSystemPrompt] = useState(TRANSLATOR_DEFAULT_SYSTEM_PROMPT);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isSystemPromptCustomized = systemPrompt.trim() !== TRANSLATOR_DEFAULT_SYSTEM_PROMPT.trim();

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!openControl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenControl(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openControl]);

  const submit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || status === "loading") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError("");
    setOutputText("");
    setOpenControl(null);
    try {
      const result = await translateText(
        {
          text,
          sourceLang: prefs.sourceLang,
          targetLang: prefs.targetLang,
          reasoningEffort: prefs.reasoningEffort,
          systemPrompt: systemPrompt.trim() || undefined,
        },
        controller.signal
      );
      setOutputText(result.text);
      setStatus("done");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError((err as Error)?.message || "翻译失败，请稍后重试。");
      setStatus("error");
    }
  }, [inputText, prefs.reasoningEffort, prefs.sourceLang, prefs.targetLang, status, systemPrompt]);

  const copyOutput = useCallback(async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
    } catch {
      // 剪贴板不可用时静默失败，不影响主流程
    }
  }, [outputText]);

  const clearOutput = useCallback(() => {
    abortRef.current?.abort();
    setOutputText("");
    setError("");
    setStatus("idle");
  }, []);

  const swapLangs = useCallback(() => {
    setPrefs((prev) => ({
      ...prev,
      sourceLang: prev.targetLang,
      targetLang: prev.sourceLang === "auto" ? "en" : prev.sourceLang,
    }));
  }, [setPrefs]);

  const effortIndex = TRANSLATOR_REASONING_EFFORTS.findIndex(
    (item) => item.value === prefs.reasoningEffort
  );
  const cycleEffort = useCallback(() => {
    const next = TRANSLATOR_REASONING_EFFORTS[(effortIndex + 1) % TRANSLATOR_REASONING_EFFORTS.length];
    setPrefs((prev) => ({ ...prev, reasoningEffort: next.value }));
  }, [effortIndex, setPrefs]);

  const toggleControl = useCallback((control: Exclude<OpenControl, null>) => {
    setOpenControl((current) => (current === control ? null : control));
  }, []);

  const isBusy = status === "loading";
  const effortLabel = TRANSLATOR_REASONING_EFFORTS[effortIndex]?.label || "标准";
  const renderedOutput = React.useMemo(() => {
    if (!outputText) return null;
    const noteIndex = outputText.indexOf("【译注】");
    if (noteIndex < 0) return { translation: outputText.trim(), note: "" };
    return {
      translation: outputText.slice(0, noteIndex).trim(),
      note: outputText.slice(noteIndex).trim(),
    };
  }, [outputText]);

  return (
    <aside className="translator-dock" aria-label="翻译器">
      <section className="translator-dock__card is-output">
        <header className="translator-dock__head">
          <span className="translator-dock__title">
            <Translate size={13} weight="bold" />
            输出
          </span>
          <div className="translator-dock__head-actions">
            {status === "done" && outputText ? (
              <button type="button" onClick={() => void copyOutput()} title="复制译文" aria-label="复制译文">
                <Copy size={14} />
              </button>
            ) : null}
            {outputText || status === "error" ? (
              <button type="button" onClick={clearOutput} title="清空输出" aria-label="清空输出">
                <X size={14} />
              </button>
            ) : null}
          </div>
        </header>
        <div
          className={`translator-dock__output ${status === "error" ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {isBusy ? (
            <span className="translator-dock__pending">
              <CircleNotch size={16} className="is-spinning" />
              正在翻译…
            </span>
          ) : status === "error" ? (
            <span className="translator-dock__error">{error}</span>
          ) : renderedOutput ? (
            <div className="translator-dock__result">
              <p className="translator-dock__text">{renderedOutput.translation}</p>
              {renderedOutput.note ? <p className="translator-dock__note">{renderedOutput.note}</p> : null}
            </div>
          ) : (
            <span className="translator-dock__placeholder">译文将显示在这里</span>
          )}
        </div>
      </section>

      <section className="translator-dock__card is-input">
        <header className="translator-dock__head">
          <span className="translator-dock__title">
            <NotePencil size={13} weight="bold" />
            输入
          </span>
          <div className="translator-dock__head-actions">
            <button type="button" onClick={swapLangs} title="互换输入输出语种" aria-label="互换输入输出语种">
              <ArrowsLeftRight size={14} />
            </button>
            <button
              type="button"
              className="translator-dock__submit"
              onClick={() => void submit()}
              disabled={!inputText.trim() || isBusy}
              title="翻译 (Enter)"
            >
              {isBusy ? <CircleNotch size={14} className="is-spinning" /> : <PaperPlaneTilt size={14} weight="fill" />}
              翻译
            </button>
          </div>
        </header>
        <textarea
          ref={inputRef}
          className="translator-dock__input"
          value={inputText}
          maxLength={TRANSLATOR_MAX_INPUT_LENGTH}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="输入要翻译的文本…"
          aria-label="待翻译文本"
        />
        <span className="translator-dock__input-count">
          {inputText.length}/{TRANSLATOR_MAX_INPUT_LENGTH}
        </span>

        {openControl ? (
          <>
            <div className="translator-dock__backdrop" onClick={() => setOpenControl(null)} aria-hidden="true" />
            {openControl === "source" || openControl === "target" ? (
              <div
                className="translator-dock__popover"
                role="listbox"
                aria-label={openControl === "source" ? "输入语种" : "输出语种"}
              >
                {(openControl === "target"
                  ? TRANSLATOR_LANGS.filter((lang) => lang.value !== "auto")
                  : TRANSLATOR_LANGS
                ).map((lang) => {
                  const isActive =
                    openControl === "source"
                      ? prefs.sourceLang === lang.value
                      : prefs.targetLang === lang.value;
                  return (
                    <button
                      key={lang.value}
                      type="button"
                      className={isActive ? "is-active" : ""}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setPrefs((prev) =>
                          openControl === "source"
                            ? { ...prev, sourceLang: lang.value }
                            : { ...prev, targetLang: lang.value }
                        );
                        setOpenControl(null);
                      }}
                    >
                      <span>{lang.label}</span>
                      {isActive ? <Check size={13} weight="bold" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="translator-dock__popover translator-dock__system-editor">
                <label htmlFor="translator-system-prompt">系统提示词</label>
                <textarea
                  id="translator-system-prompt"
                  value={systemPrompt}
                  maxLength={2000}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="临时覆盖默认提示词，仅当前会话生效。"
                  aria-label="自定义系统提示词"
                />
                <small>默认已内置剧本翻译提示词；此处为临时自定义，仅当前会话生效，恢复默认后回到内置版本。</small>
                <div className="translator-dock__system-actions">
                  <button type="button" onClick={() => setSystemPrompt(TRANSLATOR_DEFAULT_SYSTEM_PROMPT)}>
                    恢复默认
                  </button>
                  <button type="button" className="is-primary" onClick={() => setOpenControl(null)}>
                    完成
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}

        <footer className="translator-dock__controls">
          <button
            type="button"
            className={openControl === "source" ? "is-active" : ""}
            onClick={() => toggleControl("source")}
            title={`输入语种：${langLabel(prefs.sourceLang)}`}
            aria-label="选择输入语种"
          >
            <Translate size={15} />
          </button>
          <button
            type="button"
            className={openControl === "target" ? "is-active" : ""}
            onClick={() => toggleControl("target")}
            title={`输出语种：${langLabel(prefs.targetLang)}`}
            aria-label="选择输出语种"
          >
            <ArrowsLeftRight size={15} />
          </button>
          <span className="translator-dock__model" title="默认模型，不可更换">
            <Cpu size={15} />
            <small>{TRANSLATOR_MODEL_LABEL}</small>
          </span>
          <button
            type="button"
            onClick={cycleEffort}
            title={`推理强度：${effortLabel}`}
            aria-label="切换推理强度"
          >
            <Gauge size={15} />
            <span className="translator-dock__effort-dots" aria-hidden="true">
              {TRANSLATOR_REASONING_EFFORTS.map((item, index) => (
                <i key={item.value} className={index <= effortIndex ? "is-on" : ""} />
              ))}
            </span>
          </button>
          <button
            type="button"
            className={`${openControl === "system" ? "is-active" : ""} ${isSystemPromptCustomized ? "has-value" : ""}`}
            onClick={() => toggleControl("system")}
            title={isSystemPromptCustomized ? "系统提示词：已临时自定义" : "系统提示词：默认内置"}
            aria-label="自定义系统提示词"
          >
            <NotePencil size={15} />
            {isSystemPromptCustomized ? <i className="translator-dock__value-dot" aria-hidden="true" /> : null}
          </button>
          <button type="button" className="translator-dock__close" onClick={onClose} title="收起翻译器" aria-label="收起翻译器">
            <X size={15} />
          </button>
        </footer>
      </section>
    </aside>
  );
};
