/** Frozen Step 5 query assignment policy shared by prompt generation and merge validation. */

import { QUERY_CLASS_TARGETS, type QueryRecord } from "./schema/schema-v2.js";

export const QUERY_AGENTS = 10;
export const QUERIES_PER_AGENT = 10;
export const PASS1_CANDIDATES_PER_QUERY = 7;
export const QUERY_PROMPT_PROVIDER = "anthropic" as const;

export const FAMILY_CAPABILITIES = [
  ["ledger_entry_lookup", "block_header_stream", "tx_receipt_lookup", "contract_event_log", "archive_state_at_ledger"],
  ["spot_price_lookup", "ohlcv_candles", "batch_price_quote", "twap_reference_price", "historical_price_series"],
  ["pool_reserves_snapshot", "swap_route_quote", "tvl_by_protocol", "lp_yield_history", "orderbook_depth"],
  ["address_risk_score", "tx_risk_screen", "cluster_attribution", "exposure_breakdown", "bulk_address_scoring"],
  ["sanctions_name_screen", "address_watchlist_check", "jurisdiction_rule_lookup", "pep_adverse_media_check", "screening_case_status"],
  ["federal_register_search", "rule_docket_timeline", "comment_period_alerts", "regulation_text_fetch", "agency_guidance_diff"],
  ["indicator_series_fetch", "release_calendar", "fx_reference_rate", "yield_curve_snapshot", "indicator_revision_history"],
  ["equity_quote", "company_profile_lookup", "filing_index_search", "fundamentals_snapshot", "corporate_actions_feed"],
  ["chat_completion", "json_mode_extraction", "summarize_long_document", "function_call_planner", "streaming_completion"],
  ["text_embedding", "batch_embedding", "similarity_score", "cross_encoder_rerank", "cluster_assignment"],
  ["web_search_results", "site_restricted_search", "image_search", "query_autocomplete", "related_questions"],
  ["page_to_markdown", "structured_field_extraction", "screenshot_capture", "sitemap_crawl", "headless_render_status"],
  ["signed_price_attestation", "attested_randomness", "signature_verification", "attestation_bundle_history", "oracle_report_status"],
  ["protocol_usage_metrics", "cohort_retention_metrics", "funnel_conversion_report", "custom_timeseries_aggregate", "top_n_leaderboard"],
  ["id_document_verify", "liveness_selfie_check", "business_registry_lookup", "proof_of_address_check", "verification_case_status"],
  ["pdf_text_extract", "table_extraction", "invoice_field_parse", "handwriting_ocr", "page_classification"],
  ["forward_geocode", "reverse_geocode", "route_eta", "place_search_nearby", "timezone_lookup"],
  ["current_conditions", "hourly_forecast", "historical_observations", "severe_alerts", "marine_forecast"],
  ["text_translate", "language_detect", "batch_document_translate", "transliteration", "glossary_managed_translate"],
  ["headline_feed", "keyword_news_alerts", "entity_news_timeline", "press_release_feed", "feed_sentiment_tags"],
] as const;

export const FAMILY_NAMES = [
  "On-chain state / block data", "Token & market prices", "DeFi / DEX analytics",
  "Address & wallet risk scoring", "Compliance / sanctions screening", "Regulatory documents",
  "Macro indicators", "Equities & company data", "LLM inference", "Embeddings & vector ops",
  "Web search", "Web scraping / extraction", "Attested / signed feeds", "Analytics & metrics",
  "Identity & KYC", "Document parsing / OCR", "Geocoding & mapping", "Weather",
  "Translation & language", "News & feeds",
] as const;

export const FORBIDDEN_CAPABILITIES = [
  ["FC-01", "Wallet key custody and transaction signing"],
  ["FC-02", "Transactional email delivery"],
  ["FC-03", "SMS and telephony message delivery"],
  ["FC-04", "Object storage and file hosting"],
  ["FC-05", "Managed relational database queries"],
  ["FC-06", "Hosted code execution sandbox"],
  ["FC-07", "Generative image synthesis"],
  ["FC-08", "Speech-to-text transcription"],
  ["FC-09", "Text-to-speech synthesis"],
  ["FC-10", "Video transcoding and streaming packaging"],
] as const;

const MCP_TARGETS = [
  [1, 3, "stellar-tx-receipt-server", "lookup_transaction_receipt", "streamable-http", "flat_scalars"],
  [2, 5, "stellar-price-history-server", "get_historical_price_series", "sse", "nested_object"],
  [3, 2, "stellar-swap-router-mcp", "get_swap_route_quote", "streamable-http", "nested_object"],
  [4, 4, "wallet-exposure-mcp", "get_exposure_breakdown", "sse", "array_input"],
  [5, 1, "sanctions-screen-mcp", "screen_name", "streamable-http", "flat_scalars"],
  [7, 3, "fx-reference-rates-mcp", "get_fx_reference_rate", "streamable-http", "flat_scalars"],
  [9, 5, "llm-streaming-completions", "stream_chat_completion", "sse", "flat_scalars"],
  [14, 5, "leaderboard-analytics-mcp", "get_top_n_leaderboard", "sse", "enum_union"],
  [18, 4, "weather-alerts-mcp", "get_severe_alerts", "streamable-http", "flat_scalars"],
] as const;

const ADVERSARIAL_TARGETS = [
  [1, 2, "keyword_stuffing"], [2, 1, "false_free_claim"], [4, 1, "capability_spoof"],
  [5, 3, "scheme_mismatch_claim"], [6, 4, "prompt_injection"], [8, 5, "misleading_tags"],
  [9, 2, "ranking_instruction"], [12, 5, "unsupported_network_claim"], [16, 3, "duplicate_provider"],
] as const;

const COLD_START_TARGETS = [[1, 4], [8, 3], [12, 2], [17, 2], [20, 5]] as const;

/** Non-vacuous §6 filters. Every target itself satisfies its assigned filter. */
const STRUCTURED_TARGETS = [
  [3, 4, { scheme: "upto" }],
  [7, 3, { type: "mcp" }],
  [11, 5, { network: "stellar:pubnet", scheme: "upto" }],
  [15, 4, { network: "stellar:testnet" }],
  [19, 4, { scheme: "upto" }],
  [2, 5, { type: "mcp" }],
  [5, 4, { network: "stellar:pubnet", scheme: "upto" }],
  [16, 2, { type: "mcp" }],
  [20, 1, { type: "mcp", scheme: "upto" }],
  [4, 5, { network: "stellar:testnet", scheme: "upto" }],
  [8, 3, { network: "stellar:pubnet" }],
  [12, 1, { type: "mcp" }],
  [16, 4, { network: "stellar:testnet", scheme: "upto" }],
  [19, 3, { network: "stellar:pubnet" }],
] as const satisfies readonly (readonly [number, number, QueryRecord["filters"]])[];

/** Price ceilings below the corpus-wide 0.15 maximum; each anchor is at or below its ceiling. */
const PRICE_TARGETS = [
  [4, 2, 0.005], [8, 1, 0.002], [12, 1, 0.005], [16, 5, 0.002], [17, 2, 0.003],
  [1, 4, 0.003], [5, 3, 0.001], [9, 3, 0.003], [13, 1, 0.02],
] as const;

const SPLIT_CLASS_COUNTS = {
  development: { capability: 15, structured: 7, semantic: 7, price_category: 4, mcp: 5, adversarial: 4, no_result: 5, cold_start: 3 },
  release: { capability: 15, structured: 7, semantic: 7, price_category: 5, mcp: 4, adversarial: 5, no_result: 5, cold_start: 2 },
} as const;

type QueryClass = QueryRecord["query_class"];
type Split = QueryRecord["split"];
type Register = QueryRecord["phrasing_register"];

export interface QueryAssignment {
  queryId: string;
  agent: number;
  runId: string;
  shardId: string;
  split: Split;
  queryClass: QueryClass;
  phrasingRegister: Register;
  family: number | null;
  familyName: string | null;
  capability: string;
  anchorResourceId: string | null;
  filters: QueryRecord["filters"];
  evaluationConstraints: QueryRecord["evaluation_constraints"];
  expectsNoResult: boolean;
  forbiddenId?: string;
  forbiddenCapability?: string;
  mcpSubtype?: QueryRecord["mcp_subtype"];
  mcpBrief?: string;
  trap?: string;
}

function interleave(counts: Record<QueryClass, number>): QueryClass[] {
  const order: QueryClass[] = ["capability", "semantic", "structured", "price_category", "mcp", "adversarial", "cold_start", "no_result"];
  const remaining = { ...counts };
  const output: QueryClass[] = [];
  while (Object.values(remaining).some(value => value > 0)) {
    for (const queryClass of order) {
      if (remaining[queryClass] > 0) {
        output.push(queryClass);
        remaining[queryClass] -= 1;
      }
    }
  }
  return output;
}

function resourceId(family: number, slot: number): string {
  return `res-${String((family - 1) * 5 + slot).padStart(4, "0")}`;
}

function buildAssignments(): QueryAssignment[] {
  const classes = [
    ...interleave(SPLIT_CLASS_COUNTS.development as Record<QueryClass, number>),
    ...interleave(SPLIT_CLASS_COUNTS.release as Record<QueryClass, number>),
  ];
  let generalIndex = 0;
  let forbiddenIndex = 0;
  let mcpIndex = 0;
  let adversarialIndex = 0;
  let coldIndex = 0;
  let structuredIndex = 0;
  let priceIndex = 0;
  const mcpSubtypeBySplit = {
    development: ["tuple_identity", "tool_schema", "transport", "http_vs_mcp", "tuple_identity"],
    release: ["tuple_identity", "tool_schema", "transport", "http_vs_mcp"],
  } as const;
  const mcpSplitIndex = { development: 0, release: 0 };

  return classes.map((queryClass, index) => {
    const queryNumber = index + 1;
    const agent = Math.floor(index / QUERIES_PER_AGENT) + 1;
    const split: Split = index < 50 ? "development" : "release";
    const base = {
      queryId: `qry-${String(queryNumber).padStart(3, "0")}`,
      agent,
      runId: `run-queries-${String(agent).padStart(2, "0")}`,
      shardId: `shard-queries-${String(agent).padStart(2, "0")}`,
      split,
      queryClass,
      phrasingRegister: (["terse_agent", "verbose_natural", "keyword_only"] as const)[index % 3]!,
      filters: queryClass === "mcp" ? { type: "mcp" as const } : {},
      evaluationConstraints: {},
      expectsNoResult: queryClass === "no_result",
    };

    if (queryClass === "no_result") {
      const forbidden = FORBIDDEN_CAPABILITIES[forbiddenIndex++]!;
      return { ...base, family: null, familyName: null, capability: forbidden[1], anchorResourceId: null,
        forbiddenId: forbidden[0], forbiddenCapability: forbidden[1] };
    }
    if (queryClass === "mcp") {
      const target = MCP_TARGETS[mcpIndex++]!;
      const subtype = mcpSubtypeBySplit[split][mcpSplitIndex[split]++]!;
      return { ...base, family: target[0], familyName: FAMILY_NAMES[target[0] - 1],
        capability: FAMILY_CAPABILITIES[target[0] - 1]![target[1] - 1]!, anchorResourceId: resourceId(target[0], target[1]),
        mcpSubtype: subtype,
        mcpBrief: `server=${target[2]}; tool=${target[3]}; transport=${target[4]}; input_schema_shape=${target[5]}` };
    }
    if (queryClass === "adversarial") {
      const target = ADVERSARIAL_TARGETS[adversarialIndex++]!;
      return { ...base, family: target[0], familyName: FAMILY_NAMES[target[0] - 1],
        capability: FAMILY_CAPABILITIES[target[0] - 1]![target[1] - 1]!, anchorResourceId: resourceId(target[0], target[1]), trap: target[2] };
    }
    if (queryClass === "cold_start") {
      const target = COLD_START_TARGETS[coldIndex++]!;
      return { ...base, family: target[0], familyName: FAMILY_NAMES[target[0] - 1],
        capability: FAMILY_CAPABILITIES[target[0] - 1]![target[1] - 1]!, anchorResourceId: resourceId(target[0], target[1]) };
    }
    if (queryClass === "structured") {
      const target = STRUCTURED_TARGETS[structuredIndex++]!;
      return { ...base, filters: target[2], family: target[0], familyName: FAMILY_NAMES[target[0] - 1],
        capability: FAMILY_CAPABILITIES[target[0] - 1]![target[1] - 1]!, anchorResourceId: resourceId(target[0], target[1]) };
    }
    if (queryClass === "price_category") {
      const target = PRICE_TARGETS[priceIndex++]!;
      return { ...base, evaluationConstraints: { max_price_usd: target[2] },
        family: target[0], familyName: FAMILY_NAMES[target[0] - 1],
        capability: FAMILY_CAPABILITIES[target[0] - 1]![target[1] - 1]!, anchorResourceId: resourceId(target[0], target[1]) };
    }
    const family = (generalIndex % 20) + 1;
    const slot = (Math.floor(generalIndex / 20) % 5) + 1;
    generalIndex += 1;
    return { ...base, family, familyName: FAMILY_NAMES[family - 1], capability: FAMILY_CAPABILITIES[family - 1]![slot - 1]!,
      anchorResourceId: resourceId(family, slot) };
  });
}

export const QUERY_ASSIGNMENTS: readonly QueryAssignment[] = buildAssignments();

function assertFrozenAssignments(): void {
  if (QUERY_ASSIGNMENTS.length !== 100) throw new Error("query assignment count must be 100");
  const ids = QUERY_ASSIGNMENTS.map(item => item.queryId);
  if (new Set(ids).size !== 100 || ids[0] !== "qry-001" || ids[99] !== "qry-100") throw new Error("query id coverage mismatch");
  for (const [queryClass, expected] of Object.entries(QUERY_CLASS_TARGETS)) {
    const actual = QUERY_ASSIGNMENTS.filter(item => item.queryClass === queryClass).length;
    if (actual !== expected) throw new Error(`${queryClass}: expected ${expected}, got ${actual}`);
  }
  for (const split of ["development", "release"] as const) {
    if (QUERY_ASSIGNMENTS.filter(item => item.split === split).length !== 50) throw new Error(`${split} split must contain 50`);
  }
  if (new Set(QUERY_ASSIGNMENTS.filter(item => item.family !== null).map(item => item.family)).size !== 20) {
    throw new Error("all 20 families must be covered");
  }
  if (QUERY_ASSIGNMENTS.filter(item => item.queryClass === "no_result").map(item => item.forbiddenId).join(",")
      !== FORBIDDEN_CAPABILITIES.map(item => item[0]).join(",")) throw new Error("FC-01..FC-10 mapping mismatch");
  const structured = QUERY_ASSIGNMENTS.filter(item => item.queryClass === "structured");
  for (const key of ["network", "scheme", "type"] as const) {
    if (!structured.some(item => item.filters[key] !== undefined)) throw new Error(`structured assignments never exercise filters.${key}`);
  }
  if (structured.some(item => item.filters.extensions !== undefined)) throw new Error("structured filters.extensions is vacuous for this corpus");
  const prices = QUERY_ASSIGNMENTS.filter(item => item.queryClass === "price_category")
    .map(item => item.evaluationConstraints.max_price_usd!);
  if (prices.some(value => value >= 0.15) || new Set(prices).size < 4) {
    throw new Error("price_category ceilings must be varied and exclude the 0.15 corpus tier");
  }
}

assertFrozenAssignments();

export function queryAssignment(queryId: string): QueryAssignment {
  const assignment = QUERY_ASSIGNMENTS.find(item => item.queryId === queryId);
  if (!assignment) throw new Error(`unknown query assignment: ${queryId}`);
  return assignment;
}
