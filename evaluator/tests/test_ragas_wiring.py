"""The real Ragas objects can be built from our requests, without a judge.

The other unit tests use a fake scorer and never import Ragas, so on their own
they let a broken pinned environment through: with langchain-community 0.4.2,
`import ragas` itself failed, and every test still passed. These tests build
the real objects against an unreachable endpoint. Construction makes no network
calls, so they need no judge, only the image's pinned dependencies — and they
skip anywhere Ragas is not installed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("ragas")

from app.contract import ScoreRequest  # noqa: E402
from app.scoring import RagasScorer  # noqa: E402

UNREACHABLE = "http://127.0.0.1:9/v1"


def _request() -> ScoreRequest:
    return ScoreRequest.model_validate(
        {
            "task": "score",
            "metrics": ["context_precision", "context_recall", "faithfulness", "answer_relevancy"],
            "judge": {"model": "judge", "base_url": UNREACHABLE, "api_key_env": None,
                      "temperature": 0, "seed": 42},
            "embeddings": {"model": "embed", "base_url": UNREACHABLE, "api_key_env": None},
            "cases": [],
        }
    )


def test_every_metric_builds_as_the_intended_ragas_class() -> None:
    scorer = RagasScorer(_request(), {})

    assert {name: type(m).__name__ for name, m in scorer._metrics.items()} == {
        "context_precision": "ContextPrecisionWithReference",
        "context_recall": "ContextRecall",
        "faithfulness": "Faithfulness",
        "answer_relevancy": "AnswerRelevancy",
    }


def test_temperature_and_seed_reach_the_judge_not_ragas_defaults() -> None:
    # Ragas's own default temperature is 0.01.
    args = RagasScorer(_request(), {})._metrics["faithfulness"].llm.model_args

    assert args["temperature"] == 0
    assert args["seed"] == 42


def test_the_generator_objects_build() -> None:
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.testset import TestsetGenerator

    TestsetGenerator(
        llm=LangchainLLMWrapper(ChatOpenAI(model="judge", base_url=UNREACHABLE, api_key="x", temperature=0, seed=42)),
        embedding_model=LangchainEmbeddingsWrapper(
            OpenAIEmbeddings(model="embed", base_url=UNREACHABLE, api_key="x", check_embedding_ctx_length=False)
        ),
    )
