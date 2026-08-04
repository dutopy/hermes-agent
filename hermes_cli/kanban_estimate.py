"""Shared kanban task-size estimator.

Asks the auto-routed auxiliary LLM for a rough token + complexity read on a
task given its title/body. Used by both the dashboard HTTP plugin
(``plugins/kanban/dashboard/plugin_api.py``) and the gateway ``kanban.*``
JSON-RPC surface, so the two surfaces share one implementation and cannot
drift.
"""

from __future__ import annotations

from typing import Optional

# ---------------------------------------------------------------------------
# Estimate — a rough token/complexity estimate for a task via the auxiliary
# (auto-routed) model. NOT a dollar cost: providers don't report cost
# reliably, so we estimate tokens + a complexity band with a one-line why.
# ---------------------------------------------------------------------------

ESTIMATE_SYSTEM_PROMPT = (
    "You estimate how much work an autonomous coding agent will spend on a "
    "kanban task. Given the task title and description, respond with STRICT "
    "JSON only (no prose, no code fence):\n"
    '{"est_tokens": <integer total tokens across the whole run>, '
    '"complexity": "S"|"M"|"L", '
    '"rationale": "<one short sentence>"}\n'
    "Base the token figure on a realistic multi-turn agent run (reading files, "
    "tool calls, edits, retries) — not a single reply. S≈small/localized, "
    "M≈multi-file, L≈broad or ambiguous. Be honest that this is a rough guess."
)


def estimate_text(title: str, body: Optional[str]) -> dict:
    """Shared estimate core: ask the auto-routed auxiliary model for a rough
    token + complexity read on a task described by ``title``/``body``.

    Never raises — a bad config / parse / API error becomes
    ``{"ok": False, "reason": ...}`` so the UI can render it inline.
    """
    if not (title or "").strip():
        return {"ok": False, "reason": "a title is required to estimate"}

    try:
        from agent.auxiliary_client import call_llm
    except Exception:
        return {"ok": False, "reason": "auxiliary client unavailable"}

    def _cap(s: Optional[str], n: int) -> str:
        s = (s or "").strip()
        return s if len(s) <= n else s[:n] + "…"

    user_msg = (
        f"Title: {_cap(title, 400)}\n\n"
        f"Description:\n{_cap(body, 4000) or '(none)'}"
    )
    try:
        resp = call_llm(
            task="kanban_estimator",
            messages=[
                {"role": "system", "content": ESTIMATE_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,
            max_tokens=300,
            timeout=60,
        )
    except Exception as exc:
        return {"ok": False, "reason": f"LLM error: {type(exc).__name__}"}

    try:
        raw = (resp.choices[0].message.content or "").strip()
        model = getattr(resp, "model", None)
    except Exception:
        raw, model = "", None

    # Reuse the same tolerant JSON-blob extraction the specifier uses.
    parsed: Optional[dict] = None
    try:
        import json as _json
        import re as _re
        blob = raw
        if not blob.lstrip().startswith("{"):
            m = _re.search(r"\{.*\}", blob, _re.DOTALL)
            blob = m.group(0) if m else blob
        obj = _json.loads(blob)
        if isinstance(obj, dict):
            parsed = obj
    except Exception:
        parsed = None

    if not parsed:
        return {"ok": False, "reason": "could not parse an estimate from the model"}

    try:
        est_tokens = int(parsed.get("est_tokens") or 0)
    except (TypeError, ValueError):
        est_tokens = 0
    complexity = str(parsed.get("complexity") or "").strip().upper()
    if complexity not in {"S", "M", "L"}:
        complexity = None
    rationale = str(parsed.get("rationale") or "").strip() or None

    return {
        "ok": True,
        "est_tokens": est_tokens,
        "complexity": complexity,
        "rationale": rationale,
        "model": model,
    }
