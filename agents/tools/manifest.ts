import {
  getStyloToolDescriptor,
  type StyloToolCapability,
} from "../runtime/toolCatalog";
import { listStyloToolDefinitions } from "./index";

export const CODEX_INITIAL_CAPABILITIES = ["project_read"] as const satisfies readonly StyloToolCapability[];

export type StyloToolManifestEntry = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  _meta: {
    capability: StyloToolCapability;
    interaction: string;
  };
};

export const buildStyloToolManifest = (
  capabilities: readonly StyloToolCapability[] = CODEX_INITIAL_CAPABILITIES
): StyloToolManifestEntry[] => listStyloToolDefinitions(capabilities).map((definition) => {
  const descriptor = getStyloToolDescriptor(definition.name);
  const readOnly = descriptor.interaction === "read";
  return {
    name: definition.name,
    title: descriptor.label,
    description: definition.description,
    inputSchema: definition.parameters as Record<string, unknown>,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: descriptor.capability === "external_read",
    },
    _meta: {
      capability: descriptor.capability,
      interaction: descriptor.interaction,
    },
  };
});

