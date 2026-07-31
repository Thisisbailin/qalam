
import { ProjectData, TextServiceConfig, VideoServiceConfig, MultimodalConfig, ViduServiceConfig, StyloToolSettings } from './types';

export const INITIAL_PROJECT_DATA: ProjectData = {
  fileName: '',
  rawScript: '',
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: {
    viewport: null,
  },
  flow: {
    flowNodes: [],
    links: [],
  },
  activeFlowProjectId: "flow-project-main",
  flowProjects: [],
  phase5Usage: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },

  stats: {
    context: { total: 0, success: 0, error: 0 }
  }
};

export const QWEN_RESPONSES_BASE_URL = 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1';
export const ARK_RESPONSES_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const OPENROUTER_RESPONSES_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEEPSEEK_RESPONSES_BASE_URL = 'https://api.deepseek.com';
export const QWEN_DEFAULT_MODEL = 'qwen-plus';
export const ARK_DEFAULT_MODEL = 'doubao-seed-1-6-250615';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
export const QWEN_WAN_IMAGE_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const QWEN_WAN_VIDEO_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
export const QWEN_WAN_IMAGE_MODEL = 'wan2.6-image';
export const QWEN_WAN_VIDEO_MODEL = 'wan2.6-i2v';
export const QWEN_WAN_REFERENCE_VIDEO_MODEL = 'wan2.7-r2v';
export const NANOBANANA_PRO_ENDPOINT = 'https://api.wuyinkeji.com/api/async/image_nanoBanana_pro';
export const WUYINKEJI_ASYNC_DETAIL_ENDPOINT = 'https://api.wuyinkeji.com/api/async/detail';
export const NANOBANANA_PRO_MODEL = 'nano banana pro';
export const NANOBANANA_IDENTITY_PROMPT = '生成全身三视图以及一张面部特写(最左边占满三分之一的位置是超大的面部特写，右边三分之二放正视图、侧视图、后视图，纯白背景,';

export const DEFAULT_STYLO_TOOL_SETTINGS: StyloToolSettings = {
  projectData: {
    enabled: true,
  },
  workflowBuilder: {
    enabled: true,
  },
  runtimeIntelligence: {
    enabled: true,
    webSearchEnabled: true,
    githubAccessEnabled: true,
  },
};

export const INITIAL_TEXT_CONFIG: TextServiceConfig = {
  provider: 'qwen',
  agentProvider: 'deepseek',
  baseUrl: QWEN_RESPONSES_BASE_URL,
  apiKey: '',
  model: QWEN_DEFAULT_MODEL,
  agentBaseUrl: DEEPSEEK_RESPONSES_BASE_URL,
  agentModel: DEEPSEEK_DEFAULT_MODEL,
  workModel: '',
  workBaseUrl: '',
  qwenModels: [],
  voiceDesignModel: "",
  voiceDubbingModel: "",
  styloTools: DEFAULT_STYLO_TOOL_SETTINGS,
};

export const VIDU_DEFAULT_BASE_URL = "https://api.vidu.cn/ent/v2";
export const SEEDANCE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const SEEDANCE_DEFAULT_MODEL = "doubao-seedance-2-0-260128";
export const SEEDANCE_FAST_MODEL = "doubao-seedance-2-0-fast-260128";

export const INITIAL_VIDEO_CONFIG: VideoServiceConfig = {
  baseUrl: QWEN_WAN_VIDEO_ENDPOINT,
  apiKey: '',
  model: QWEN_WAN_REFERENCE_VIDEO_MODEL
};

export const INITIAL_VIDU_CONFIG: ViduServiceConfig = {
  baseUrl: VIDU_DEFAULT_BASE_URL,
  apiKey: '',
  defaultModel: 'viduq3'
};

export const INITIAL_MULTIMODAL_CONFIG: MultimodalConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  provider: 'standard'
};

export const INITIAL_REMEMBER_KEYS = false;
export const INITIAL_SYNC_KEYS = false;
