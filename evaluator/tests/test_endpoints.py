from __future__ import annotations

import pytest

from app.contract import Endpoint
from app.endpoints import DEFAULT_BASE_URL, PLACEHOLDER_KEY, resolve_api_key, resolve_base_url
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
