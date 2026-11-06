from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import pytest

from app.contract import Case, Metric, ScoreRequest


def make_request(**overrides: Any) -> dict[str, Any]:
    request: dict[str, Any] = {
        "task": "score",
        "metrics": ["faithfulness", "context_recall"],
        "judge": {"model": "judge-model", "base_url": None, "api_key_env": None},
        "concurrency": 2,
        "cases": [
            {
                "case_id": f"tc-00{n}",
                "question": f"question {n}?",
                "ground_truth": f"truth {n}",
                "answer": f"answer {n}",
                "contexts": [f"context {n}"],
            }
            for n in (1, 2, 3)
        ],
    }
    request.update(overrides)
    return request


class FakeScorer:
    """Returns scripted outcomes: a float, None, NaN, or an exception to raise."""

    def __init__(self, outcomes: Mapping[tuple[str, str], Any] | None = None, default: float = 0.5):
        self.outcomes = dict(outcomes or {})
        self.default = default
        self.calls: list[tuple[str, str]] = []

    async def score(self, metric: Metric, case: Case) -> float | None:
        self.calls.append((metric, case.case_id))
        outcome = self.outcomes.get((metric, case.case_id), self.default)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


@pytest.fixture
def request_dict() -> dict[str, Any]:
    return make_request()


@pytest.fixture
def factory() -> Callable[[FakeScorer], Callable[[ScoreRequest, Mapping[str, str]], FakeScorer]]:
    def wrap(scorer: FakeScorer) -> Callable[[ScoreRequest, Mapping[str, str]], FakeScorer]:
        return lambda _request, _env: scorer

    return wrap
