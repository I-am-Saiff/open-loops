import json

import requests

from app.config import settings

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"


class LLMError(RuntimeError):
    """Raised for any failure calling the LLM or parsing its response.

    Callers only need to catch this one type — they don't need to know
    whether the failure was a network error, an HTTP error, or the model
    returning malformed JSON.
    """


def complete_json(system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> dict:
    """Call the LLM with a system/user prompt pair and parse its reply as
    JSON. This is the only function in the codebase that knows it's Groq —
    swapping providers means editing this file, not the routes that call it.
    """
    try:
        response = requests.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "response_format": {"type": "json_object"},
                "temperature": temperature,
            },
            timeout=20,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except (requests.RequestException, KeyError, IndexError, ValueError) as exc:
        raise LLMError(f"LLM call failed: {exc}") from exc
