"""Scoring cases, independent of how a single metric is computed.

`score_cases` owns concurrency, ordering and the rule that a score is either a
real number in [0, 1] or null with a reason. `RagasScorer` owns the Ragas
calls. Keeping them apart is what lets the tests exercise every rule here
without a judge, a network or Ragas installed.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Mapping
from typing import Any, Protocol

from .contract import Case, CaseResult, Metric, ScoreRequest
from .errors import JudgeUnavailable

log = logging.getLogger("contextforge.evaluator")

NAN_REASON = (
    "the metric produced no score (NaN); the judge's output contained nothing to "
    "score, such as zero statements or zero generated questions"
)


class MetricScorer(Protocol):
    async def score(self, metric: Metric, case: Case) -> float | None: ...


async def _score_one(
    scorer: MetricScorer, metric: Metric, case: Case, gate: asyncio.Semaphore
) -> tuple[float | None, str | None]:
    async with gate:
        try:
            value = await scorer.score(metric, case)
        except JudgeUnavailable:
            raise
        except Exception as error:  # noqa: BLE001 — one metric failing must not end the run
            return None, f"{type(error).__name__}: {error}"

    if value is None or math.isnan(value):
        return None, NAN_REASON
    if not -1e-9 <= value <= 1 + 1e-9:
        return None, f"the metric returned {value}, outside the valid range 0 to 1"
    return min(max(value, 0.0), 1.0), None


async def score_cases(request: ScoreRequest, scorer: MetricScorer) -> list[CaseResult]:
    gate = asyncio.Semaphore(request.concurrency)
    total = len(request.cases)
    done = 0

    async def score_case(case: Case) -> CaseResult:
        nonlocal done
        outcomes = await asyncio.gather(
            *(_score_one(scorer, metric, case, gate) for metric in request.metrics)
        )
        scores: dict[str, float | None] = {}
        errors: dict[str, str] = {}
        for metric, (value, reason) in zip(request.metrics, outcomes, strict=True):
            scores[metric] = value
            if reason is not None:
                errors[metric] = reason
        done += 1
        log.info("scored %d/%d cases", done, total)
        return CaseResult(case_id=case.case_id, scores=scores, errors=errors)

    # A TaskGroup cancels every sibling as soon as one raises, so an
    # unreachable judge stops the run immediately instead of after every case
    # has timed out in turn.
    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(score_case(case)) for case in request.cases]
    except* JudgeUnavailable as failures:
        # Callers should see the judge failure itself, not an ExceptionGroup.
        raise failures.exceptions[0] from None
    return [task.result() for task in tasks]


# Exceptions that mean the judge as a whole is unusable. Anything else is
# treated as a failure of that one metric on that one case.
_FATAL_OPENAI_ERRORS = (
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "APIConnectionError",
)


def find_fatal(error: BaseException, depth: int = 0) -> BaseException | None:
    """The first fatal client error anywhere in the chain.

    Instructor and Ragas both wrap the underlying client error, sometimes more
    than once, so the type of the outer exception says nothing reliable.
    """
    if depth > 8:
        return None
    from .gemini_embeddings import GeminiEmbeddingError

    if isinstance(error, GeminiEmbeddingError):
        return error
    if type(error).__name__ in _FATAL_OPENAI_ERRORS and type(error).__module__.startswith("openai"):
        return error
    for inner in (error.__cause__, error.__context__, getattr(error, "last_exception", None)):
        if isinstance(inner, BaseException):
            found = find_fatal(inner, depth + 1)
            if found is not None:
                return found
    return None


class RagasScorer:
    """The four metrics, each built once and shared across cases."""

    def __init__(self, request: ScoreRequest, env: Mapping[str, str]) -> None:
        from ragas.embeddings.base import embedding_factory
        from ragas.llms.base import llm_factory
        from ragas.metrics.collections import (
            AnswerRelevancy,
            ContextPrecisionWithReference,
            ContextRecall,
            Faithfulness,
        )

        from .endpoints import make_client
        from .gemini_embeddings import GeminiEmbeddings
        from .endpoints import resolve_api_key
        judge = request.judge
        # Temperature is explicit because Ragas defaults to 0.01; seed is endpoint-dependent.
        llm = llm_factory(
            judge.model,
            client=make_client(judge, env, "judge"),
            temperature=judge.temperature,
            **({} if judge.seed is None else {"seed": judge.seed}),
            # Only when set: non-reasoning models reject the parameter.
            **({} if judge.reasoning_effort is None else {"reasoning_effort": judge.reasoning_effort}),
        )

        self._metrics: dict[str, Any] = {}
        for metric in request.metrics:
            if metric == "faithfulness":
                self._metrics[metric] = Faithfulness(llm=llm)
            elif metric == "context_recall":
                self._metrics[metric] = ContextRecall(llm=llm)
            elif metric == "context_precision":
                self._metrics[metric] = ContextPrecisionWithReference(llm=llm)
            elif metric == "answer_relevancy":
                assert request.embeddings is not None  # enforced by the contract
                if request.embeddings.provider == "gemini":
                    embeddings = GeminiEmbeddings(
                        model=request.embeddings.model,
                        api_key=resolve_api_key(request.embeddings, env, "embeddings"),
                        base_url=request.embeddings.base_url,
                    )
                else:
                    embeddings = embedding_factory(
                        "openai",
                        model=request.embeddings.model,
                        client=make_client(request.embeddings, env, "embeddings"),
                    )
                self._metrics[metric] = AnswerRelevancy(llm=llm, embeddings=embeddings)

    async def score(self, metric: Metric, case: Case) -> float | None:
        scorer = self._metrics[metric]
        try:
            if metric == "faithfulness":
                result = await scorer.ascore(
                    user_input=case.question,
                    response=case.answer,
                    retrieved_contexts=case.contexts,
                )
            elif metric == "context_recall":
                result = await scorer.ascore(
                    user_input=case.question,
                    retrieved_contexts=case.contexts,
                    reference=case.ground_truth,
                )
            elif metric == "context_precision":
                result = await scorer.ascore(
                    user_input=case.question,
                    reference=case.ground_truth,
                    retrieved_contexts=case.contexts,
                )
            else:
                result = await scorer.ascore(user_input=case.question, response=case.answer)
        except Exception as error:
            fatal = find_fatal(error)
            if fatal is not None:
                raise JudgeUnavailable(
                    f"the judge failed with {type(fatal).__name__}: {fatal}"
                ) from error
            raise

        value = result.value
        return None if value is None else float(value)
