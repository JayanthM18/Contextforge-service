"""Building OpenAI-protocol clients from an endpoint description."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .contract import Endpoint
from .errors import ConfigurationError

DEFAULT_BASE_URL = "https://api.openai.com/v1"

# The OpenAI client refuses an empty key even for servers that ignore it.
PLACEHOLDER_KEY = "not-needed"


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
    from openai import AsyncOpenAI

    return AsyncOpenAI(
        base_url=resolve_base_url(endpoint),
        api_key=resolve_api_key(endpoint, env, role),
        max_retries=5,
        timeout=180,
    )
