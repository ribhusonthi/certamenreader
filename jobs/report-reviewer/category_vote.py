#!/usr/bin/env python3
"""Vote on a question's category with the Source Check search index.

reparse-sets.mjs asks this when Gemini's category for a question differs from
the stored one. The question and its answer are searched in the textbook index
(CertamenSourceRAG, search only, no answer generation), and each hit votes for
the category of the book it came from, weighted by rank. A stored category is
only changed when this vote and Gemini agree.

  python3 category_vote.py <in.jsonl> <out.json>
    in:  one {"key": ..., "text": "question ANSWER: answer"} per line
    out: {key: {"vote": category or null, "share": top category's share of the weight}}
"""
import json
import sys
from pathlib import Path

RAG = Path(__file__).resolve().parents[3] / "CertamenSourceRAG" / "scripts"
sys.path.insert(0, str(RAG))
from chat import Index  # noqa: E402

BOOK_CATEGORY = {
    "tripp": "Mythology", "morford-lenardon": "Mythology", "march": "Mythology", "grimal": "Mythology",
    "cary-scullard": "Roman History", "ward-heichelheim": "Roman History",
    "matyszak-republic": "Roman History", "scarre-emperors": "Roman History",
    "conte": "Latin Literature", "hadas": "Latin Literature",
    "adkins-handbook": "Culture", "johnston-private-life": "Culture", "claridge-rome": "Culture",
    "allen-greenough": "Language", "ehrlich-amo-amas-amat": "Language", "lodge-vocabulary": "Language",
    "brunel-vocabulary": "Language", "schaeffer-derivatives": "Language", "greenwald-derivatives": "Language",
}
TOP = 10
BATCH = 50  # questions embedded per request


def main():
    src, dst = sys.argv[1], sys.argv[2]
    rows = [json.loads(line) for line in open(src) if line.strip()]
    index = Index()
    source_of = dict(index.db.execute("SELECT id, source_id FROM chunks"))
    out = {}
    for start in range(0, len(rows), BATCH):
        batch = rows[start:start + BATCH]
        for row, ranked in zip(batch, index.vector_search([r["text"][:2000] for r in batch])):
            weights = {}
            for rank, cid in enumerate(ranked[:TOP]):
                category = BOOK_CATEGORY.get(source_of[cid])
                if category:
                    weights[category] = weights.get(category, 0) + 1 / (rank + 1)
            total = sum(weights.values())
            best = max(weights, key=weights.get) if weights else None
            out[row["key"]] = {"vote": best, "share": round(weights[best] / total, 2) if best else 0}
        print(f"  voted {min(start + BATCH, len(rows))}/{len(rows)}", flush=True)
    Path(dst).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
