from __future__ import annotations

import pytest

from app.contract import Endpoint
from app.endpoints import (
    DEFAULT_BASE_URL,
    GROQ_GPT_OSS_120B,
    OPENROUTER_BASE_URL,
    OPENROUTER_MAX_IN_FLIGHT_REQUESTS,
    OPENROUTER_REQUESTS_PER_MINUTE,
    PacedAsyncTransport,
    PLACEHOLDER_KEY,
    make_client,
    resolve_api_key,
    resolve_base_url,
)
from app.errors import ConfigurationError


def test_base_url_is_always_explicit_so_the_environment_cannot_redirect_it() -> None:
    assert resolve_base_url(Endpoint(model="m")) == DEFAULT_BASE_URL


def test_a_custom_base_url_is_used_as_given() -> None:
    endpoint = Endpoint(model="m", base_url="http://judge-box:11434/v1")
    assert resolve_base_url(endpoint) == "http://judge-box:11434/v1"


def test_no_key_variable_means_a_placeholder_key() -> None:
    assert resolve_api_key(Endpoint(model="m"), {}, "judge") == PLACEHOLDER_KEY


def test_the_named_variable_supplies_the_key() -> None:
    endpoint = Endpoint(model="m", api_key_env="MY_KEY")
    assert resolve_api_key(endpoint, {"MY_KEY": "sk-1"}, "judge") == "sk-1"


def test_a_missing_key_names_the_variable_and_the_role() -> None:
    endpoint = Endpoint(model="m", api_key_env="MY_KEY")
    with pytest.raises(ConfigurationError, match=r"judge\.api_key_env names MY_KEY"):
        resolve_api_key(endpoint, {"MY_KEY": ""}, "judge")


def test_groq_gpt_oss_120b_judge_uses_the_paced_transport() -> None:
    client = make_client(Endpoint(model=GROQ_GPT_OSS_120B), {}, "judge")

    assert isinstance(client._client._transport, PacedAsyncTransport)


def test_openrouter_judge_serialises_and_paces_requests() -> None:
    client = make_client(Endpoint(model="openai/gpt-4.1-mini", base_url=OPENROUTER_BASE_URL), {}, "judge")

    transport = client._client._transport
    assert isinstance(transport, PacedAsyncTransport)
    assert transport._interval == pytest.approx(60 / OPENROUTER_REQUESTS_PER_MINUTE)
    assert transport._in_flight is not None
    assert transport._in_flight._value == OPENROUTER_MAX_IN_FLIGHT_REQUESTS


def test_other_endpoints_keep_the_default_transport() -> None:
    client = make_client(Endpoint(model="gpt-4o-mini"), {}, "judge")

    assert not isinstance(client._client._transport, PacedAsyncTransport)
