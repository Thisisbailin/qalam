import {
  DesignAssetItem,
  Episode,
  FlowProject,
  ProjectData,
  ProjectRoleIdentity,
  ProjectRolePortrait,
} from "../types";
import { ensureStableId, ensureTypedStableId } from "./id";
import { INITIAL_PROJECT_DATA } from "../constants";
import {
  applyRolePortraits,
  buildPortraitMention,
  buildRoleMention,
  MAX_ROLE_PORTRAITS,
  normalizeRolePortraits,
  sanitizeIdentityToken,
  slugifyIdentityKey,
} from "./projectRoles";
import { normalizeNodeFlowNode } from "../node-workspace/nodeflow/state";
import { normalizeManusFolderStructure } from "../node-workspace/manus/folder";
import { normalizeFlowProjectDuration } from "./flowProject";
import { normalizeCineworWorkspace } from "./cineworWorkspace";

const HANDLE_TYPES = new Set(["image", "text", "audio", "video", "multi", "contains"]);

const normalizeHandleType = (value: unknown) =>
  typeof value === "string" && HANDLE_TYPES.has(value) ? value as any : undefined;

const stripConflictMarkers = (value: string) => {
  const cleaned = value
    .replace(/^[ \t]*<<<REMOTE VERSION>>>[ \t]*\n?/gm, "")
    .replace(/^[ \t]*<<<LOCAL VERSION>>>[ \t]*\n?/gm, "");
  return cleaned.replace(/\n{3,}/g, "\n\n");
};

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === "string") return stripConflictMarkers(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)])
    );
  }
  return value;
};

const toSafeString = (value: unknown, fallback = "") => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const buildMention = (name: string) => buildRoleMention(name);

const toOptionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

const normalizeEpisode = (episode: any): Episode => {
  if (!episode || typeof episode !== "object") return episode as Episode;
  return {
    id: Number(episode.id),
    title: toSafeString(episode.title),
    content: toSafeString(episode.content),
    scenes: Array.isArray(episode.scenes) ? episode.scenes : [],
    characters: Array.isArray(episode.characters) ? episode.characters.map((name: any) => toSafeString(name)).filter(Boolean) : undefined,
    status:
      episode.status === "generating" ||
      episode.status === "completed" ||
      episode.status === "error"
        ? episode.status
        : "pending",
    errorMsg: toOptionalString(episode.errorMsg),
  };
};

const normalizeCanvasPosition = (value: any, fallback = { x: 0, y: 0 }) => ({
  x: typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : fallback.x,
  y: typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : fallback.y,
});

const normalizeCanvasViewport = (value: any): ProjectData["canvas"]["viewport"] => {
  if (!value || typeof value !== "object") return null;
  const x = typeof value.x === "number" && Number.isFinite(value.x) ? value.x : 0;
  const y = typeof value.y === "number" && Number.isFinite(value.y) ? value.y : 0;
  const zoom = typeof value.zoom === "number" && Number.isFinite(value.zoom) ? value.zoom : 1;
  return { x, y, zoom: Math.max(0.1, Math.min(8, zoom)) };
};


const normalizeFlow = (value: any): NonNullable<ProjectData["flow"]> => {
  const revision = typeof value?.revision === "number" && Number.isFinite(value.revision) ? value.revision : 0;

  const usedNodeIds = new Set<string>();
  const flowNodes = Array.isArray(value?.flowNodes)
    ? value.flowNodes
        .map(normalizeNodeFlowNode)
        .filter(Boolean)
        .map((node: any) => {
          const baseId = node.id;
          let id = baseId;
          let duplicateIndex = 2;
          while (usedNodeIds.has(id)) {
            id = `${baseId}-${duplicateIndex}`;
            duplicateIndex += 1;
          }
          usedNodeIds.add(id);
          return id === baseId ? node : { ...node, id };
        })
    : [];

  const nodeIds = new Set<string>([
    ...flowNodes.map((node: any) => node.id),
  ]);
  const links = Array.isArray(value?.links)
    ? value.links
        .map((link: any) => ({
          id: ensureStableId(link?.id, "script-link"),
          source: toSafeString(link?.source),
          target: toSafeString(link?.target),
          sourceHandle: normalizeHandleType(link?.sourceHandle),
          targetHandle: normalizeHandleType(link?.targetHandle),
          data: link?.data && typeof link.data === "object" ? sanitizeValue(link.data) as Record<string, unknown> : undefined,
        }))
        .filter((link: any) => nodeIds.has(link.source) && nodeIds.has(link.target))
    : [];

  const graphLinks = Array.isArray(value?.graphLinks) ? value.graphLinks : [];
  const globalAssetHistory = Array.isArray(value?.globalAssetHistory) ? value.globalAssetHistory : [];
  const linkStyle = value?.linkStyle === "angular" ? "angular" : "curved";
  const activeView = typeof value?.activeView === "string" ? value.activeView : null;

  const manusStructure = normalizeManusFolderStructure(flowNodes as any, links);

  return {
    revision,
    flowNodes: manusStructure.nodes as any,
    graphLinks,
    globalAssetHistory,
    linkStyle,
    activeView,
    links: manusStructure.links,
  };
};

const FLOW_PROJECT_COLORS = ["amber", "moss", "blue", "rose", "violet", "slate"];
const MAX_FLOW_PROJECTS = 24;

const normalizeFlowProjects = (
  value: unknown,
  activeFlow: NonNullable<ProjectData["flow"]>,
  activeProjectId?: string,
  fileName?: string
) => {
  const now = Date.now();
  const rawProjects = Array.isArray(value) ? value.slice(0, MAX_FLOW_PROJECTS) : [];
  const usedProjectIds = new Set<string>();
  const projects = rawProjects.map((project: any, index): FlowProject => {
    const flow = normalizeFlow(project?.flow);
    const baseId = toSafeString(project?.id || `flow-project-${index + 1}`);
    let id = baseId;
    let duplicateIndex = 2;
    while (usedProjectIds.has(id)) {
      id = `${baseId}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedProjectIds.add(id);
    const durationMin = normalizeFlowProjectDuration(project?.durationMin, 120);
    return {
      id,
      title: toSafeString(project?.title || (index === 0 ? fileName || "主项目" : `项目 ${index + 1}`)),
      color: toSafeString(project?.color || FLOW_PROJECT_COLORS[index % FLOW_PROJECT_COLORS.length]),
      durationMin,
      rootNodeId: toSafeString(project?.rootNodeId || `project-root-${id}`),
      createdAt: typeof project?.createdAt === "number" ? project.createdAt : now,
      updatedAt: typeof project?.updatedAt === "number" ? project.updatedAt : now,
      roles: Array.isArray(project?.roles) ? project.roles : undefined,
      designAssets: Array.isArray(project?.designAssets) ? project.designAssets : undefined,
      cinewor: normalizeCineworWorkspace(project?.cinewor),
      rawScript: typeof project?.rawScript === "string" ? project.rawScript : undefined,
      episodes: Array.isArray(project?.episodes) ? project.episodes.map(normalizeEpisode) : undefined,
      canvas: project?.canvas && typeof project.canvas === "object"
        ? {
            ...INITIAL_PROJECT_DATA.canvas,
            ...project.canvas,
            viewport: normalizeCanvasViewport(project.canvas.viewport),
          }
        : undefined,
      phase5Usage: project?.phase5Usage,
      stats: project?.stats,
      flow,
    };
  });

  const fallbackId = toSafeString(activeProjectId || projects[0]?.id || "flow-project-main");
  const activeId = projects.some((project) => project.id === fallbackId) ? fallbackId : projects[0]?.id || fallbackId;
  const activeDuration = normalizeFlowProjectDuration(projects.find((project) => project.id === activeId)?.durationMin, 120);
  const normalizedActiveFlow = activeFlow;

  const nextProjects = projects.length
    ? projects.map((project) =>
        project.id === activeId
          ? {
              ...project,
              durationMin: activeDuration,
              rootNodeId: project.rootNodeId || `project-root-${project.id}`,
              updatedAt: project.updatedAt,
              flow: normalizedActiveFlow,
            }
          : project
      )
    : [
        {
          id: activeId,
          title: fileName || "主项目",
          color: FLOW_PROJECT_COLORS[0],
          durationMin: activeDuration,
          rootNodeId: `project-root-${activeId}`,
          createdAt: now,
          updatedAt: now,
          flow: normalizedActiveFlow,
        },
      ];

  return {
    activeFlowProjectId: activeId,
    flowProjects: nextProjects.slice(0, MAX_FLOW_PROJECTS),
    flow: normalizedActiveFlow,
  };
};

const normalizeAliases = (values: unknown[], seed: string[]) => {
  const seen = new Set<string>();
  const items = [...seed, ...values.map((item) => toSafeString(item).trim()).filter(Boolean)];
  return items
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((value) => ({
      id: ensureStableId(undefined, "alias"),
      value,
      normalized: value.toLowerCase(),
    }));
};

const normalizePortrait = (
  portrait: any,
  roleMention: string,
  fallbackName: string,
  fallbackImageUrl?: string,
  allowEmptyImage = false
): ProjectRolePortrait | null => {
  const imageUrl = toOptionalString(portrait?.imageUrl || portrait?.url || fallbackImageUrl);
  if (!imageUrl && !allowEmptyImage) return null;
  const name = sanitizeIdentityToken(
    toSafeString(portrait?.name || portrait?.label || portrait?.title || fallbackName),
    fallbackName
  );
  return {
    id: ensureStableId(portrait?.id, "portrait"),
    name,
    mention: buildPortraitMention(roleMention, name),
    imageUrl: imageUrl || "",
    createdAt: typeof portrait?.createdAt === "number" ? portrait.createdAt : Date.now(),
    summary: toOptionalString(portrait?.summary || portrait?.description),
    isPrimary: !!portrait?.isPrimary,
  };
};

const normalizePortraits = (role: any, mention: string): ProjectRolePortrait[] => {
  const rawPortraits = Array.isArray(role?.portraits)
    ? role.portraits
    : Array.isArray(role?.photos)
      ? role.photos
      : Array.isArray(role?.images)
        ? role.images
        : [];

  const portraits = rawPortraits
    .map((portrait: any, index: number) => normalizePortrait(portrait, mention, index === 0 ? "normal" : `look${index + 1}`, undefined, true))
    .filter((portrait: ProjectRolePortrait | null): portrait is ProjectRolePortrait => portrait !== null);

  if (portraits.length > 0) {
    return normalizeRolePortraits(
      {
        mention,
        name: toSafeString(role?.name || role?.displayName || mention || "身份"),
      } as ProjectRoleIdentity,
      portraits.slice(0, MAX_ROLE_PORTRAITS)
    );
  }

  const fallbackPortrait = normalizePortrait(
    {
      id: undefined,
      name: "normal",
      imageUrl: role?.avatarUrl,
      createdAt: Date.now(),
      isPrimary: true,
    },
    mention,
    "normal",
    toOptionalString(role?.avatarUrl)
  );

  return fallbackPortrait ? [fallbackPortrait] : [];
};

const normalizeRoleIdentity = (role: any): ProjectRoleIdentity => {
  const rawMention = toSafeString(role?.mention).replace(/^@/, "");
  const mentionRoot = rawMention.includes("_") ? rawMention.split("_")[0] : rawMention;
  const name = toSafeString(role?.name || role?.displayName || mentionRoot || "身份");
  const mention = mentionRoot || buildMention(name);
  const kind = role?.kind === "scene" ? "scene" : "person";
  const tone = role?.tone === "sky" ? "sky" : "emerald";
  const portraits = normalizePortraits(role, mention);
  const aliases = normalizeAliases(Array.isArray(role?.aliases) ? role.aliases.map((item: any) => item?.value ?? item) : [], [
    name,
    `@${mention}`,
  ]);

  return {
    id: ensureTypedStableId(role?.id, "role"),
    name,
    displayName: toSafeString(role?.displayName || name),
    mention,
    slug: toOptionalString(role?.slug) || slugifyIdentityKey(mention, name),
    kind,
    tone,
    isMain: typeof role?.isMain === "boolean" ? role.isMain : undefined,
    isCore: typeof role?.isCore === "boolean" ? role.isCore : undefined,
    title: toOptionalString(role?.title) || name,
    summary: toSafeString(role?.summary || role?.role || role?.type || `${kind === "person" ? "人物" : "场景"}身份`),
    description: toSafeString(role?.description || role?.bio || role?.visuals),
    visualTags: toOptionalString(role?.visualTags),
    episodeUsage: toOptionalString(role?.episodeUsage),
    tags: Array.isArray(role?.tags) ? role.tags.map((item: any) => toSafeString(item)).filter(Boolean) : undefined,
    status:
      role?.status === "draft" ||
      role?.status === "verified" ||
      role?.status === "locked" ||
      role?.status === "archived"
        ? role.status
        : "draft",
    aliases,
    binding: {
      mention,
      aliases: aliases.map((item) => item.value),
    },
    voiceId: toOptionalString(role?.voiceId),
    voicePrompt: toOptionalString(role?.voicePrompt),
    previewAudioUrl: toOptionalString(role?.previewAudioUrl),
    voiceReferenceAudioUrl: toOptionalString(role?.voiceReferenceAudioUrl || role?.voiceSampleUrl || role?.voiceAudioUrl),
    designPrompt: toOptionalString(role?.designPrompt || role?.genPrompts),
    designNotes: toOptionalString(role?.designNotes || role?.designRationale),
    lightingPalette: toOptionalString(role?.lightingPalette || role?.lightingOrPalette || role?.lightingWeather),
    props: toOptionalString(role?.props || role?.keyProps),
    assetPriority:
      role?.assetPriority === "high" || role?.assetPriority === "medium" || role?.assetPriority === "low"
        ? role.assetPriority
        : undefined,
    avatarUrl: toOptionalString(role?.avatarUrl) || portraits.find((portrait) => portrait.isPrimary)?.imageUrl,
    portraits,
  };
};

const collapseExplicitRoles = (roles: ProjectRoleIdentity[]): ProjectRoleIdentity[] => {
  const grouped = new Map<string, ProjectRoleIdentity[]>();
  roles.forEach((role) => {
    const key = role.mention.split("_")[0] || role.name || role.id;
    const bucket = grouped.get(key) || [];
    bucket.push(role);
    grouped.set(key, bucket);
  });

  return Array.from(grouped.values()).map((items) => {
    const primary = items[0];
    const name = primary.name || primary.displayName || primary.mention;
    const mention = buildMention(name);
    const portraits = items
      .flatMap((role, index) => {
        if (role.portraits?.length) {
          return role.portraits.map((portrait) =>
            normalizePortrait(portrait, mention, portrait.name || (index === 0 ? "normal" : `look${index + 1}`))
          );
        }
        const rawMention = role.mention || "";
        const mentionParts = rawMention.split("_");
        const mentionSlot = mentionParts.length > 1 ? mentionParts.slice(1).join("_") : "";
        const legacyName = sanitizeIdentityToken(
          mentionSlot ||
            (role.title && role.title !== name ? role.title : index === 0 ? "normal" : `look${index + 1}`),
          index === 0 ? "normal" : `look${index + 1}`
        );
        return [
          normalizePortrait(
            {
              id: undefined,
              name: legacyName,
              imageUrl: role.avatarUrl,
              createdAt: Date.now(),
              summary: role.description,
              isPrimary: index === 0 || legacyName === "normal",
            },
            mention,
            legacyName
          ),
        ];
      })
      .filter((portrait): portrait is ProjectRolePortrait => !!portrait)
      .slice(0, MAX_ROLE_PORTRAITS);

    const aliasValues = items.flatMap((role) => (role.aliases || []).map((alias) => alias.value));
    return normalizeRoleIdentity(
      applyRolePortraits(
        {
          ...primary,
          name,
          displayName: name,
          mention,
          aliases: normalizeAliases([], [name, `@${mention}`, ...aliasValues]),
          portraits,
          avatarUrl: primary.avatarUrl,
          voiceReferenceAudioUrl: primary.voiceReferenceAudioUrl || primary.previewAudioUrl,
        },
        portraits
      )
    );
  });
};

const normalizeRoles = (data: any): ProjectRoleIdentity[] => {
  const rawRoles = Array.isArray(data?.roles) ? data.roles : [];
  return collapseExplicitRoles(rawRoles.map(normalizeRoleIdentity));
};

const remapDesignAssets = (assets: DesignAssetItem[], roles: ProjectRoleIdentity[]): DesignAssetItem[] => {
  if (!Array.isArray(assets) || assets.length === 0) return [];

  const mentionMap = new Map<string, { refId: string; label: string }>();
  roles.forEach((role) => {
    const label = role.displayName || `@${role.mention}`;
    mentionMap.set(role.id, { refId: role.id, label });
    mentionMap.set(role.mention, { refId: role.id, label });
    mentionMap.set(`@${role.mention}`, { refId: role.id, label });
    mentionMap.set(role.displayName, { refId: role.id, label });
    (role.portraits || []).forEach((portrait) => {
      const portraitRefId = `portrait:${portrait.id}`;
      const portraitLabel = `${role.name} 路 ${portrait.name}`;
      mentionMap.set(portrait.id, { refId: portraitRefId, label: portraitLabel });
      mentionMap.set(portrait.mention, { refId: portraitRefId, label: portraitLabel });
      mentionMap.set(`@${portrait.mention}`, { refId: portraitRefId, label: portraitLabel });
      mentionMap.set(`${role.id}|${portrait.id}`, { refId: portraitRefId, label: portraitLabel });
    });
  });

  return assets
    .map((asset) => {
      const mapped = mentionMap.get(asset.refId) || mentionMap.get(asset.label || "");
      return {
        ...asset,
        category: "identity" as const,
        refId: mapped?.refId || asset.refId,
        label: mapped?.label || asset.label,
      };
    })
    .filter((asset) => !!asset.refId);
};

export const normalizeProjectData = (data: any): ProjectData => {
  const roles = normalizeRoles(data);
  const projectData = data || {};
  const base: ProjectData = {
    ...INITIAL_PROJECT_DATA,
    ...projectData,
    roles,
    designAssets: Array.isArray(projectData?.designAssets) ? projectData.designAssets : [],
    phase5Usage: projectData?.phase5Usage || INITIAL_PROJECT_DATA.phase5Usage,
    stats: { ...INITIAL_PROJECT_DATA.stats, ...(projectData?.stats || {}) },
  };

  base.episodes = Array.isArray(projectData?.episodes) ? projectData.episodes.map(normalizeEpisode) : [];
  base.designAssets = remapDesignAssets(base.designAssets as DesignAssetItem[], roles);
  base.canvas = {
    ...INITIAL_PROJECT_DATA.canvas,
    ...(projectData?.canvas || {}),
    viewport: normalizeCanvasViewport(projectData?.canvas?.viewport),
  };
  base.rawScript = typeof projectData?.rawScript === "string" ? projectData.rawScript : "";
  base.fileName = typeof projectData?.fileName === "string" ? projectData.fileName : "";
  const rawFlowProjects = Array.isArray(projectData?.flowProjects)
    ? projectData.flowProjects
    : [];
  const requestedActiveProjectId = typeof projectData?.activeFlowProjectId === "string"
    ? projectData.activeFlowProjectId
    : undefined;
  const serializedActiveProject = rawFlowProjects.find(
    (project: any) => project?.id === requestedActiveProjectId,
  ) || rawFlowProjects[0];
  // Cloud packages omit the duplicate top-level flow. In that representation
  // the active project's flow is authoritative and must be restored before the
  // project list is normalized; otherwise every cloud snapshot becomes rev 0.
  const normalizedFlow = normalizeFlow(
    projectData?.flow ?? serializedActiveProject?.flow,
  );
  const normalizedProjects = normalizeFlowProjects(
    projectData?.flowProjects,
    normalizedFlow as NonNullable<ProjectData["flow"]>,
    requestedActiveProjectId,
    base.fileName
  );
  base.flow = normalizedProjects.flow;
  base.activeFlowProjectId = normalizedProjects.activeFlowProjectId;
  base.flowProjects = normalizedProjects.flowProjects.map((project) => {
    const isActiveProject = project.id === normalizedProjects.activeFlowProjectId;
    const projectRoles = isActiveProject
      ? roles
      : Array.isArray(project.roles)
        ? normalizeRoles({ roles: project.roles })
        : [];
    const projectDesignAssets = remapDesignAssets(
      isActiveProject
        ? base.designAssets
        : Array.isArray(project.designAssets)
          ? project.designAssets
          : [],
      projectRoles
    );
    return {
      ...project,
      roles: projectRoles,
      designAssets: projectDesignAssets,
      rawScript: isActiveProject
        ? base.rawScript
        : typeof project.rawScript === "string"
          ? project.rawScript
          : "",
      episodes: isActiveProject
        ? base.episodes
        : Array.isArray(project.episodes)
          ? project.episodes.map(normalizeEpisode)
          : [],
      canvas: isActiveProject
        ? base.canvas
        : {
            ...INITIAL_PROJECT_DATA.canvas,
            ...(project.canvas || {}),
            viewport: normalizeCanvasViewport(project.canvas?.viewport),
          },
      phase5Usage: isActiveProject
        ? base.phase5Usage
        : project.phase5Usage || INITIAL_PROJECT_DATA.phase5Usage,
      stats: isActiveProject
        ? base.stats
        : { ...INITIAL_PROJECT_DATA.stats, ...(project.stats || {}) },
    };
  });
  const activeProject = base.flowProjects.find((project) => project.id === base.activeFlowProjectId);
  base.roles = activeProject?.roles || [];
  base.designAssets = activeProject?.designAssets || [];
  return sanitizeValue(base) as ProjectData;
};
