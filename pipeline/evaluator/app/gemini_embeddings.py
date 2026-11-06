"""LangChain-compatible embeddings through Gemini's native REST API."""

from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ragas.embeddings.base import BaseRagasEmbedding

DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
MAX_BATCH_SIZE = 100


class GeminiEmbeddingError(Exception):
    """A Gemini embedding request failed or returned an invalid response."""


class GeminiEmbeddings(BaseRagasEmbedding):
    def __init__(
        self,
        model: str,
        api_key: str,
        base_url: str | None = None,
        timeout: float = 180,
    ) -> None:
        super().__init__()
        self.model = model.removeprefix("models/")
        self.api_key = api_key
        self.base_url = (base_url or DEFAULT_GEMINI_BASE_URL).rstrip("/")
        self.timeout = timeout

    def embed_text(self, text: str, **_kwargs: object) -> list[float]:
        vectors = self._embed([text])
        if len(vectors) != 1:
            raise GeminiEmbeddingError("Gemini returned an unexpected embedding count.")
        return vectors[0]

    async def aembed_text(self, text: str, **kwargs: object) -> list[float]:
        return await asyncio.to_thread(self.embed_text, text, **kwargs)

    def embed_texts(self, texts: list[str], **_kwargs: object) -> list[list[float]]:
        return self._embed(texts)

    async def aembed_texts(self, texts: list[str], **_kwargs: object) -> list[list[float]]:
        return await asyncio.to_thread(self._embed, texts)

    def _embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), MAX_BATCH_SIZE):
            batch = texts[start : start + MAX_BATCH_SIZE]
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _embed_batch(self, texts: Sequence[str]) -> list[list[float]]:
        url = f"{self.base_url}/models/{quote(self.model, safe='')}:batchEmbedContents"
        payload = {
            "requests": [
                {
                    "model": f"models/{self.model}",
                    "content": {"parts": [{"text": text}]},
                    "taskType": "SEMANTIC_SIMILARITY",
                }
                for text in texts
            ]
        }
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read())
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:400]
            raise GeminiEmbeddingError(
                f"Gemini embedding API returned HTTP {error.code}: {detail}"
            ) from error
        except (URLError, TimeoutError, OSError) as error:
            raise GeminiEmbeddingError(
                f"Gemini embedding API request failed: {type(error).__name__}"
            ) from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise GeminiEmbeddingError("Gemini embedding API returned invalid JSON.") from error

        if not isinstance(body, dict) or not isinstance(body.get("embeddings"), list):
            raise GeminiEmbeddingError("Gemini embedding API response has no embeddings list.")

        raw_vectors = body["embeddings"]
        if len(raw_vectors) != len(texts):
            raise GeminiEmbeddingError(
                f"Gemini returned {len(raw_vectors)} embeddings for {len(texts)} inputs."
            )

        vectors: list[list[float]] = []
        for item in raw_vectors:
            values = item.get("values") if isinstance(item, dict) else None
            if not isinstance(values, list) or not all(
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                for value in values
            ) or not values:
                raise GeminiEmbeddingError("Gemini returned an invalid embedding vector.")
            vectors.append([float(value) for value in values])
        return vectors
