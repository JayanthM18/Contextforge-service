from __future__ import annotations

import io
import json
from pathlib import Path

from app.__main__ import EXIT_OK, EXIT_TOOL_ERROR, main
from app.errors import ConfigurationError

from .conftest import FakeScorer, make_request


def invoke(request: object, scorer: FakeScorer, factory, **kwargs) -> tuple[int, str]:
    stdout = io.StringIO()
    stdin = io.StringIO(request if isinstance(request, str) else json.dumps(request))
    code = main(["score"], stdin=stdin, stdout=stdout, env={}, make_scorer=factory(scorer), **kwargs)
    return code, stdout.getvalue()


def test_reads_stdin_and_writes_the_response_to_stdout(factory) -> None:
    code, out = invoke(make_request(), FakeScorer(default=0.8), factory)

    assert code == EXIT_OK
    response = json.loads(out)
    assert response["evaluator"]["judge_model"] == "judge-model"
    assert [r["case_id"] for r in response["results"]] == ["tc-001", "tc-002", "tc-003"]
    assert response["results"][0]["scores"]["faithfulness"] == 0.8


def test_null_scores_still_exit_zero(factory) -> None:
    code, out = invoke(make_request(), FakeScorer(default=float("nan")), factory)

    assert code == EXIT_OK
    assert json.loads(out)["results"][0]["scores"]["faithfulness"] is None


def test_malformed_json_exits_two(factory) -> None:
    assert invoke("{not json", FakeScorer(), factory)[0] == EXIT_TOOL_ERROR


def test_a_request_breaking_the_contract_exits_two(factory) -> None:
    assert invoke(make_request(metrics=["bleu"]), FakeScorer(), factory)[0] == EXIT_TOOL_ERROR


def test_a_configuration_error_exits_two() -> None:
    def refuse(_request, _env):
        raise ConfigurationError("OPENAI_API_KEY is not set")

    code = main(
        ["score"], stdin=io.StringIO(json.dumps(make_request())), stdout=io.StringIO(), env={},
        make_scorer=refuse,
    )
    assert code == EXIT_TOOL_ERROR


def test_an_unexpected_failure_exits_two_not_one() -> None:
    def explode(_request, _env):
        raise ImportError("rapidfuzz is required for string distance")

    code = main(
        ["score"], stdin=io.StringIO(json.dumps(make_request())), stdout=io.StringIO(), env={},
        make_scorer=explode,
    )
    assert code == EXIT_TOOL_ERROR


def test_file_input_and_output(tmp_path: Path, factory) -> None:
    source = tmp_path / "request.json"
    target = tmp_path / "response.json"
    source.write_text(json.dumps(make_request()))

    code = main(
        ["score", "--input", str(source), "--output", str(target)],
        env={}, make_scorer=factory(FakeScorer(default=0.6)),
    )

    assert code == EXIT_OK
    assert json.loads(target.read_text())["results"][2]["scores"]["context_recall"] == 0.6


def test_a_missing_input_file_exits_two(tmp_path: Path, factory) -> None:
    code = main(
        ["score", "--input", str(tmp_path / "absent.json")], env={},
        make_scorer=factory(FakeScorer()),
    )
    assert code == EXIT_TOOL_ERROR
