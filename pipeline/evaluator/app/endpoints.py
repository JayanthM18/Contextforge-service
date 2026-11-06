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
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# OpenRouter free/low-credit accounts enforce a budget for requests that are
# still being processed upstream. Ragas can fan one metric into several calls,
# so one HTTP request at a time with a ten-second gap prevents retry bursts.
OPENROUTER_REQUESTS_PER_MINUTE = 6
OPENROUTER_MAX_IN_FLIGHT_REQUESTS = 1


class PacedAsyncTransport:
    """Space and cap concurrent outbound judge requests at the HTTP boundary."""

    def __init__(self, requests_per_minute: int, max_in_flight: int | None = None) -> None:
        import httpx

        self._transport = httpx.AsyncHTTPTransport()
        self._interval = 60 / requests_per_minute
        self._next_request_at = 0.0
        self._lock = asyncio.Lock()
        self._in_flight = asyncio.Semaphore(max_in_flight) if max_in_flight is not None else None

    async def handle_async_request(self, request: Any) -> Any:
        async with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next_request_at - now)
            self._next_request_at = max(now, self._next_request_at) + self._interval
        if delay:
            await asyncio.sleep(delay)
        if self._in_flight is None:
            return await self._transport.handle_async_request(request)
        async with self._in_flight:
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
    elif role == "judge" and resolve_base_url(endpoint).rstrip("/") == OPENROUTER_BASE_URL:
        http_client = httpx.AsyncClient(
            transport=PacedAsyncTransport(
                OPENROUTER_REQUESTS_PER_MINUTE,
                max_in_flight=OPENROUTER_MAX_IN_FLIGHT_REQUESTS,
            ),
        )

    return AsyncOpenAI(
        base_url=resolve_base_url(endpoint),
        api_key=resolve_api_key(endpoint, env, role),
        max_retries=5,
        timeout=180,
        **({} if http_client is None else {"http_client": http_client}),
    )
