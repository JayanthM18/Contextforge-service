"""Command line entry: `python -m app score|generate [--input FILE] [--output FILE]`.

Exit codes: 0 when a response was written, even if some scores are null;
2 when the request or the judge makes the whole result untrustworthy.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from importlib import metadata
from pathlib import Path
from typing import TextIO

from pydantic import ValidationError

from .contract import (
    EvaluatorInfo,
    GenerateRequest,
    GenerateResponse,
    GeneratorInfo,
    ScoreRequest,
    ScoreResponse,
)
from .errors import EvaluatorError
from .generate import RagasSampleGenerator, SampleGenerator, generate_cases
from .scoring import MetricScorer, RagasScorer, score_cases

EXIT_OK = 0
EXIT_TOOL_ERROR = 2

ScorerFactory = Callable[[ScoreRequest, Mapping[str, str]], MetricScorer]
GeneratorFactory = Callable[[Mapping[str, str]], SampleGenerator]

log = logging.getLogger("contextforge.evaluator")


def _ragas_version() -> str:
    try:
        return metadata.version("ragas")
    except metadata.PackageNotFoundError:
        return "not-installed"


def _read(path: str | None, stdin: TextIO) -> str:
    return stdin.read() if path is None else Path(path).read_text(encoding="utf-8")


def _write(path: str | None, text: str, stdout: TextIO) -> None:
    if path is None:
        stdout.write(text + "\n")
    else:
        Path(path).write_text(text + "\n", encoding="utf-8")


def _describe(error: ValidationError) -> str:
    lines = []
    for issue in error.errors():
        where = ".".join(str(part) for part in issue["loc"]) or "request"
        lines.append(f"  {where}: {issue['msg']}")
    return "\n".join(lines)


def score(request: ScoreRequest, env: Mapping[str, str], make_scorer: ScorerFactory) -> ScoreResponse:
    scorer = make_scorer(request, env)
    results = asyncio.run(score_cases(request, scorer))
    return ScoreResponse(
        evaluator=EvaluatorInfo(
            ragas_version=_ragas_version(),
            judge_model=request.judge.model,
            embeddings_model=request.embeddings.model if request.embeddings else None,
        ),
        results=results,
    )


def generate(
    request: GenerateRequest, env: Mapping[str, str], make_generator: GeneratorFactory
) -> GenerateResponse:
    cases, discarded = generate_cases(request, make_generator(env))
    if discarded:
        log.warning("discarded %d generated samples that were empty or duplicated", discarded)
    return GenerateResponse(
        generator=GeneratorInfo(tool="ragas", version=_ragas_version(), model=request.judge.model),
        cases=cases,
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    env: Mapping[str, str] | None = None,
    make_scorer: ScorerFactory = RagasScorer,
    make_generator: GeneratorFactory = RagasSampleGenerator,
) -> int:
    parser = argparse.ArgumentParser(prog="contextforge-evaluator")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("score", "generate"):
        command = commands.add_parser(name)
        command.add_argument("--input", help="request JSON file; stdin when omitted")
        command.add_argument("--output", help="response JSON file; stdout when omitted")
    args = parser.parse_args(argv)

    environment = os.environ if env is None else env

    try:
        raw = _read(args.input, stdin)
        if args.command == "generate":
            generate_request = GenerateRequest.model_validate_json(raw)
            log.info(
                "generating %d cases from %d documents with %s",
                generate_request.size,
                len(generate_request.documents),
                generate_request.judge.model,
            )
            generated = generate(generate_request, environment, make_generator)
            _write(args.output, generated.model_dump_json(indent=2), stdout)
            return EXIT_OK

        request = ScoreRequest.model_validate_json(raw)
        log.info(
            "scoring %d cases on %s with %s",
            len(request.cases),
            ", ".join(request.metrics),
            request.judge.model,
        )
        response = score(request, environment, make_scorer)
        _write(args.output, response.model_dump_json(indent=2), stdout)
    except ValidationError as error:
        log.error("malformed request:\n%s", _describe(error))
        return EXIT_TOOL_ERROR
    except EvaluatorError as error:
        log.error("%s", error)
        return EXIT_TOOL_ERROR
    except OSError as error:
        log.error("cannot read or write a file: %s", error)
        return EXIT_TOOL_ERROR

    nulls = sum(value is None for result in response.results for value in result.scores.values())
    if nulls:
        log.warning("%d scores could not be computed; see errors in the response", nulls)
    return EXIT_OK


if __name__ == "__main__":
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
    sys.exit(main())
