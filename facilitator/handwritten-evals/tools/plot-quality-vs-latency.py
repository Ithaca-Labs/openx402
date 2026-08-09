import json
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

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
OUT = "/home/soumy/.claude/jobs/6e0348e9/tmp"

BLUE = "#2E5EAA"
ORANGE = "#E07A3E"
GREEN = "#3E9C71"
GREY = "#9AA5B1"
RED_HYBRID = "#D9776B"

def scatter_chart(points, filename, title, subtitle, xlabel, xscale, xlim, ylim):
    fig, ax = plt.subplots(figsize=(10.5, 7.8))
    fig.text(0.5, 0.95, title, ha="center", fontsize=16.5, fontweight="bold", color="#1a1a1a")
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

    # single diagonal "better" arrow, top-left corner
    ax.annotate("", xy=(0.03, 0.97), xytext=(0.22, 0.80), xycoords="axes fraction",
                arrowprops=dict(arrowstyle="-|>", color="#2a2a2a", lw=2))
    ax.text(0.235, 0.795, "better\n(higher quality, lower latency)", transform=ax.transAxes, fontsize=10,
            color="#2a2a2a", va="top", ha="left", fontweight="bold", linespacing=1.4)

    plt.savefig(f"{OUT}/{filename}", dpi=180)
    plt.close()
    print(f"saved {filename}")

# ============================================================
# CHART 5: Embedding models — nDCG@10 vs p95 latency (log scale)
# ============================================================
points = [
    ("Qwen3-Embedding-8B", bakeoff["qwen3_embedding_8b"]["latency_ms"]["p95"], bakeoff["qwen3_embedding_8b"]["quality"]["ndcg_at_10"], ORANGE, -14, -4),
    ("Voyage-4", bakeoff["voyage_4"]["latency_ms"]["p95"], bakeoff["voyage_4"]["quality"]["ndcg_at_10"], GREEN, 12, 6),
    ("OpenAI-large", bakeoff["openai_large"]["latency_ms"]["p95"], bakeoff["openai_large"]["quality"]["ndcg_at_10"], BLUE, 12, -4),
    ("OpenAI-small", bakeoff["openai_small"]["latency_ms"]["p95"], bakeoff["openai_small"]["quality"]["ndcg_at_10"], "#7FA8D9", 12, 6),
]
scatter_chart(
    points, "chart_5_embedding_quality_vs_latency.png",
    "Retrieval quality vs. latency", "Embedding models · nDCG@10 vs. p95 single-query latency",
    "p95 latency, ms (log scale)", "log", (500, 30000), (0.755, 0.86),
)

# ============================================================
# CHART 6: Real production fusion systems — nDCG@10 vs p95 latency
# ============================================================
import statistics
def p95(rows):
    lats = sorted(r["latency_ms"] for r in rows)
    return lats[int(len(lats) * 0.95)]

def readjsonl(path):
    return [json.loads(l) for l in open(f"/home/soumy/x402-stellar-DIY/facilitator/handwritten-evals/runs/{path}")]

lat_lexical = p95(readjsonl("real-lexical-v2.jsonl"))
lat_semantic = p95(readjsonl("real-semantic-v2.jsonl"))
lat_hybrid_shipped = p95(readjsonl("real-hybrid-v2.jsonl"))
lat_hybrid_tuned = p95(readjsonl("real-hybrid-tuned-v2.jsonl"))

points2 = [
    ("Hybrid, tuned", lat_hybrid_tuned, dev["real_hybrid_tuned"]["ndcg_at_10"], GREEN, -14, 10),
    ("Semantic (bge-m3)", lat_semantic, dev["real_semantic"]["ndcg_at_10"], ORANGE, 12, -12),
    ("Hybrid, shipped default", lat_hybrid_shipped, dev["real_hybrid_production_default"]["ndcg_at_10"], RED_HYBRID, -14, -14),
    ("Lexical (ts_rank_cd)", lat_lexical, dev["real_lexical"]["ndcg_at_10"], GREY, 12, 6),
]
scatter_chart(
    points2, "chart_6_fusion_quality_vs_latency.png",
    "Retrieval quality vs. latency", "Real production facilitator search · nDCG@10 vs. p95 end-to-end query latency",
    "p95 latency, ms", "linear", (0, 420), (0.45, 0.82),
)
