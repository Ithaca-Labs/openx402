#!/usr/bin/env python3
"""Generates all 6 benchmark charts from reports/embedding-bakeoff-v2.json and
reports/dev-evaluation-v2-simplified.json. Writes PNGs to reports/charts/.

    uv run --with matplotlib --with numpy python3 tools/charts/plot-charts.py

(or: pip install matplotlib numpy && python3 tools/charts/plot-charts.py)
"""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "charts"
OUT.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "axes.edgecolor": "#333333",
    "text.color": "#1a1a1a",
    "xtick.color": "#333333",
    "ytick.color": "#1a1a1a",
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.facecolor": "white",
})

BLUE = "#2E5EAA"
ORANGE = "#E07A3E"
GREEN = "#3E9C71"
GREY = "#9AA5B1"
RED = "#C0392B"
RED_HYBRID = "#D9776B"

bakeoff = json.loads((ROOT / "reports" / "embedding-bakeoff-v2.json").read_text())["models"]
dev = json.loads((ROOT / "reports" / "dev-evaluation-v2-simplified.json").read_text())["systems"]


def title(fig, main, sub):
    fig.suptitle(main, fontsize=16.5, fontweight="bold", y=1.03)
    fig.text(0.5, 0.975, sub, ha="center", fontsize=11, color="#666666")


def clean(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#e8e8e8", zorder=0)
    ax.set_axisbelow(True)


def fusion_chart(rows, filename, subtitle):
    labels = [r[0] for r in rows]
    values = [r[1] for r in rows]
    colors = [r[2] for r in rows]
    fig, ax = plt.subplots(figsize=(10, 7.5))
    bars = ax.barh(labels, values, color=colors, height=0.55, edgecolor="white", linewidth=0.6, zorder=3)
    for bar, v in zip(bars, values):
        ax.text(v + 0.015, bar.get_y() + bar.get_height() / 2, f"{v:.3f}", va="center", fontsize=12.5, fontweight="bold")
    ax.set_xlim(0, 0.95)
    ax.set_xlabel("nDCG@10", fontsize=12)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0, labelsize=13)
    ax.grid(axis="x", color="#e8e8e8", zorder=0)
    ax.set_axisbelow(True)
    fig.text(0.5, 0.95, "Search fusion comparison", ha="center", fontsize=16.5, fontweight="bold", color="#1a1a1a")
    fig.text(0.5, 0.90, subtitle, ha="center", fontsize=11, color="#666666")
    fig.subplots_adjust(top=0.78, bottom=0.1, left=0.3, right=0.95)
    plt.savefig(OUT / filename, dpi=180)
    plt.close()
    print(f"saved {filename}")


def scatter_chart(points, filename, chart_title, subtitle, xlabel, xscale, xlim, ylim):
    fig, ax = plt.subplots(figsize=(10.5, 7.8))
    fig.text(0.5, 0.95, chart_title, ha="center", fontsize=16.5, fontweight="bold", color="#1a1a1a")
    fig.text(0.5, 0.895, subtitle, ha="center", fontsize=11, color="#666666")
    fig.subplots_adjust(top=0.78, bottom=0.11, left=0.12, right=0.95)

    for label, x, y, color, dx, dy in points:
        ax.scatter(x, y, s=320, color=color, edgecolor="white", linewidth=1.8, zorder=4)
        ax.annotate(label, (x, y), textcoords="offset points", xytext=(dx, dy),
                    fontsize=12.5, fontweight="bold", color=color, ha="left" if dx >= 0 else "right")

    if xscale == "log":
        ax.set_xscale("log")
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_xlabel(xlabel, fontsize=12)
    ax.set_ylabel("nDCG@10", fontsize=12)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, color="#eeeeee", zorder=0)
    ax.set_axisbelow(True)

    ax.annotate("", xy=(0.03, 0.97), xytext=(0.22, 0.80), xycoords="axes fraction",
                arrowprops=dict(arrowstyle="-|>", color="#2a2a2a", lw=2))
    ax.text(0.235, 0.795, "better\n(higher quality, lower latency)", transform=ax.transAxes, fontsize=10,
            color="#2a2a2a", va="top", ha="left", fontweight="bold", linespacing=1.4)

    plt.savefig(OUT / filename, dpi=180)
    plt.close()
    print(f"saved {filename}")


def readjsonl(path):
    return [json.loads(l) for l in (ROOT / "runs" / path).read_text().splitlines() if l.strip()]


def p95(rows):
    lats = sorted(r["latency_ms"] for r in rows)
    return lats[int(len(lats) * 0.95)]


# CHART 1: Embedding quality -- grouped bars
order = ["openai_large", "openai_small", "qwen3_embedding_8b", "voyage_4"]
model_labels = ["OpenAI-large\n(3072d)", "OpenAI-small\n(1536d)", "Qwen3-Embedding-8B\n(4096d)", "Voyage-4\n(1024d)"]
model_colors = [BLUE, "#7FA8D9", ORANGE, GREEN]
metrics = ["mrr", "ndcg_at_10", "recall_at_20", "bpref"]
metric_labels = ["MRR", "nDCG@10", "Recall@20", "bpref"]

fig, ax = plt.subplots(figsize=(11, 6))
x = np.arange(len(metrics))
w = 0.2
for i, m in enumerate(order):
    vals = [bakeoff[m]["quality"][k] for k in metrics]
    offset = (i - 1.5) * w
    bars = ax.bar(x + offset, vals, w, color=model_colors[i], label=model_labels[i].split("\n")[0], edgecolor="white", linewidth=0.5, zorder=3)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width() / 2, v + 0.015, f"{v:.3f}", ha="center", fontsize=8)
ax.set_xticks(x)
ax.set_xticklabels(metric_labels, fontsize=12.5)
ax.set_ylim(0, 1.08)
clean(ax)
ax.legend(frameon=False, fontsize=10.5, loc="lower center", bbox_to_anchor=(0.5, -0.24), ncol=4)
title(fig, "Embedding model bakeoff — retrieval quality", "Stellar Bazaar v2 benchmark · development split · 50 queries")
plt.tight_layout(rect=[0, 0.05, 1, 0.90])
plt.savefig(OUT / "chart_1_embedding_quality.png", dpi=180, bbox_inches="tight")
plt.close()
print("saved chart_1_embedding_quality.png")

# CHART 2: Embedding latency -- p50/p95, log scale
fig, ax = plt.subplots(figsize=(10, 6))
x = np.arange(len(order))
w = 0.32
p50 = [bakeoff[m]["latency_ms"]["p50"] for m in order]
p95_vals = [bakeoff[m]["latency_ms"]["p95"] for m in order]
ax.bar(x - w / 2, p50, w, label="p50", color=BLUE, edgecolor="white", linewidth=0.5, zorder=3)
ax.bar(x + w / 2, p95_vals, w, label="p95", color=RED, edgecolor="white", linewidth=0.5, zorder=3)
ax.set_yscale("log")
ax.set_xticks(x)
ax.set_xticklabels(model_labels, fontsize=11)
ax.set_ylabel("milliseconds (log scale)", fontsize=11)
clean(ax)
ax.legend(frameon=False, fontsize=11, loc="upper left")
for i, (a, b) in enumerate(zip(p50, p95_vals)):
    ax.annotate(f"{a:,.0f}", (i - w / 2, a), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=9.5, fontweight="bold")
    ax.annotate(f"{b:,.0f}", (i + w / 2, b), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=9.5, fontweight="bold")
ax.yaxis.set_major_formatter(mticker.ScalarFormatter())
ax.set_ylim(300, 30000)
title(fig, "Embedding model bakeoff — single-query latency", "Stellar Bazaar v2 benchmark · 20 timed samples per model")
plt.tight_layout(rect=[0, 0, 1, 0.90])
plt.savefig(OUT / "chart_2_embedding_latency.png", dpi=180, bbox_inches="tight")
plt.close()
print("saved chart_2_embedding_latency.png")

# CHART 3 + 4: Fusion comparison, real production vs stand-in
fusion_chart(
    [
        ("ts_rank_cd (lexical)", dev["real_lexical"]["ndcg_at_10"], GREY),
        ("bge-m3 (semantic)", dev["real_semantic"]["ndcg_at_10"], ORANGE),
        ("hybrid, shipped default\n(0.7 lex / 0.3 sem, k=20)", dev["real_hybrid_production_default"]["ndcg_at_10"], RED_HYBRID),
        ("hybrid, tuned\n(0.2 lex / 0.8 sem, k=6)", dev["real_hybrid_tuned"]["ndcg_at_10"], GREEN),
    ],
    "chart_3_fusion_real_production.png",
    "Real production facilitator code · Postgres ts_rank_cd + self-hosted bge-m3",
)
fusion_chart(
    [
        ("BM25 (lexical)", dev["bm25"]["ndcg_at_10"], GREY),
        ("OpenAI-large (dense)", dev["exact_dense"]["ndcg_at_10"], ORANGE),
        ("hybrid, naive\n(equal weight, k=20)", dev["hybrid_exact_naive_equal_weight"]["ndcg_at_10"], RED_HYBRID),
        ("hybrid, tuned\n(0.2 lex / 0.8 dense, k=6)", dev["hybrid_tuned"]["ndcg_at_10"], GREEN),
    ],
    "chart_4_fusion_standin.png",
    "Pool-build stand-in implementation · brute-force BM25 + OpenAI text-embedding-3-large",
)

# CHART 5: Embedding models -- nDCG@10 vs p95 latency (log scale)
scatter_chart(
    [
        ("Qwen3-Embedding-8B", bakeoff["qwen3_embedding_8b"]["latency_ms"]["p95"], bakeoff["qwen3_embedding_8b"]["quality"]["ndcg_at_10"], ORANGE, -14, -4),
        ("Voyage-4", bakeoff["voyage_4"]["latency_ms"]["p95"], bakeoff["voyage_4"]["quality"]["ndcg_at_10"], GREEN, 12, 6),
        ("OpenAI-large", bakeoff["openai_large"]["latency_ms"]["p95"], bakeoff["openai_large"]["quality"]["ndcg_at_10"], BLUE, 12, -4),
        ("OpenAI-small", bakeoff["openai_small"]["latency_ms"]["p95"], bakeoff["openai_small"]["quality"]["ndcg_at_10"], "#7FA8D9", 12, 6),
    ],
    "chart_5_embedding_quality_vs_latency.png",
    "Retrieval quality vs. latency", "Embedding models · nDCG@10 vs. p95 single-query latency",
    "p95 latency, ms (log scale)", "log", (500, 30000), (0.755, 0.86),
)

# CHART 6: Real production fusion systems -- nDCG@10 vs p95 latency
lat_lexical = p95(readjsonl("real-lexical-v2.jsonl"))
lat_semantic = p95(readjsonl("real-semantic-v2.jsonl"))
lat_hybrid_shipped = p95(readjsonl("real-hybrid-v2.jsonl"))
lat_hybrid_tuned = p95(readjsonl("real-hybrid-tuned-v2.jsonl"))

scatter_chart(
    [
        ("Hybrid, tuned", lat_hybrid_tuned, dev["real_hybrid_tuned"]["ndcg_at_10"], GREEN, -14, 10),
        ("Semantic (bge-m3)", lat_semantic, dev["real_semantic"]["ndcg_at_10"], ORANGE, 12, -12),
        ("Hybrid, shipped default", lat_hybrid_shipped, dev["real_hybrid_production_default"]["ndcg_at_10"], RED_HYBRID, -14, -14),
        ("Lexical (ts_rank_cd)", lat_lexical, dev["real_lexical"]["ndcg_at_10"], GREY, 12, 6),
    ],
    "chart_6_fusion_quality_vs_latency.png",
    "Retrieval quality vs. latency", "Real production facilitator search · nDCG@10 vs. p95 end-to-end query latency",
    "p95 latency, ms", "linear", (0, 420), (0.45, 0.82),
)

print(f"\ndone. Charts written to {OUT}")
