export type AccountRealtimeEnv = {
  ACCOUNT_REALTIME?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

export const notifyAccountProjectCatalogChanged = async (
  env: AccountRealtimeEnv,
  userId: string,
) => {
  if (!env.ACCOUNT_REALTIME) return false;
  const roomId = env.ACCOUNT_REALTIME.idFromName(userId);
  const response = await env.ACCOUNT_REALTIME.get(roomId).fetch(
    new Request("https://stylo.internal/notify", {
      method: "POST",
      headers: { "x-stylo-user-id": userId },
    }),
  );
  if (!response.ok) {
    throw new Error(`Account project catalog notification failed (${response.status})`);
  }
  return true;
};
