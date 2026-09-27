"""Failures that make a whole run untrustworthy, as opposed to one missing score."""


class EvaluatorError(Exception):
    """Base for failures that end the run with exit code 2."""


class ConfigurationError(EvaluatorError):
    """The request cannot be acted on: a key variable is missing, say."""


class JudgeUnavailable(EvaluatorError):
    """The judge rejected us or could not be reached.

    Scoring the remaining cases would only produce a wall of nulls that look
    like per-case failures, so the run stops instead.
    """
