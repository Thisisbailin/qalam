import type { StyloAgentBridge } from "../bridge/styloBridge";
import { readBoundedResponseText } from "./httpSafety";

const GITHUB_OWNER = "Thisisbailin";
const GITHUB_REPO = "stylo";
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const DEFAULT_MAX_CHARS = 16000;
const DEFAULT_MAX_ITEMS = 200;

type GithubRepositoryResponse = {
  default_branch?: string;
  html_url?: string;
  pushed_at?: string | null;
  updated_at?: string | null;
  private?: boolean;
};

type GithubBranchResponse = {
  commit?: {
    sha?: string;
    html_url?: string;
  };
};

type GithubTreeItem = {
  path?: string;
  type?: string;
  size?: number;
  sha?: string;
};

type GithubTreeResponse = {
  sha?: string;
  truncated?: boolean;
  tree?: GithubTreeItem[];
};

type GithubTreeItemWithPath = GithubTreeItem & { path: string };

const hasTreePath = (item: GithubTreeItem): item is GithubTreeItemWithPath =>
  typeof item.path === "string" && item.path.length > 0;

const githubRepositoryParameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "tree", "read", "search"],
      description:
        "Repository action. status reads latest default-branch metadata; tree lists repository files; read fetches any file path; search searches file paths and optionally file contents.",
    },
    path: {
      type: "string",
      description: "Repository-relative path for action=read, or optional directory/file prefix for action=tree.",
    },
    query: {
      type: "string",
      description: "Search query for action=search. Matches file paths and, when include_content=true, file contents.",
    },
    ref: {
      type: "string",
      description: "Optional branch, tag, or commit SHA. Defaults to the repository default branch.",
    },
    include_content: {
      type: "boolean",
      description: "For action=search, also read text files and search inside contents. Use only when source-level evidence is needed.",
    },
    max_chars: {
      type: "integer",
      description: "Maximum characters to return for file contents or large text output.",
    },
    max_items: {
      type: "integer",
      description: "Maximum tree/search items to return.",
    },
  },
  additionalProperties: false,
  required: ["action"],
} as const;

const trim = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toPositiveInteger = (value: unknown, fallback: number, maximum: number) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return Math.min(value, maximum);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, maximum);
  }
  return fallback;
};

const parseArgs = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("access_github_repository 需要对象参数。");
  }
  const raw = input as Record<string, unknown>;
  const action = trim(raw.action);
  if (!["status", "tree", "read", "search"].includes(action)) {
    throw new Error(`access_github_repository 不支持 action=${action || "(empty)"}`);
  }
  return {
    action: action as "status" | "tree" | "read" | "search",
    path: trim(raw.path) || undefined,
    query: trim(raw.query) || undefined,
    ref: trim(raw.ref) || undefined,
    includeContent: raw.include_content === true || raw.includeContent === true,
    maxChars: toPositiveInteger(raw.max_chars ?? raw.maxChars, DEFAULT_MAX_CHARS, 32_000),
    maxItems: toPositiveInteger(raw.max_items ?? raw.maxItems, DEFAULT_MAX_ITEMS, 200),
  };
};

const fetchJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }
  return JSON.parse(await readBoundedResponseText(response, { signal })) as T;
};

const fetchRepoStatus = async (signal?: AbortSignal) => {
  const repo = await fetchJson<GithubRepositoryResponse>(GITHUB_API_BASE, signal);
  const branch = repo.default_branch || "main";
  const branchInfo = await fetchJson<GithubBranchResponse>(
    `${GITHUB_API_BASE}/branches/${encodeURIComponent(branch)}`,
    signal,
  );
  return {
    repository: repo.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
    default_branch: branch,
    pushed_at: repo.pushed_at || null,
    updated_at: repo.updated_at || null,
    private: Boolean(repo.private),
    default_branch_commit_sha: branchInfo?.commit?.sha || null,
    default_branch_commit_url: branchInfo?.commit?.html_url || null,
  };
};

const resolveRef = async (requestedRef?: string, signal?: AbortSignal) =>
  requestedRef || (await fetchRepoStatus(signal)).default_branch;

const fetchTree = async (ref?: string, signal?: AbortSignal) => {
  const resolvedRef = await resolveRef(ref, signal);
  const tree = await fetchJson<GithubTreeResponse>(
    `${GITHUB_API_BASE}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`,
    signal,
  );
  return {
    ref: resolvedRef,
    sha: tree.sha || null,
    truncated: Boolean(tree.truncated),
    items: Array.isArray(tree.tree) ? tree.tree : [],
  };
};

const isProbablyTextPath = (path: string) =>
  !/\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|mp4|mov|mp3|wav|woff2?|ttf|otf)$/i.test(path);

const clipText = (value: string, maxChars: number) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;

const readFile = async (path: string, ref?: string, maxChars = DEFAULT_MAX_CHARS, signal?: AbortSignal) => {
  if (!path) throw new Error("action=read 需要 path。");
  const resolvedRef = await resolveRef(ref, signal);
  const url = `${GITHUB_RAW_BASE}/${encodeURIComponent(resolvedRef)}/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`GitHub raw file request failed: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const text = await readBoundedResponseText(response, { signal });
  return {
    ref: resolvedRef,
    path,
    source_url: url,
    content_type: contentType,
    truncated: text.length > maxChars,
    content: clipText(text, maxChars),
  };
};

const listTree = async (pathPrefix: string | undefined, ref: string | undefined, maxItems: number, signal?: AbortSignal) => {
  const tree = await fetchTree(ref, signal);
  const prefix = (pathPrefix || "").replace(/^\/+|\/+$/g, "");
  const items = tree.items
    .filter(hasTreePath)
    .filter((item) => !prefix || item.path === prefix || item.path.startsWith(`${prefix}/`))
    .slice(0, maxItems)
    .map((item) => ({
      path: item.path,
      type: item.type,
      size: item.size ?? null,
      sha: item.sha || null,
    }));
  return {
    ref: tree.ref,
    sha: tree.sha,
    truncated_by_github: tree.truncated,
    path_prefix: prefix || null,
    count: items.length,
    items,
  };
};

const searchRepository = async (input: {
  query?: string;
  path?: string;
  ref?: string;
  includeContent: boolean;
  maxItems: number;
  maxChars: number;
  signal?: AbortSignal;
}) => {
  if (!input.query) throw new Error("action=search 需要 query。");
  const normalizedQuery = input.query.toLowerCase();
  const tree = await fetchTree(input.ref, input.signal);
  const prefix = (input.path || "").replace(/^\/+|\/+$/g, "");
  const pathMatches = tree.items
    .filter(hasTreePath)
    .filter((item) => item.type === "blob")
    .filter((item) => !prefix || item.path === prefix || item.path.startsWith(`${prefix}/`))
    .filter((item) => item.path.toLowerCase().includes(normalizedQuery));

  const contentMatches: Array<{ path: string; source_url: string; snippet: string }> = [];
  if (input.includeContent) {
    const candidates = tree.items
      .filter(hasTreePath)
      .filter((item) => item.type === "blob")
      .filter((item) => !prefix || item.path === prefix || item.path.startsWith(`${prefix}/`))
      .filter((item) => isProbablyTextPath(item.path))
      .slice(0, Math.max(input.maxItems, 80));
    for (const item of candidates) {
      if (contentMatches.length >= input.maxItems) break;
      try {
        const file = await readFile(item.path, tree.ref, Math.min(input.maxChars, 5000), input.signal);
        const index = file.content.toLowerCase().indexOf(normalizedQuery);
        if (index < 0) continue;
        const start = Math.max(0, index - 220);
        const end = Math.min(file.content.length, index + input.query.length + 320);
        contentMatches.push({
          path: item.path,
          source_url: file.source_url,
          snippet: file.content.slice(start, end),
        });
      } catch {
        // Ignore unreadable files during broad repository search.
      }
    }
  }

  return {
    ref: tree.ref,
    query: input.query,
    path_prefix: prefix || null,
    path_matches: pathMatches.slice(0, input.maxItems).map((item) => ({
      path: item.path,
      type: item.type,
      size: item.size ?? null,
      sha: item.sha || null,
    })),
    content_matches: contentMatches,
    include_content: input.includeContent,
  };
};

export const accessGithubRepositoryToolDef = {
  name: "access_github_repository",
  description:
    "Read the live Stylo GitHub repository with broad read-only access: latest default-branch status, recursive file tree, arbitrary file contents, and repository search.",
  parameters: githubRepositoryParameters,
  execute: async (input: unknown, _bridge: StyloAgentBridge, options?: { signal?: AbortSignal }) => {
    const args = parseArgs(input);
    if (args.action === "status") {
      return {
        target: "github_repository",
        action: "status",
        item: await fetchRepoStatus(options?.signal),
      };
    }
    if (args.action === "tree") {
      return {
        target: "github_repository",
        action: "tree",
        item: await listTree(args.path, args.ref, args.maxItems, options?.signal),
      };
    }
    if (args.action === "read") {
      return {
        target: "github_repository",
        action: "read",
        item: await readFile(args.path || "", args.ref, args.maxChars, options?.signal),
      };
    }
    return {
      target: "github_repository",
      action: "search",
      item: await searchRepository({
        query: args.query,
        path: args.path,
        ref: args.ref,
        includeContent: args.includeContent,
        maxItems: args.maxItems,
        maxChars: args.maxChars,
        signal: options?.signal,
      }),
    };
  },
  summarize: (output: any) => {
    if (output?.action === "read") return `已读取 GitHub 源码: ${output?.item?.path || "file"}`;
    if (output?.action === "tree") return `已读取 GitHub 文件树: ${output?.item?.count || 0} 项`;
    if (output?.action === "search") return `已搜索 GitHub 仓库: ${output?.item?.query || ""}`;
    return "已读取 GitHub 仓库状态";
  },
};
