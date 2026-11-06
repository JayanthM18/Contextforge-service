from __future__ import annotations

import io
import json
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request

import pytest

from app.contract import Endpoint
from app.endpoints import resolve_api_key
from app.gemini_embeddings import GeminiEmbeddingError, GeminiEmbeddings


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_gemini_embeddings_use_native_batch_endpoint_and_key_header() -> None:
    response = FakeResponse(json.dumps({"embeddings": [{"values": [0.2, 0.8]}]}).encode())
    with patch("app.gemini_embeddings.urlopen", return_value=response) as mocked:
        embedder = GeminiEmbeddings("gemini-embedding-001", "gemini-secret")

        assert embedder.embed_texts(["hello"]) == [[0.2, 0.8]]

    request = mocked.call_args.args[0]
    assert isinstance(request, Request)
    assert request.full_url == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-embedding-001:batchEmbedContents"
    )
    assert request.get_header("X-goog-api-key") == "gemini-secret"
    payload = json.loads(request.data)
    assert payload["requests"][0] == {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": "hello"}]},
        "taskType": "SEMANTIC_SIMILARITY",
    }


def test_gemini_embeddings_require_the_named_environment_key() -> None:
    endpoint = Endpoint(
        provider="gemini", model="gemini-embedding-001", api_key_env="GEMINI_API_KEY"
    )

    assert resolve_api_key(endpoint, {"GEMINI_API_KEY": "test-key"}, "embeddings") == "test-key"


def test_invalid_gemini_response_fails_explicitly() -> None:
    response = FakeResponse(b'{"embeddings":[{"values":["not-a-number"]}]}')
    with patch("app.gemini_embeddings.urlopen", return_value=response):
        with pytest.raises(GeminiEmbeddingError, match="invalid embedding vector"):
            GeminiEmbeddings("gemini-embedding-001", "test-key").embed_text("hello")


def test_gemini_http_errors_do_not_report_success_shaped_vectors() -> None:
    error = HTTPError(
        "https://generativelanguage.googleapis.com/",
        401,
        "unauthorized",
        None,
        io.BytesIO(b'{"error":{"message":"invalid key"}}'),
    )
    with patch("app.gemini_embeddings.urlopen", side_effect=error):
        with pytest.raises(GeminiEmbeddingError, match="HTTP 401"):
            GeminiEmbeddings("gemini-embedding-001", "bad-key").embed_text("hello")


def test_gemini_embeddings_split_large_inputs_into_supported_batches() -> None:
    def respond(request: Request, **_kwargs: object) -> FakeResponse:
        count = len(json.loads(request.data)["requests"])
        vectors = [{"values": [float(index)]} for index in range(count)]
        return FakeResponse(json.dumps({"embeddings": vectors}).encode())

    with patch("app.gemini_embeddings.urlopen", side_effect=respond) as mocked:
        result = GeminiEmbeddings("gemini-embedding-001", "test-key").embed_texts(
            [f"document {index}" for index in range(101)]
        )

    assert len(result) == 101
    assert [len(json.loads(call.args[0].data)["requests"]) for call in mocked.call_args_list] == [
        100,
        1,
    ]


def test_gemini_embeddings_reject_non_finite_vectors() -> None:
    response = FakeResponse(b'{"embeddings":[{"values":[NaN]}]}')
    with patch("app.gemini_embeddings.urlopen", return_value=response):
        with pytest.raises(GeminiEmbeddingError, match="invalid embedding vector"):
            GeminiEmbeddings("gemini-embedding-001", "test-key").embed_text("hello")
