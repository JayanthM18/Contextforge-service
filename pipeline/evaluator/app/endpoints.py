"""Building OpenAI-protocol clients from an endpoint description."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from typing import Any

from .contract import Endpoint
from .errors import ConfigurationError

DEFAULT_BASE_URL = "https://api.openai.com/v1"

# The OpenAI client refuses an empty key even for servers that ignore it.
PLACEHOLDER_KEY = "not-needed"
GROQ_GPT_OSS_120B = "openai/gpt-oss-120b"
GROQ_GPT_OSS_120B_REQUESTS_PER_MINUTE = 20


class PacedAsyncTransport:
    """Space outbound judge requests so Groq's 30 RPM limit is never approached."""

    def __init__(self, requests_per_minute: int) -> None:
        import httpx

        self._transport = httpx.AsyncHTTPTransport()
        self._interval = 60 / requests_per_minute
        self._next_request_at = 0.0
        self._lock = asyncio.Lock()

    async def handle_async_request(self, request: Any) -> Any:
        async with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next_request_at - now)
            self._next_request_at = max(now, self._next_request_at) + self._interval
        if delay:
            await asyncio.sleep(delay)
        return await self._transport.handle_async_request(request)

    async def aclose(self) -> None:
        await self._transport.aclose()


def resolve_base_url(endpoint: Endpoint) -> str:
    # Always explicit: left as None, the OpenAI client would silently pick up
    # OPENAI_BASE_URL from the environment and send the judge somewhere else.
    return endpoint.base_url or DEFAULT_BASE_URL


def resolve_api_key(endpoint: Endpoint, env: Mapping[str, str], role: str) -> str:
    if endpoint.api_key_env is None:
        return PLACEHOLDER_KEY

    value = env.get(endpoint.api_key_env, "")
    if not value:
        raise ConfigurationError(
            f"{role}.api_key_env names {endpoint.api_key_env}, but it is not set in the "
            f"evaluator's environment. The core passes that variable through; check it is "
            f"exported where contextforge runs."
        )
    return value


def make_client(endpoint: Endpoint, env: Mapping[str, str], role: str) -> Any:
    import httpx
    from openai import AsyncOpenAI

    # Ragas can issue several judge calls for one metric. Limit at the HTTP
    # boundary so every call and automatic retry is paced, not merely cases.
    http_client = None
    if role == "judge" and endpoint.model == GROQ_GPT_OSS_120B:
        http_client = httpx.AsyncClient(
            transport=PacedAsyncTransport(GROQ_GPT_OSS_120B_REQUESTS_PER_MINUTE),
        )

    return AsyncOpenAI(
        base_url=resolve_base_url(endpoint),
        api_key=resolve_api_key(endpoint, env, role),
        max_retries=5,
        timeout=180,
        **({} if http_client is None else {"http_client": http_client}),
    )
