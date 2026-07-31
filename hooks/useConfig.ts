import { AppConfig } from "../types";
import { DEEPSEEK_DEFAULT_MODEL, INITIAL_TEXT_CONFIG, INITIAL_VIDEO_CONFIG, INITIAL_MULTIMODAL_CONFIG, INITIAL_REMEMBER_KEYS, INITIAL_SYNC_KEYS, INITIAL_VIDU_CONFIG, VIDU_DEFAULT_BASE_URL } from "../constants";
import { usePersistedState } from "./usePersistedState";

export const useConfig = (key: string) => {
  const [config, setConfig] = usePersistedState<AppConfig>({
    key,
    initialValue: {
      textConfig: INITIAL_TEXT_CONFIG,
      videoConfig: INITIAL_VIDEO_CONFIG,
      multimodalConfig: INITIAL_MULTIMODAL_CONFIG,
      viduConfig: INITIAL_VIDU_CONFIG,
      videoProvider: "default",
      rememberApiKeys: INITIAL_REMEMBER_KEYS,
      syncApiKeys: INITIAL_SYNC_KEYS
    },
    deserialize: (value) => {
      const parsed = JSON.parse(value);
      const normalizeViduBaseUrl = (baseUrl?: string) => {
        if (typeof baseUrl !== "string" || !baseUrl.trim()) return VIDU_DEFAULT_BASE_URL;
        return baseUrl
          .trim()
          .replace("https://api.vidu.com/ent/v2", VIDU_DEFAULT_BASE_URL)
          .replace("http://api.vidu.com/ent/v2", VIDU_DEFAULT_BASE_URL);
      };
      const rememberApiKeys = parsed.rememberApiKeys ?? INITIAL_REMEMBER_KEYS;
      const syncApiKeys = parsed.syncApiKeys ?? INITIAL_SYNC_KEYS;
      const parsedTextConfig = parsed.textConfig || {};
      const legacyToolSettings = parsedTextConfig["qalamTools"];
      const migratedTextConfig = parsedTextConfig.styloTools || !legacyToolSettings
        ? parsedTextConfig
        : { ...parsedTextConfig, styloTools: legacyToolSettings };
      const safeText = rememberApiKeys ? migratedTextConfig : { ...migratedTextConfig, apiKey: '' };
      const allowedProviders = ["openrouter", "qwen"];
      const allowedAgentProviders = ["openrouter", "qwen", "ark", "deepseek"];
      const safeProvider =
        safeText?.provider && allowedProviders.includes(safeText.provider)
          ? safeText.provider
          : INITIAL_TEXT_CONFIG.provider;
      const safeAgentProvider =
        safeText?.agentProvider && allowedAgentProviders.includes(safeText.agentProvider)
          ? safeText.agentProvider
          : safeText?.provider && allowedProviders.includes(safeText.provider)
            ? safeText.provider
            : INITIAL_TEXT_CONFIG.agentProvider;
      const safeAgentModel = safeAgentProvider === "deepseek"
        ? DEEPSEEK_DEFAULT_MODEL
        : safeText?.agentModel;
      const safeVideo = rememberApiKeys ? parsed.videoConfig : { ...parsed.videoConfig, apiKey: '' };
      const rawMulti = rememberApiKeys ? parsed.multimodalConfig : { ...parsed.multimodalConfig, apiKey: '' };
      const normalizedMultiProvider = rawMulti?.provider === "wuyinkeji" ? "nanobanana" : rawMulti?.provider;
      const safeMulti = normalizedMultiProvider === "nanobanana"
        ? { ...rawMulti, provider: "nanobanana", apiKey: "" }
        : rawMulti;
      const rawVidu = rememberApiKeys
        ? (parsed.viduConfig || INITIAL_VIDU_CONFIG)
        : { ...(parsed.viduConfig || INITIAL_VIDU_CONFIG), apiKey: '' };
      const safeVidu = {
        ...INITIAL_VIDU_CONFIG,
        ...(rawVidu || {}),
        baseUrl: normalizeViduBaseUrl(rawVidu?.baseUrl),
      };
      return {
        syncApiKeys,
        rememberApiKeys,
        textConfig: {
          ...INITIAL_TEXT_CONFIG,
          ...(safeText || {}),
          provider: safeProvider,
          agentProvider: safeAgentProvider,
          agentModel: safeAgentModel,
        },
        videoConfig: { ...INITIAL_VIDEO_CONFIG, ...safeVideo },
        multimodalConfig: safeMulti?.provider
          ? { ...INITIAL_MULTIMODAL_CONFIG, ...safeMulti }
          : { ...INITIAL_MULTIMODAL_CONFIG },
        viduConfig: safeVidu,
        videoProvider: parsed.videoProvider || "default",
      } as AppConfig;
    },
    serialize: (value) => {
      const { rememberApiKeys = INITIAL_REMEMBER_KEYS, syncApiKeys = INITIAL_SYNC_KEYS } = value;
      // Cloud sync is independent from local persistence. Only the explicit
      // "remember locally" preference may put credentials in localStorage.
      const textConfig = rememberApiKeys ? value.textConfig : { ...value.textConfig, apiKey: '' };
      const videoConfig = rememberApiKeys ? value.videoConfig : { ...value.videoConfig, apiKey: '' };
      const multimodalConfig = rememberApiKeys ? value.multimodalConfig : { ...value.multimodalConfig, apiKey: '' };
      const viduConfig = rememberApiKeys ? value.viduConfig : { ...(value.viduConfig || INITIAL_VIDU_CONFIG), apiKey: '' };
      return JSON.stringify({
        syncApiKeys,
        rememberApiKeys,
        textConfig,
        videoConfig,
        multimodalConfig,
        viduConfig,
        videoProvider: value.videoProvider || "default",
      });
    }
  });

  return { config, setConfig };
};
