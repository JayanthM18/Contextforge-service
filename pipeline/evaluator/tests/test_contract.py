from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.contract import ScoreRequest

from .conftest import make_request


def test_a_valid_request_parses() -> None:
    request = ScoreRequest.model_validate(make_request())
    assert [case.case_id for case in request.cases] == ["tc-001", "tc-002", "tc-003"]


def test_judge_defaults_to_temperature_zero_not_ragas_default() -> None:
    assert ScoreRequest.model_validate(make_request()).judge.temperature == 0


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError, match="extra"):
        ScoreRequest.model_validate(make_request(surprise=True))


def test_unknown_metric_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ScoreRequest.model_validate(make_request(metrics=["bleu"]))


def test_answer_relevancy_requires_embeddings() -> None:
    with pytest.raises(ValidationError, match="embeddings are required for answer_relevancy"):
        ScoreRequest.model_validate(make_request(metrics=["answer_relevancy"]))


def test_answer_relevancy_with_embeddings_is_accepted() -> None:
    request = make_request(
        metrics=["answer_relevancy"],
        embeddings={
            "provider": "gemini",
            "model": "gemini-embedding-001",
            "api_key_env": "GEMINI_API_KEY",
        },
    )
    parsed = ScoreRequest.model_validate(request)
    assert parsed.embeddings is not None
    assert parsed.embeddings.provider == "gemini"


def test_gemini_embeddings_require_a_named_key() -> None:
    request = make_request(
        metrics=["answer_relevancy"],
        embeddings={"provider": "gemini", "model": "gemini-embedding-001", "api_key_env": None},
    )
    with pytest.raises(ValidationError, match="api_key_env is required when provider is gemini"):
        ScoreRequest.model_validate(request)


def test_judge_must_use_the_openai_compatible_protocol() -> None:
    request = make_request()
    request["judge"]["provider"] = "gemini"
    with pytest.raises(ValidationError):
        ScoreRequest.model_validate(request)


def test_duplicate_case_ids_are_rejected() -> None:
    request = make_request()
    request["cases"][1]["case_id"] = "tc-001"
    with pytest.raises(ValidationError, match="appears more than once"):
        ScoreRequest.model_validate(request)
