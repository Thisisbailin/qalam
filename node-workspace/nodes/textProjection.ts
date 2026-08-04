const MAX_PENDING_TEXT_ECHOES = 24;

export const recordPendingTextEcho = (pending: string[], value: string) => {
  if (pending.at(-1) === value) return pending;
  return [...pending, value].slice(-MAX_PENDING_TEXT_ECHOES);
};

export const classifyIncomingTextProjection = (input: {
  incoming: string;
  draft: string;
  pendingLocalEchoes: string[];
}) => {
  const echoIndex = input.pendingLocalEchoes.lastIndexOf(input.incoming);
  if (echoIndex >= 0) {
    return {
      adopt: false,
      pendingLocalEchoes: input.pendingLocalEchoes.slice(echoIndex + 1),
    };
  }
  return {
    adopt: input.incoming !== input.draft,
    // A non-echo projection is the CRDT materialization after local and remote
    // operations were combined. Older local echoes must not mask it later.
    pendingLocalEchoes: [] as string[],
  };
};
