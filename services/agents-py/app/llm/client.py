"""ChatOpenAI factory.

Mirrors `lib/integrations-openai-ai-server/src/client.ts`: the base URL and API
key come from the AI_INTEGRATIONS_OPENAI_* env vars, the model defaults to
gpt-4.1-mini. LangChain auto-traces every call into LangSmith once tracing is
configured (see app/tracing.py), so there is no explicit wrapOpenAI equivalent.
"""
from __future__ import annotations

from langchain_openai import ChatOpenAI

from ..config import get_settings


def make_chat_model(*, max_tokens: int | None = None, streaming: bool = False) -> ChatOpenAI:
    s = get_settings()
    return ChatOpenAI(
        model=s.openai_model,
        api_key=s.ai_integrations_openai_api_key,
        base_url=s.ai_integrations_openai_base_url,
        max_tokens=max_tokens or s.openai_max_tokens,
        temperature=0,
        streaming=streaming,
    )
