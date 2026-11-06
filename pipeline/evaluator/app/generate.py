"""Generating a candidate test set from source documents, for a human to review.

The output is a draft. docs/DESIGN.md section 3 is explicit that the test set
is reviewed, committed and frozen; nothing here writes the frozen file.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from .contract import GenerateRequest, GeneratedCase, SourceDocument


@dataclass(frozen=True)
class RawSample:
    """One generated question, before it is mapped onto the dataset format."""

    question: str
    reference: str
    reference_contexts: Sequence[str]
    synthesizer_name: str


class SampleGenerator(Protocol):
    def generate(self, request: GenerateRequest) -> list[RawSample]: ...


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def source_documents_for(
    contexts: Sequence[str], documents: Sequence[SourceDocument]
) -> list[str]:
    """Which source documents each reference context came from.

    Ragas returns reference contexts as text, not ids. Chunk ids belong to the
    app and change whenever its chunking changes, so the frozen test set
    records the *document* each context came from — a reference that survives
    re-chunking. A context that cannot be traced is dropped rather than
    guessed at.
    """
    normalised = [(doc.id, _normalise(doc.text)) for doc in documents]
    found: list[str] = []
    for context in contexts:
        needle = _normalise(context)
        if not needle:
            continue
        for doc_id, haystack in normalised:
            if needle in haystack and doc_id not in found:
                found.append(doc_id)
                break
    return found


def to_case(sample: RawSample, documents: Sequence[SourceDocument]) -> GeneratedCase | None:
    question = sample.question.strip()
    reference = sample.reference.strip()
    if not question or not reference:
        return None
    return GeneratedCase(
        question=question,
        ground_truth=reference,
        reference_document_ids=source_documents_for(sample.reference_contexts, documents),
        hops="multi" if "multi" in sample.synthesizer_name else "single",
    )


class RagasSampleGenerator:
    """Ragas's knowledge-graph test-set generator over the source documents."""

    def __init__(self, env: Mapping[str, str]) -> None:
        self._env = env

    def generate(self, request: GenerateRequest) -> list[RawSample]:
        from langchain_core.documents import Document
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
        from ragas.llms import LangchainLLMWrapper
        from ragas.testset import TestsetGenerator

        from .endpoints import resolve_api_key, resolve_base_url
        from .gemini_embeddings import GeminiEmbeddings

        judge = request.judge
        llm = LangchainLLMWrapper(
            ChatOpenAI(
                model=judge.model,
                base_url=resolve_base_url(judge),
                api_key=resolve_api_key(judge, self._env, "judge"),
                temperature=judge.temperature,
                **({} if judge.seed is None else {"seed": judge.seed}),
                **({} if judge.reasoning_effort is None else {"reasoning_effort": judge.reasoning_effort}),
                max_retries=5,
            )
        )
        if request.embeddings.provider == "gemini":
            embeddings = GeminiEmbeddings(
                model=request.embeddings.model,
                api_key=resolve_api_key(request.embeddings, self._env, "embeddings"),
                base_url=request.embeddings.base_url,
            )
        else:
            from ragas.embeddings import LangchainEmbeddingsWrapper

            embeddings = LangchainEmbeddingsWrapper(
                OpenAIEmbeddings(
                    model=request.embeddings.model,
                    base_url=resolve_base_url(request.embeddings),
                    api_key=resolve_api_key(request.embeddings, self._env, "embeddings"),
                    # By default this client sends pre-tokenised input, which only
                    # OpenAI's own endpoint accepts. Plain strings work everywhere.
                    check_embedding_ctx_length=False,
                )
            )

        documents = [
            Document(page_content=doc.text, metadata={"source": doc.id}) for doc in request.documents
        ]
        testset = TestsetGenerator(llm=llm, embedding_model=embeddings).generate_with_langchain_docs(
            documents, testset_size=request.size, raise_exceptions=False
        )

        samples: list[RawSample] = []
        for sample in testset.samples:
            evaluation = sample.eval_sample
            samples.append(
                RawSample(
                    question=str(getattr(evaluation, "user_input", "") or ""),
                    reference=str(getattr(evaluation, "reference", "") or ""),
                    reference_contexts=list(getattr(evaluation, "reference_contexts", None) or []),
                    synthesizer_name=sample.synthesizer_name,
                )
            )
        return samples


def generate_cases(
    request: GenerateRequest, generator: SampleGenerator
) -> tuple[list[GeneratedCase], int]:
    """The usable cases, and how many raw samples were discarded as empty."""
    cases: list[GeneratedCase] = []
    seen: set[str] = set()
    discarded = 0
    for sample in generator.generate(request):
        case = to_case(sample, request.documents)
        key = _normalise(case.question) if case else ""
        if case is None or key in seen:
            discarded += 1
            continue
        seen.add(key)
        cases.append(case)
    return cases, discarded
