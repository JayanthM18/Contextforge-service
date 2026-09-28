"""The stage 3 gate: the same input scored twice at temperature 0 agrees.

Calls a real judge, so it is skipped unless CONTEXTFORGE_EVALUATOR_INTEGRATION=1.
The judge comes from fixtures/sample-results.json unless overridden:

    JUDGE_MODEL, JUDGE_BASE_URL, JUDGE_API_KEY_ENV, JUDGE_REASONING_EFFORT
    EMBEDDINGS_MODEL, EMBEDDINGS_BASE_URL, EMBEDDINGS_API_KEY_ENV

An empty *_API_KEY_ENV means "no key", for a local server.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from statistics import fmean

import pytest

from app.contract import ScoreRequest
from app.scoring import RagasScorer, score_cases

FIXTURE = Path(__file__).parent.parent / "fixtures" / "sample-results.json"

# Provisional. Replace with the spread measured in stage 6 and record the
# judge that produced it in docs/MEMORY.md (docs/DESIGN.md section 4).
MEAN_TOLERANCE = 0.05

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("CONTEXTFORGE_EVALUATOR_INTEGRATION") != "1",
        reason="set CONTEXTFORGE_EVALUATOR_INTEGRATION=1 to call a real judge",
    ),
]


def _override(section: dict, prefix: str) -> None:
    if value := os.environ.get(f"{prefix}_MODEL"):
        section["model"] = value
    if f"{prefix}_BASE_URL" in os.environ:
        section["base_url"] = os.environ[f"{prefix}_BASE_URL"] or None
    if f"{prefix}_API_KEY_ENV" in os.environ:
        section["api_key_env"] = os.environ[f"{prefix}_API_KEY_ENV"] or None


def _request() -> ScoreRequest:
    raw = json.loads(FIXTURE.read_text())
    _override(raw["judge"], "JUDGE")
    if effort := os.environ.get("JUDGE_REASONING_EFFORT"):
        raw["judge"]["reasoning_effort"] = effort
    _override(raw["embeddings"], "EMBEDDINGS")
    return ScoreRequest.model_validate(raw)


def _means(results) -> dict[str, float]:
    metrics = results[0].scores.keys()
    return {
        metric: fmean(v for r in results if (v := r.scores[metric]) is not None)
        for metric in metrics
        if any(r.scores[metric] is not None for r in results)
    }


def test_scoring_the_same_input_twice_agrees_within_tolerance() -> None:
    request = _request()
    first = asyncio.run(score_cases(request, RagasScorer(request, os.environ)))
    second = asyncio.run(score_cases(request, RagasScorer(request, os.environ)))

    means_first, means_second = _means(first), _means(second)
    report = {m: (means_first[m], means_second.get(m)) for m in means_first}
    print("\nmean per metric, run 1 vs run 2:", json.dumps(report, indent=2))

    assert means_first.keys() == means_second.keys(), "a metric was null in only one run"
    for metric, value in means_first.items():
        assert abs(value - means_second[metric]) <= MEAN_TOLERANCE, (
            f"{metric} moved {abs(value - means_second[metric]):.3f} between identical runs"
        )


def test_an_unfaithful_answer_scores_below_a_faithful_one() -> None:
    request = _request()
    results = {r.case_id: r for r in asyncio.run(score_cases(request, RagasScorer(request, os.environ)))}

    faithful = results["tc-001"].scores["faithfulness"]
    unfaithful = results["tc-003"].scores["faithfulness"]
    assert faithful is not None and unfaithful is not None
    assert unfaithful < faithful, "the judge cannot tell a fabricated answer from a grounded one"
