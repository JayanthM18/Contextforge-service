from __future__ import annotations

import io
import json

from app.__main__ import EXIT_OK, EXIT_TOOL_ERROR, main
from app.contract import GenerateRequest, SourceDocument
from app.generate import RawSample, generate_cases, source_documents_for, to_case

DOCS = [
    SourceDocument(id="refunds.md", text="# Refunds\n\nReturns are accepted within   30 days\nof delivery."),
    SourceDocument(id="shipping.md", text="Express costs $14.95 and takes 1 to 2 days."),
]


def request(size: int = 3) -> dict:
    return {
        "task": "generate",
        "size": size,
        "judge": {"model": "gen-model", "api_key_env": None},
        "embeddings": {"model": "embed", "api_key_env": None},
        "documents": [doc.model_dump() for doc in DOCS],
    }


class FakeGenerator:
    def __init__(self, samples: list[RawSample]):
        self.samples = samples

    def generate(self, _request: GenerateRequest) -> list[RawSample]:
        return self.samples


def sample(question: str, contexts: list[str], synthesizer: str = "single_hop_specific") -> RawSample:
    return RawSample(question=question, reference="an answer", reference_contexts=contexts,
                     synthesizer_name=synthesizer)


def test_contexts_are_traced_to_documents_despite_whitespace_differences() -> None:
    assert source_documents_for(["returns are accepted within 30 days of delivery"], DOCS) == ["refunds.md"]


def test_a_context_found_nowhere_is_dropped_not_guessed() -> None:
    assert source_documents_for(["something invented"], DOCS) == []


def test_each_document_is_listed_once() -> None:
    contexts = ["Returns are accepted", "30 days of delivery", "Express costs $14.95"]
    assert source_documents_for(contexts, DOCS) == ["refunds.md", "shipping.md"]


def test_hops_come_from_the_synthesizer_name() -> None:
    assert to_case(sample("q?", [], "multi_hop_abstract_query_synthesizer"), DOCS).hops == "multi"
    assert to_case(sample("q?", [], "single_hop_specific_query_synthesizer"), DOCS).hops == "single"


def test_an_empty_question_is_discarded() -> None:
    assert to_case(sample("   ", []), DOCS) is None


def test_duplicate_questions_are_discarded_and_counted() -> None:
    generator = FakeGenerator([sample("Refund window?", []), sample("refund   window?", []), sample("", [])])
    cases, discarded = generate_cases(GenerateRequest.model_validate(request()), generator)

    assert [c.question for c in cases] == ["Refund window?"]
    assert discarded == 2


def test_generate_command_writes_the_draft_to_stdout() -> None:
    stdout = io.StringIO()
    generator = FakeGenerator([sample("What is the refund window?", ["within 30 days of delivery"])])

    code = main(["generate"], stdin=io.StringIO(json.dumps(request())), stdout=stdout, env={},
                make_generator=lambda _env: generator)

    assert code == EXIT_OK
    response = json.loads(stdout.getvalue())
    assert response["generator"]["model"] == "gen-model"
    assert response["cases"][0]["reference_document_ids"] == ["refunds.md"]


def test_a_generate_request_without_documents_exits_two() -> None:
    bad = request()
    bad["documents"] = []
    code = main(["generate"], stdin=io.StringIO(json.dumps(bad)), stdout=io.StringIO(), env={},
                make_generator=lambda _env: FakeGenerator([]))

    assert code == EXIT_TOOL_ERROR
