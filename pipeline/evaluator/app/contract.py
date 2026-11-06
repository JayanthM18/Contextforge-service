"""The JSON contract with the TypeScript core, from docs/DESIGN.md section 7.

Every model forbids unknown fields. The core and the evaluator are versioned
together, so an unexpected field means they have drifted apart, and scoring
against a request neither side fully understands is worse than failing.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Metric = Literal["context_precision", "context_recall", "faithfulness", "answer_relevancy"]

METRICS_NEEDING_EMBEDDINGS: frozenset[str] = frozenset({"answer_relevancy"})


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Endpoint(Strict):
    provider: Literal["openai", "gemini"] = "openai"
    model: str = Field(min_length=1)
    base_url: str | None = None
    api_key_env: str | None = None

    @model_validator(mode="after")
    def _check(self) -> Endpoint:
        if self.provider == "gemini" and self.api_key_env is None:
            raise ValueError("api_key_env is required when provider is gemini")
        return self


class Judge(Endpoint):
    provider: Literal["openai"] = "openai"
    temperature: float = Field(default=0, ge=0, le=2)
    seed: int = 42
    # Sent to the judge only when set; see docs/DESIGN.md section 2.
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high"] | None = None


class Case(Strict):
    case_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    ground_truth: str
    answer: str
    contexts: list[str]


class ScoreRequest(Strict):
    task: Literal["score"]
    metrics: list[Metric] = Field(min_length=1)
    judge: Judge
    embeddings: Endpoint | None = None
    concurrency: int = Field(default=4, ge=1, le=32)
    cases: list[Case]

    @model_validator(mode="after")
    def _check(self) -> ScoreRequest:
        needing = sorted(set(self.metrics) & METRICS_NEEDING_EMBEDDINGS)
        if needing and self.embeddings is None:
            raise ValueError(f"embeddings are required for {', '.join(needing)}")

        seen: set[str] = set()
        for case in self.cases:
            if case.case_id in seen:
                raise ValueError(f"case_id {case.case_id!r} appears more than once")
            seen.add(case.case_id)
        return self


class CaseResult(Strict):
    case_id: str
    scores: dict[str, float | None]
    errors: dict[str, str] = Field(default_factory=dict)


class EvaluatorInfo(Strict):
    ragas_version: str
    judge_model: str
    embeddings_model: str | None


class ScoreResponse(Strict):
    evaluator: EvaluatorInfo
    results: list[CaseResult]


# ---------------------------------------------------------------------------
# Test-set generation (stage 4)
# ---------------------------------------------------------------------------


class SourceDocument(Strict):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class GenerateRequest(Strict):
    task: Literal["generate"]
    size: int = Field(ge=1, le=1000)
    judge: Judge
    embeddings: Endpoint
    documents: list[SourceDocument] = Field(min_length=1)


class GeneratedCase(Strict):
    question: str = Field(min_length=1)
    ground_truth: str = Field(min_length=1)
    reference_document_ids: list[str]
    hops: Literal["single", "multi"]


class GeneratorInfo(Strict):
    tool: str
    version: str
    model: str


class GenerateResponse(Strict):
    generator: GeneratorInfo
    cases: list[GeneratedCase]
