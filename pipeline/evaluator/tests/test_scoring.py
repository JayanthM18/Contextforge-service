from __future__ import annotations

import asyncio
import math

import pytest

from app.contract import ScoreRequest
from app.errors import JudgeUnavailable
from app.scoring import NAN_REASON, find_fatal, score_cases

from .conftest import FakeScorer, make_request


def run(request: dict, scorer: FakeScorer):
    return asyncio.run(score_cases(ScoreRequest.model_validate(request), scorer))


def test_every_case_gets_every_metric_in_request_order() -> None:
    results = run(make_request(), FakeScorer(default=0.7))

    assert [r.case_id for r in results] == ["tc-001", "tc-002", "tc-003"]
    for result in results:
        assert result.scores == {"faithfulness": 0.7, "context_recall": 0.7}
        assert result.errors == {}


def test_nan_becomes_null_with_a_reason_never_a_number() -> None:
    scorer = FakeScorer({("faithfulness", "tc-002"): math.nan})
    result = run(make_request(), scorer)[1]

    assert result.scores["faithfulness"] is None
    assert result.errors["faithfulness"] == NAN_REASON
    assert result.scores["context_recall"] == 0.5


def test_none_becomes_null_with_a_reason() -> None:
    result = run(make_request(), FakeScorer({("context_recall", "tc-001"): None}))[0]

    assert result.scores["context_recall"] is None
    assert "context_recall" in result.errors


def test_one_failing_metric_does_not_fail_the_case_or_the_run() -> None:
    scorer = FakeScorer({("faithfulness", "tc-003"): ValueError("judge returned prose, not JSON")})
    results = run(make_request(), scorer)

    assert results[2].scores["faithfulness"] is None
    assert results[2].errors["faithfulness"] == "ValueError: judge returned prose, not JSON"
    assert results[2].scores["context_recall"] == 0.5
    assert all(r.errors == {} for r in results[:2])


def test_an_out_of_range_score_is_refused_rather_than_clipped() -> None:
    result = run(make_request(), FakeScorer({("faithfulness", "tc-001"): 1.7}))[0]

    assert result.scores["faithfulness"] is None
    assert "outside the valid range" in result.errors["faithfulness"]


def test_float_noise_at_the_boundary_is_clamped_not_refused() -> None:
    result = run(make_request(), FakeScorer({("faithfulness", "tc-001"): 1.0000000001}))[0]

    assert result.scores["faithfulness"] == 1.0


def test_an_unavailable_judge_stops_the_run_and_surfaces_unwrapped() -> None:
    scorer = FakeScorer({("faithfulness", "tc-001"): JudgeUnavailable("401 bad key")})

    with pytest.raises(JudgeUnavailable, match="401 bad key"):
        run(make_request(), scorer)


def test_concurrency_is_bounded() -> None:
    in_flight = 0
    peak = 0

    class SlowScorer:
        async def score(self, metric, case):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            return 0.5

    request = ScoreRequest.model_validate(make_request(concurrency=2))
    asyncio.run(score_cases(request, SlowScorer()))

    assert peak == 2


def test_an_empty_case_list_scores_nothing() -> None:
    assert run(make_request(cases=[]), FakeScorer()) == []


class _Fake(Exception):
    pass


def _named(name: str, module: str) -> type[Exception]:
    return type(name, (Exception,), {"__module__": module})


def test_find_fatal_sees_through_wrapping() -> None:
    AuthenticationError = _named("AuthenticationError", "openai")
    inner = AuthenticationError("invalid key")
    try:
        try:
            raise inner
        except Exception as error:
            raise RuntimeError("instructor retries exhausted") from error
    except RuntimeError as outer:
        assert find_fatal(outer) is inner


def test_find_fatal_ignores_same_named_errors_from_other_libraries() -> None:
    assert find_fatal(_named("NotFoundError", "somewhere_else")("x")) is None


def test_find_fatal_ignores_ordinary_errors() -> None:
    assert find_fatal(ValueError("bad JSON")) is None
