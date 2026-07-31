import { OpenAIProvider, type ModelSettings } from "@openai/agents";
import OpenAI from "openai";

export type StyloProviderRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  allowBrowserClient: boolean;
};

export type StyloProviderRuntime = {
  client: OpenAI;
  modelProvider: OpenAIProvider;
  modelSettings: ModelSettings;
  close: () => Promise<void>;
};

const buildModelSettings = (): ModelSettings => ({
  toolChoice: "auto",
  parallelToolCalls: false,
  store: false,
});

export const createStyloProviderRuntime = (config: StyloProviderRuntimeConfig): StyloProviderRuntime => {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    defaultHeaders: config.defaultHeaders,
    dangerouslyAllowBrowser: config.allowBrowserClient,
  });
  const modelProvider = new OpenAIProvider({
    openAIClient: client,
    useResponses: true,
  });
  return {
    client,
    modelProvider,
    modelSettings: buildModelSettings(),
    close: () => modelProvider.close(),
  };
};
