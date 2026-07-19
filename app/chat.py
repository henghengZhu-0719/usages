from functools import lru_cache
from typing import Iterator

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    trim_messages,
)
from langchain_openai import ChatOpenAI

from app.config import CHAT_API_KEY, CHAT_BASE_URL, CHAT_MAX_TOKENS, CHAT_MODEL

SYSTEM_PROMPT = "你是一个乐于助人的中文助手。"


def chat_available() -> bool:
    return bool(CHAT_API_KEY)


@lru_cache(maxsize=1)
def _get_llm() -> ChatOpenAI:
    # 惰性初始化：没配 key 时不影响笔记服务启动；客户端无状态，进程内共用一个
    return ChatOpenAI(
        model=CHAT_MODEL,
        api_key=CHAT_API_KEY,
        base_url=CHAT_BASE_URL,
        use_responses_api=True,  # 服务器用 Responses API
    )


def _to_lc_messages(messages: list[dict]) -> list[BaseMessage]:
    """把前端传来的 [{role, content}] 转成 LangChain 消息，system 由后端固定。"""
    result: list[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT)]
    for msg in messages:
        content = str(msg.get("content", ""))
        if msg.get("role") == "user":
            result.append(HumanMessage(content=content))
        elif msg.get("role") == "assistant":
            result.append(AIMessage(content=content))
    return result


def stream_chat(messages: list[dict]) -> Iterator[str]:
    """流式返回回答文本片段。对话历史由前端维护，每次请求带全量 messages。"""
    llm = _get_llm()
    trimmed = trim_messages(
        _to_lc_messages(messages),
        max_tokens=CHAT_MAX_TOKENS,
        token_counter=llm,
        strategy="last",
        include_system=True,
        start_on="human",
    )
    try:
        for chunk in llm.stream(trimmed):
            piece = chunk.text
            if piece:
                yield piece
    except Exception as e:  # 流已经开始，无法再改状态码，把错误写进正文
        yield f"\n[请求失败] {e}"
