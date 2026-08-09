import json
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

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

bakeoff = json.load(open("/home/soumy/x402-stellar-DIY/facilitator/handwritten-evals/reports/embedding-bakeoff-v2.json"))["models"]
dev = json.load(open("/home/soumy/x402-stellar-DIY/facilitator/handwritten-evals/reports/dev-evaluation-v2-simplified.json"))["systems"]

BLUE = "#2E5EAA"
ORANGE = "#E07A3E"
GREEN = "#3E9C71"
GREY = "#9AA5B1"
RED = "#C0392B"
OUT = "/home/soumy/.claude/jobs/6e0348e9/tmp"

def title(fig, main, sub):
    fig.suptitle(main, fontsize=16.5, fontweight="bold", y=1.03)
    fig.text(0.5, 0.975, sub, ha="center", fontsize=11, color="#666666")

def clean(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#e8e8e8", zorder=0)
    ax.set_axisbelow(True)

# ============================================================
# CHART 1: Embedding quality — grouped bars
# ============================================================
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
        ax.text(bar.get_x() + bar.get_width()/2, v + 0.015, f"{v:.3f}", ha="center", fontsize=8, rotation=90 if False else 0)
ax.set_xticks(x)
ax.set_xticklabels(metric_labels, fontsize=12.5)
ax.set_ylim(0, 1.08)
clean(ax)
ax.legend(frameon=False, fontsize=10.5, loc="lower center", bbox_to_anchor=(0.5, -0.24), ncol=4)
title(fig, "Embedding model bakeoff — retrieval quality", "Stellar Bazaar v2 benchmark · development split · 50 queries")
plt.tight_layout(rect=[0, 0.05, 1, 0.90])
plt.savefig(f"{OUT}/chart_1_embedding_quality.png", dpi=180, bbox_inches="tight")
plt.close()
print("saved chart_1_embedding_quality.png")

# ============================================================
# CHART 2: Embedding latency — p50/p95, log scale
# ============================================================
fig, ax = plt.subplots(figsize=(10, 6))
x = np.arange(len(order))
w = 0.32
p50 = [bakeoff[m]["latency_ms"]["p50"] for m in order]
p95 = [bakeoff[m]["latency_ms"]["p95"] for m in order]
ax.bar(x - w/2, p50, w, label="p50", color=BLUE, edgecolor="white", linewidth=0.5, zorder=3)
ax.bar(x + w/2, p95, w, label="p95", color=RED, edgecolor="white", linewidth=0.5, zorder=3)
ax.set_yscale("log")
ax.set_xticks(x)
ax.set_xticklabels(model_labels, fontsize=11)
ax.set_ylabel("milliseconds (log scale)", fontsize=11)
clean(ax)
ax.legend(frameon=False, fontsize=11, loc="upper left")
for i, (a, b) in enumerate(zip(p50, p95)):
    ax.annotate(f"{a:,.0f}", (i - w/2, a), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=9.5, fontweight="bold")
    ax.annotate(f"{b:,.0f}", (i + w/2, b), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=9.5, fontweight="bold")
ax.yaxis.set_major_formatter(mticker.ScalarFormatter())
ax.set_ylim(300, 30000)
title(fig, "Embedding model bakeoff — single-query latency", "Stellar Bazaar v2 benchmark · 20 timed samples per model")
plt.tight_layout(rect=[0, 0, 1, 0.90])
plt.savefig(f"{OUT}/chart_2_embedding_latency.png", dpi=180, bbox_inches="tight")
plt.close()
print("saved chart_2_embedding_latency.png")

# ============================================================
# CHART 3: Fusion comparison — REAL production
# ============================================================
def fusion_chart(rows, filename, subtitle):
    labels = [r[0] for r in rows]
    values = [r[1] for r in rows]
    colors = [r[2] for r in rows]
    fig, ax = plt.subplots(figsize=(10, 7.5))
    bars = ax.barh(labels, values, color=colors, height=0.55, edgecolor="white", linewidth=0.6, zorder=3)
    for bar, v in zip(bars, values):
        ax.text(v + 0.015, bar.get_y() + bar.get_height()/2, f"{v:.3f}", va="center", fontsize=12.5, fontweight="bold")
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
    plt.savefig(f"{OUT}/{filename}", dpi=180)
    plt.close()
    print(f"saved {filename}")

fusion_chart(
    [
        ("ts_rank_cd (lexical)", dev["real_lexical"]["ndcg_at_10"], GREY),
        ("bge-m3 (semantic)", dev["real_semantic"]["ndcg_at_10"], ORANGE),
        ("hybrid, shipped default\n(0.7 lex / 0.3 sem, k=20)", dev["real_hybrid_production_default"]["ndcg_at_10"], "#D9776B"),
        ("hybrid, tuned\n(0.2 lex / 0.8 sem, k=6)", dev["real_hybrid_tuned"]["ndcg_at_10"], GREEN),
    ],
    "chart_3_fusion_real_production.png",
    "Real production facilitator code · Postgres ts_rank_cd + self-hosted bge-m3",
)

# ============================================================
# CHART 4: Fusion comparison — stand-in
# ============================================================
fusion_chart(
    [
        ("BM25 (lexical)", dev["bm25"]["ndcg_at_10"], GREY),
        ("OpenAI-large (dense)", dev["exact_dense"]["ndcg_at_10"], ORANGE),
        ("hybrid, naive\n(equal weight, k=20)", dev["hybrid_exact_naive_equal_weight"]["ndcg_at_10"], "#D9776B"),
        ("hybrid, tuned\n(0.2 lex / 0.8 dense, k=6)", dev["hybrid_tuned"]["ndcg_at_10"], GREEN),
    ],
    "chart_4_fusion_standin.png",
    "Pool-build stand-in implementation · brute-force BM25 + OpenAI text-embedding-3-large",
)
