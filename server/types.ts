/** Shared types: session index + normalised SSE events. */

export type SessionInfo = {
  id: string;
  path: string;
  project: string;
  cwd: string | null;
  branch: string | null;
  title: string | null;
  size: number;
  mtime: number;
};

export type Ev = {
  t: number;
  kind:
    | "tool" | "result" | "text" | "user" | "system" | "mode" | "title"
    | "cost"      // the session's own running totals
    | "file"      // a file the transcript records as edited
    | "queue";    // a message queued, sent or dropped
  tool?: string;
  error?: boolean;
  label?: string;
  sidechain?: boolean;
  id?: string;         // tool_use id, so a call can be paired with its result
  forId?: string;      // tool_use_id carried by the matching tool_result
  agent?: string;      // short agent id, from the filename
  atype?: string;      // agent type: general-purpose, fork, ...
  model?: string;
  tokens?: number;
  cache?: number;      // cache_read_input_tokens: context reused, cheaply
  fresh?: number;      // input_tokens: context paid for again
  effort?: string;
  speed?: string;
  ms?: number;         // durationMs, on the system lines that carry one
  path?: string;       // trackingPath, home-relative
  op?: string;         // queue-operation: enqueue / dequeue / remove / popAll
  cost?: CostDigest;
};

/** The useful half of a cost-state line. Totals, not content. */
export type CostDigest = {
  usd: number;
  added: number;
  removed: number;
  toolMs: number;
  apiMs: number;
  durMs: number;
  models: { name: string; usd: number; out: number; cr: number }[];
};
