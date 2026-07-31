#!/usr/bin/env python3
"""Offline integrity and release-policy validation for the golden dataset."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RELEASE = ROOT / "v1.0.0"
ID_RESOURCE = re.compile(r"^res_[0-9]{6}$")
ID_QUERY = re.compile(r"^q_[0-9]{4}$")
ALLOWED_CLASSES = {"lexical_intent", "semantic_paraphrase", "structured_filter", "price_language",
                   "cold_start", "no_result", "origin_diversity", "adversarial_metadata"}
FILTER_TYPES = {
    "transport": (str, {"http", "mcp"}), "lifecycle_state": (str, {"active", "stale", "quarantined"}),
    "max_price_usd": ((int, float), None), "is_free": (bool, None), "locale": (str, None),
    "category": (str, None), "provider": (str, None), "payment_mechanism": (str, None),
    "currency": (str, None), "http_method": (str, None), "content_type": (str, None),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_jsonl(path: Path, primary_key) -> list[dict]:
    data = path.read_bytes()
    assert data.endswith(b"\n"), f"{path.name}: missing final newline"
    assert b"\r" not in data, f"{path.name}: non-canonical CR byte"
    lines = data.decode("utf-8").splitlines()
    rows = [json.loads(line) for line in lines]
    canonical = [json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) for row in rows]
    assert lines == canonical, f"{path.name}: JSONL is not canonical"
    keys = [primary_key(row) for row in rows]
    assert keys == sorted(keys), f"{path.name}: records are not sorted by primary ID"
    assert len(keys) == len(set(keys)), f"{path.name}: duplicate primary ID"
    return rows


def applies(resource: dict, filters: dict) -> bool:
    values = resource["canonical"]
    checks = {
        "transport": resource["transport"], "lifecycle_state": resource["lifecycle_state"],
        "is_free": values["is_free"], "locale": resource["locale"], "category": resource["categories"][0],
        "provider": resource["provider"], "payment_mechanism": values["payment_mechanism"],
        "currency": resource["payment_options"][0]["currency"],
        "http_method": resource.get("http", {}).get("method"),
        "content_type": resource.get("http", {}).get("content_type"),
    }
    for key, expected in filters.items():
        if key == "max_price_usd":
            if values[key] > expected: return False
        elif checks.get(key) != expected:
            return False
    return True


def validate() -> None:
    required = ["catalog.jsonl", "catalog.manifest.json", "queries.jsonl", "qrels.jsonl", "evaluation.manifest.json", "README.md"]
    for name in required:
        assert (RELEASE / name).is_file(), f"missing {name}"
    catalog = load_jsonl(RELEASE / "catalog.jsonl", lambda x: x["resource_id"])
    queries = load_jsonl(RELEASE / "queries.jsonl", lambda x: x["query_id"])
    qrels = load_jsonl(RELEASE / "qrels.jsonl", lambda x: (x["query_id"], x["resource_id"]))
    cm = json.loads((RELEASE / "catalog.manifest.json").read_text(encoding="utf-8"))
    em = json.loads((RELEASE / "evaluation.manifest.json").read_text(encoding="utf-8"))

    assert len(catalog) == 1000
    assert Counter(r["transport"] for r in catalog) == {"http": 800, "mcp": 200}
    assert cm["resource_count"] == 1000 and cm["transport_counts"] == {"http": 800, "mcp": 200}
    assert cm["catalog_sha256"] == digest(RELEASE / "catalog.jsonl") == em["catalog_sha256"]
    resources = {r["resource_id"]: r for r in catalog}
    assert all(ID_RESOURCE.fullmatch(rid) for rid in resources)
    assert len({r["resource_version_id"] for r in catalog}) == 1000
    assert sum(bool(r.get("version_history")) for r in catalog) >= 20, "metadata-change fixtures missing"
    assert cm["resource_versions"] == {rid: r["resource_version_id"] for rid, r in resources.items()}
    for row in catalog:
        assert row["transport"] in {"http", "mcp"} and row["lifecycle_state"] in {"active", "stale", "quarantined"}
        assert bool(row.get("http")) != bool(row.get("mcp")), f"transport fields conflated: {row['resource_id']}"
        assert row["payment_options"] and isinstance(row["canonical"]["is_free"], bool)
        assert all(term not in " ".join(row["authoring_notes"]).lower() for term in ["expected result", "qrel grade"])

    assert len(queries) == 200
    assert Counter(q["split"] for q in queries) == {"development": 140, "release_gate": 60}
    assert all(ID_QUERY.fullmatch(q["query_id"]) for q in queries)
    by_split_class = defaultdict(Counter)
    for query in queries:
        assert query["text"].strip() and query["author_rationale"].strip() and query["classes"]
        assert set(query["classes"]) <= ALLOWED_CLASSES
        for cls in query["classes"]: by_split_class[query["split"]][cls] += 1
        for key, value in query["canonical_filters"].items():
            assert key in FILTER_TYPES, f"unknown filter {key}"
            expected_type, allowed = FILTER_TYPES[key]
            assert isinstance(value, expected_type) and not (key == "max_price_usd" and isinstance(value, bool))
            assert allowed is None or value in allowed
        assert query["expects_no_result"] == ("no_result" in query["classes"])
    covered = set().union(*(set(v) for v in by_split_class.values()))
    assert covered == ALLOWED_CLASSES, f"taxonomy mismatch: {covered}"
    for cls in ALLOWED_CLASSES:
        assert by_split_class["development"][cls] and by_split_class["release_gate"][cls], f"{cls} missing from a split"

    query_map = {q["query_id"]: q for q in queries}
    grouped = defaultdict(list)
    for qrel in qrels:
        assert qrel["query_id"] in query_map and qrel["resource_id"] in resources
        resource = resources[qrel["resource_id"]]
        assert qrel["resource_version_id"] == resource["resource_version_id"]
        assert type(qrel["grade"]) is int and 0 <= qrel["grade"] <= 3
        assert qrel["rationale"].strip() and qrel["provenance"]["generated_rationale"] == qrel["rationale"]
        provenance = qrel["provenance"]
        for key in ["judge_model", "judge_model_revision", "prompt_template_version", "prompt_template_sha256",
                    "judged_at", "candidate_pooling_strategy", "catalog_sha256", "queries_sha256"]:
            assert provenance.get(key), f"missing qrel provenance {key}"
        assert provenance["catalog_sha256"] == em["catalog_sha256"]
        assert provenance["queries_sha256"] == em["queries_sha256"]
        grouped[qrel["query_id"]].append(qrel)
    assert set(grouped) == set(query_map), "each query must have judged candidates"
    for query_id, judgments in grouped.items():
        query = query_map[query_id]
        positives = [j for j in judgments if j["grade"] > 0]
        if query["expects_no_result"]:
            assert not positives, f"no-result query {query_id} has a positive qrel"
        else:
            assert any(j["grade"] >= 2 for j in judgments), f"{query_id} has no relevant qrel"
            assert any(j["grade"] == 0 for j in judgments), f"{query_id} lacks an explicit negative"
            for judgment in positives:
                assert applies(resources[judgment["resource_id"]], query["canonical_filters"]), f"positive violates filter: {query_id}"
            if "cold_start" in query["classes"]:
                ideals = [resources[j["resource_id"]] for j in judgments if j["grade"] == 3]
                assert any("cold_start_sparse_metadata" in r["authoring_notes"] for r in ideals), f"{query_id} lacks an ideal sparse fixture"

    for relative, expected in cm["source_fixtures_sha256"].items():
        assert digest(ROOT / relative) == expected
    for relative, expected in cm["deterministic_generation_inputs_sha256"].items():
        assert digest(ROOT / relative) == expected
    for relative, expected in em["source_inputs_sha256"].items():
        assert digest(RELEASE / relative) == expected
    for name, expected in em["artifacts_sha256"].items():
        assert digest(RELEASE / name) == expected, f"artifact hash mismatch: {name}"
    assert em["queries_sha256"] == digest(RELEASE / "queries.jsonl")
    assert em["qrels_sha256"] == digest(RELEASE / "qrels.jsonl")


if __name__ == "__main__":
    try:
        validate()
    except (AssertionError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print("VALID: v1.0.0 (1000 resources, 200 queries, hashes and qrels verified)")
