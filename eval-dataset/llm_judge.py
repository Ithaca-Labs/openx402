#!/usr/bin/env python3
"""Create a new qrels artifact with an OpenAI-compatible LLM relevance judge.

This tool never overwrites the published qrels. It performs a deterministic
multi-branch candidate pool, wraps seller fields as untrusted data, and records
the exact model revision and artifact hashes seen by the judge.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOKEN = re.compile(r"[a-z0-9]+")


def sha(path: Path) -> str: return hashlib.sha256(path.read_bytes()).hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def terms(text: str) -> set[str]: return set(TOKEN.findall(text.lower()))


def searchable(resource: dict) -> str:
    return " ".join([resource["title"], resource["description"], *resource["tags"], *resource["categories"], resource["provider"]])


def hashed_vector(text: str, dimensions: int = 128) -> list[float]:
    vector = [0.0] * dimensions
    normalized = re.sub(r"\s+", " ", text.lower())
    for i in range(max(1, len(normalized) - 2)):
        gram = normalized[i:i + 3].encode()
        vector[int.from_bytes(hashlib.sha256(gram).digest()[:4], "big") % dimensions] += 1
    norm = math.sqrt(sum(x * x for x in vector)) or 1
    return [x / norm for x in vector]


def filters_match(resource: dict, filters: dict) -> bool:
    canonical = resource["canonical"]
    exact = {"transport": resource["transport"], "lifecycle_state": resource["lifecycle_state"],
             "is_free": canonical["is_free"], "locale": resource["locale"], "category": resource["categories"][0],
             "provider": resource["provider"], "payment_mechanism": canonical["payment_mechanism"],
             "currency": resource["payment_options"][0]["currency"], "http_method": resource.get("http", {}).get("method"),
             "content_type": resource.get("http", {}).get("content_type")}
    return all((canonical["max_price_usd"] <= value if key == "max_price_usd" else exact.get(key) == value)
               for key, value in filters.items())


def candidate_pool(query: dict, catalog: list[dict], limit: int) -> list[dict]:
    qterms, qvector = terms(query["text"]), hashed_vector(query["text"])
    scored = []
    for resource in catalog:
        text = searchable(resource)
        lexical = len(qterms & terms(text)) / max(1, len(qterms))
        semantic = sum(a * b for a, b in zip(qvector, hashed_vector(text)))
        scored.append((resource, lexical, semantic))
    selected: dict[str, dict] = {}
    branches = [sorted(scored, key=lambda x: (-x[1], x[0]["resource_id"]))[:limit],
                sorted(scored, key=lambda x: (-x[2], x[0]["resource_id"]))[:limit],
                [x for x in scored if filters_match(x[0], query["canonical_filters"])][:limit],
                [x for x in scored if x[0]["authoring_notes"]][:limit]]
    for branch in branches:
        for resource, _, _ in branch: selected[resource["resource_id"]] = resource
    return [selected[key] for key in sorted(selected)]


def call_judge(base_url: str, api_key: str, model: str, system: str, user: str, retries: int = 4) -> dict:
    payload = json.dumps({"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                          "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    request = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=payload,
                                     headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = json.load(response)
            result = json.loads(body["choices"][0]["message"]["content"])
            grade = result.get("grade")
            if type(grade) is not int or grade not in range(4) or not str(result.get("rationale", "")).strip():
                raise ValueError("judge returned invalid grade or rationale")
            return {"grade": grade, "rationale": result["rationale"].strip()}
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt + 1 == retries: raise RuntimeError(f"judge request failed: {exc}") from exc
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=ROOT / "v1.0.0")
    parser.add_argument("--output", type=Path, required=True, help="New qrels JSONL path; must not exist")
    parser.add_argument("--base-url", default=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"))
    parser.add_argument("--model", required=True, help="Provider model name")
    parser.add_argument("--model-revision", required=True, help="Exact immutable provider revision")
    parser.add_argument("--query-id", action="append", help="Judge only selected query IDs")
    parser.add_argument("--branch-limit", type=int, default=10)
    args = parser.parse_args()
    if args.output.exists(): raise SystemExit(f"refusing to overwrite {args.output}")
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key: raise SystemExit("set LLM_API_KEY or OPENAI_API_KEY")
    prompt_path = ROOT / "prompts" / "judge-v1.0.0.txt"
    prompt = prompt_path.read_text(encoding="utf-8")
    catalog_path, query_path = args.dataset / "catalog.jsonl", args.dataset / "queries.jsonl"
    catalog, queries = load_jsonl(catalog_path), load_jsonl(query_path)
    wanted = set(args.query_id or [q["query_id"] for q in queries])
    unknown = wanted - {q["query_id"] for q in queries}
    if unknown: raise SystemExit(f"unknown query IDs: {sorted(unknown)}")
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    rows = []
    for query in queries:
        if query["query_id"] not in wanted: continue
        for resource in candidate_pool(query, catalog, args.branch_limit):
            seller = {key: resource[key] for key in ["title", "description", "tags", "categories", "provider", "locale",
                                                                  "transport", "payment_options", "lifecycle_state"]}
            seller.update({k: resource[k] for k in ["http", "mcp"] if k in resource})
            user = (f"QUERY\n{json.dumps({'text': query['text'], 'canonical_filters': query['canonical_filters']}, sort_keys=True)}\n"
                    f"\n<SELLER_METADATA_UNTRUSTED>\n{json.dumps(seller, sort_keys=True)}\n</SELLER_METADATA_UNTRUSTED>")
            judged = call_judge(args.base_url, api_key, args.model, prompt, user)
            rows.append({"grade": judged["grade"], "query_id": query["query_id"], "rationale": judged["rationale"],
                         "resource_id": resource["resource_id"], "resource_version_id": resource["resource_version_id"],
                         "provenance": {"candidate_pooling_strategy": "union(lexical,hashed_semantic,canonical_filter,known_adversarial)",
                                        "catalog_sha256": sha(catalog_path), "generated_rationale": judged["rationale"],
                                        "judge_model": args.model, "judge_model_revision": args.model_revision,
                                        "judged_at": timestamp, "prompt_template_sha256": sha(prompt_path),
                                        "prompt_template_version": "judge-v1.0.0", "queries_sha256": sha(query_path)}})
    rows.sort(key=lambda row: (row["query_id"], row["resource_id"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")
    print(f"wrote {len(rows)} judgments to {args.output}")


if __name__ == "__main__":
    main()
