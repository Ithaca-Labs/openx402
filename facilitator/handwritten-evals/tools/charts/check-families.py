#!/usr/bin/env python3
"""Verify spec/families.md against BUILD-PLAN §2, §3 and §4.

Syntax only. This script parses the hand-authored slot tables and checks counts, spreads and the
">=2 differentiating axes" rule. It never decides what a resource means, which family it belongs
to, or whether it is relevant to anything.

    python3 tools/check-families.py

Exit code 0 = every gate in §11 that is checkable from this file passes.
"""

from __future__ import annotations

import collections
import itertools
import pathlib
import re
import sys

SPEC = pathlib.Path(__file__).resolve().parent.parent / "spec" / "families.md"

TIERS = ["0", "0.001", "0.002", "0.003", "0.005", "0.01", "0.02", "0.05", "0.1", "0.15"]
ADVERSARIAL_KINDS = {
    "prompt_injection", "keyword_stuffing", "false_free_claim", "misleading_tags",
    "unsupported_network_claim", "scheme_mismatch_claim", "duplicate_provider",
    "capability_spoof", "ranking_instruction",
}
METHODS = {"GET", "POST", "—"}
SHAPES = {"query params", "JSON body", "path", "tool args"}
OUTPUTS = {"json", "text", "score", "list", "status"}
COVERAGES = {"single-chain", "multi-chain", "regional", "global"}
FRESHNESS = {"live", "hourly", "daily", "historical"}
NETWORKS = {"testnet", "pubnet", "both"}
SCHEMES = {"exact", "exact+upto", "upto"}
ATTESTATIONS = {"signed", "unsigned"}

# axes compared for the §3 ">=2 differences" rule
AXES = ("capability", "type", "method", "shape", "output", "coverage",
        "freshness", "price", "network", "scheme", "attestation")

FAMILY_RE = re.compile(r"^## F(\d+) — (.+)$")
ROW_RE = re.compile(r"^\| ([1-5]) \| `(res-\d{4})` \|")


def strip_ticks(cell: str) -> str:
    return cell.strip().strip("`").strip()


def parse(path: pathlib.Path):
    families: dict[int, str] = {}
    rows: list[dict] = []
    current = None
    for lineno, line in enumerate(path.read_text().splitlines(), 1):
        m = FAMILY_RE.match(line)
        if m:
            current = int(m.group(1))
            families[current] = m.group(2)
            continue
        if not ROW_RE.match(line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 14:
            sys.exit(f"{path}:{lineno}: expected 14 columns, got {len(cells)}")
        tags = [] if cells[13] == "—" else [strip_ticks(t) for t in cells[13].split(",")]
        rows.append({
            "line": lineno,
            "family": current,
            "slot": int(cells[0]),
            "id": strip_ticks(cells[1]),
            "capability": strip_ticks(cells[2]),
            "type": cells[3],
            "method": cells[4],
            "shape": cells[5],
            "output": strip_ticks(cells[6]),
            "coverage": cells[7],
            "freshness": cells[8],
            "price": cells[9],
            "network": cells[10],
            "scheme": strip_ticks(cells[11]),
            "attestation": cells[12],
            "sparse": "sparse" in tags,
            "adversarial": next((t for t in tags if t in ADVERSARIAL_KINDS), None),
            "tags": tags,
        })
    return families, rows


failures: list[str] = []
notes: list[str] = []


def gate(label: str, condition: bool, detail: str = "") -> None:
    print(f"{'ok  ' if condition else 'FAIL'} {label}" + (f"  ({detail})" if detail else ""))
    if not condition:
        failures.append(label)


families, rows = parse(SPEC)

# --- structure --------------------------------------------------------------------------------
gate("20 families (§2)", len(families) == 20, str(len(families)))
gate("100 slots (§2: 5 per family)", len(rows) == 100, str(len(rows)))
for f in range(1, 21):
    fam = [r for r in rows if r["family"] == f]
    if [r["slot"] for r in fam] != [1, 2, 3, 4, 5]:
        failures.append(f"F{f}: slots are not 1..5")
gate("every family has slots 1..5", not any(x.endswith("slots are not 1..5") for x in failures))

expected_ids = [f"res-{i:04d}" for i in range(1, 101)]
gate("resource ids are res-0001..res-0100 in order", [r["id"] for r in rows] == expected_ids)

for r in rows:
    for field, allowed in (("method", METHODS), ("shape", SHAPES), ("output", OUTPUTS),
                           ("coverage", COVERAGES), ("freshness", FRESHNESS),
                           ("network", NETWORKS), ("scheme", SCHEMES),
                           ("attestation", ATTESTATIONS), ("price", set(TIERS))):
        if r[field] not in allowed:
            failures.append(f"{r['id']} line {r['line']}: {field}={r[field]!r} not allowed")
    for t in r["tags"]:
        if t != "sparse" and t not in ADVERSARIAL_KINDS:
            failures.append(f"{r['id']} line {r['line']}: unknown tag {t!r}")
gate("all axis values are in the allowed sets (§3)",
     not any(" not allowed" in x or "unknown tag" in x for x in failures))

# --- §3: >=2 differentiating axes -------------------------------------------------------------
weak = []
for f in range(1, 21):
    fam = [r for r in rows if r["family"] == f]
    for a, b in itertools.combinations(fam, 2):
        diff = [k for k in AXES if a[k] != b[k]]
        if len(diff) < 2:
            weak.append(f"F{f} {a['id']} vs {b['id']}: {diff}")
    caps = [r["capability"] for r in fam]
    if len(set(caps)) != 5:
        failures.append(f"F{f}: duplicate capability in family")
gate("every family pair differs on >=2 axes (§3)", not weak,
     "; ".join(weak[:3]) if weak else "200 pairs checked")
failures.extend(weak)

# --- §3 MCP consistency -------------------------------------------------------------------------
bad_mcp = [r["id"] for r in rows
           if (r["type"] == "mcp") != (r["method"] == "—" or r["shape"] == "tool args")]
gate("mcp slots use not_applicable/tool_arguments and http slots do not", not bad_mcp, ", ".join(bad_mcp))
failures.extend(bad_mcp)

# --- §4 distributions ---------------------------------------------------------------------------
t = collections.Counter(r["type"] for r in rows)
gate("85 http / 15 mcp (§4)", t["http"] == 85 and t["mcp"] == 15, f"http {t['http']} / mcp {t['mcp']}")

sc = collections.Counter(r["scheme"] for r in rows)
gate("scheme 70 exact / 22 exact+upto / 8 upto (§4)",
     (sc["exact"], sc["exact+upto"], sc["upto"]) == (70, 22, 8),
     f"{sc['exact']}/{sc['exact+upto']}/{sc['upto']}")

adv = [r for r in rows if r["adversarial"]]
gate("~15 adversarial (§4)", 13 <= len(adv) <= 17, str(len(adv)))
kinds = {r["adversarial"] for r in adv}
gate(">=6 distinct adversarial_kind (§4, §11)", len(kinds) >= 6, str(len(kinds)))

sparse = [r for r in rows if r["sparse"]]
gate("~10 sparse (§4)", 8 <= len(sparse) <= 12, str(len(sparse)))

# false_free_claim is only false if the resource actually costs something
free_lies = [r["id"] for r in adv if r["adversarial"] == "false_free_claim" and r["price"] == "0"]
gate("false_free_claim slots are priced above 0", not free_lies, ", ".join(free_lies))
failures.extend(free_lies)

# upto at tier 0 with no exact option would be degenerate
degenerate = [r["id"] for r in rows if r["scheme"] == "upto" and r["price"] == "0"]
gate("no upto-only slot at price tier 0", not degenerate, ", ".join(degenerate))
failures.extend(degenerate)

# both networks + exact+upto is exactly the 3-entry accepts maximum; anything more is impossible
gate("accepts stays within 1..3 entries (§5)", True,
     f"{sum(1 for r in rows if r['network'] == 'both' and r['scheme'] == 'exact+upto')} slots at the 3-entry maximum")

# --- §4 anti-correlation ------------------------------------------------------------------------
upto = [r for r in rows if r["scheme"] != "exact"]
mcp = [r for r in rows if r["type"] == "mcp"]


def spread(label, subset, key, minimum, of=None):
    seen = collections.Counter(r[key] for r in subset)
    gate(label, len(seen) >= minimum,
         f"{len(seen)} distinct {key}" + (f" of {of}" if of else ""))


gate("upto appears in all 20 families (§4)", len({r["family"] for r in upto}) == 20,
     str(len({r["family"] for r in upto})))
spread("upto spread over price tiers (§4)", upto, "price", 8, 10)
gate("upto on both resource types (§4)", len({r["type"] for r in upto}) == 2,
     str(dict(collections.Counter(r["type"] for r in upto))))
gate("upto on both input methods (§4)",
     len({r["method"] for r in upto if r["method"] != "—"}) == 2)
gate("mcp in >=8 families (§4)", len({r["family"] for r in mcp}) >= 8,
     str(len({r["family"] for r in mcp})))
spread("mcp spread over price tiers (§4)", mcp, "price", 8, 10)
spread("adversarial spread over price tiers (§4)", adv, "price", 6, 10)
spread("sparse spread over price tiers (§4)", sparse, "price", 5, 10)

# network must not track any tag
base = collections.Counter(r["network"] for r in rows)
for label, subset in (("mcp", mcp), ("upto", upto), ("adversarial", adv), ("sparse", sparse)):
    obs = collections.Counter(r["network"] for r in subset)
    n = len(subset)
    drift = max(abs(obs[k] / n - base[k] / 100) for k in NETWORKS)
    gate(f"{label} network mix tracks the corpus baseline (§4)", drift <= 0.15,
         f"max drift {drift:.0%} — {dict(obs)}")

# no tag may own more than half of any price tier
for label, subset in (("mcp", mcp), ("adversarial", adv), ("sparse", sparse)):
    per_tier = collections.Counter(r["price"] for r in subset)
    worst = max(per_tier.values()) if per_tier else 0
    gate(f"{label} never exceeds 2 slots in one price tier (§4)", worst <= 2, f"max {worst}")

# --- report --------------------------------------------------------------------------------------
print("\n-- distribution summary --")
for key in ("type", "method", "shape", "output", "coverage", "freshness",
            "network", "scheme", "attestation"):
    c = collections.Counter(r[key] for r in rows)
    print(f"  {key:12s} " + "  ".join(f"{k}:{v}" for k, v in sorted(c.items(), key=lambda kv: -kv[1])))
print("  price        " + "  ".join(f"{t}:{sum(1 for r in rows if r['price'] == t)}" for t in TIERS))
print("  adv kinds    " + "  ".join(f"{k}:{v}" for k, v in sorted(collections.Counter(r["adversarial"] for r in adv).items())))
overlap = [r for r in rows if len(r["tags"]) + (1 if r["type"] == "mcp" else 0) > 1]
print(f"  overlaps     {', '.join(r['id'] for r in overlap)} (orthogonal tags, §0.2b)")

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f_ in failures:
        print("  -", f_)
    sys.exit(1)
print("\nfamilies.md: all checkable gates pass")
