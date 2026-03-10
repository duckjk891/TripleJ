"""OpenAI API 래퍼 - LLM 호출 및 임베딩 생성"""

from __future__ import annotations

import os
import time
import logging
from collections import OrderedDict
from typing import List, Optional

from openai import OpenAI, RateLimitError, APITimeoutError, APIConnectionError

logger = logging.getLogger(__name__)


class GPTWrapper:
    """OpenAI API 래퍼 (에러 핸들링, 재시도, 임베딩 캐싱 포함)"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gpt-3.5-turbo",
        embedding_model: str = "text-embedding-ada-002",
        max_retries: int = 3,
        retry_delay: float = 2.0,
        embedding_cache_size: int = 500,
    ):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.model = model
        self.embedding_model = embedding_model
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        self._api_available = bool(self.api_key and not self.api_key.startswith("sk-your"))
        if not self._api_available:
            logger.warning("OpenAI API key not set. LLM calls will return fallback values.")

        self.client = OpenAI(api_key=self.api_key or "sk-placeholder")

        # 임베딩 캐시 (LRU)
        self._embedding_cache: OrderedDict[str, List[float]] = OrderedDict()
        self._embedding_cache_size = embedding_cache_size
        self.embedding_cache_hits = 0

        # 호출 통계
        self.call_count = 0
        self.embedding_count = 0
        self.total_tokens = 0

    def call(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 500,
        temperature: float = 0.7,
    ) -> str:
        """LLM 호출 (재시도 포함)"""
        if not self._api_available:
            logger.warning("LLM call skipped (no API key). Returning fallback.")
            return "[No LLM response - API key not configured]"

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        for attempt in range(self.max_retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )

                self.call_count += 1
                if response.usage:
                    self.total_tokens += response.usage.total_tokens

                result = response.choices[0].message.content or ""
                logger.debug(
                    "GPT call #%d: %d tokens, model=%s",
                    self.call_count, response.usage.total_tokens if response.usage else 0, self.model,
                )
                return result.strip()

            except RateLimitError:
                wait = self.retry_delay * (2 ** attempt)
                logger.warning("Rate limit hit, retrying in %.1fs (attempt %d/%d)", wait, attempt + 1, self.max_retries)
                time.sleep(wait)

            except APITimeoutError:
                wait = self.retry_delay * (attempt + 1)
                logger.warning("API timeout, retrying in %.1fs (attempt %d/%d)", wait, attempt + 1, self.max_retries)
                time.sleep(wait)

            except APIConnectionError:
                wait = self.retry_delay * (attempt + 1)
                logger.warning("Connection error, retrying in %.1fs (attempt %d/%d)", wait, attempt + 1, self.max_retries)
                time.sleep(wait)

            except Exception as e:
                logger.error("Unexpected error in GPT call: %s", e)
                break

        logger.warning("GPT call failed after %d retries, returning fallback.", self.max_retries)
        return "[LLM call failed]"

    def call_with_format(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 500,
        temperature: float = 0.5,
    ) -> str:
        """구조화된 출력이 필요한 LLM 호출 (낮은 temperature)"""
        return self.call(prompt, system_prompt=system_prompt, max_tokens=max_tokens, temperature=temperature)

    def get_embedding(self, text: str) -> List[float]:
        """텍스트 임베딩 벡터 생성 (캐싱 + 재시도)"""
        if not self._api_available:
            return [0.0] * 1536

        # 캐시 확인
        cache_key = text.strip()
        if cache_key in self._embedding_cache:
            self._embedding_cache.move_to_end(cache_key)
            self.embedding_cache_hits += 1
            return self._embedding_cache[cache_key]

        for attempt in range(self.max_retries):
            try:
                response = self.client.embeddings.create(
                    input=text,
                    model=self.embedding_model,
                )

                self.embedding_count += 1
                embedding = response.data[0].embedding
                logger.debug("Embedding #%d: %d dims", self.embedding_count, len(embedding))

                # 캐시에 저장
                self._cache_embedding(cache_key, embedding)
                return embedding

            except RateLimitError:
                wait = self.retry_delay * (2 ** attempt)
                logger.warning("Embedding rate limit, retrying in %.1fs", wait)
                time.sleep(wait)

            except (APITimeoutError, APIConnectionError):
                wait = self.retry_delay * (attempt + 1)
                logger.warning("Embedding connection issue, retrying in %.1fs", wait)
                time.sleep(wait)

            except Exception as e:
                logger.error("Unexpected error in embedding: %s", e)
                break

        logger.warning("Embedding failed after %d retries, returning zero vector.", self.max_retries)
        return [0.0] * 1536

    def _cache_embedding(self, key: str, embedding: List[float]) -> None:
        """LRU 캐시에 임베딩 저장"""
        if key in self._embedding_cache:
            self._embedding_cache.move_to_end(key)
        else:
            if len(self._embedding_cache) >= self._embedding_cache_size:
                self._embedding_cache.popitem(last=False)
            self._embedding_cache[key] = embedding

    def get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """배치 임베딩 생성 (캐시 활용 + 비용 절약)"""
        if not self._api_available:
            return [[0.0] * 1536 for _ in texts]

        results: List[Optional[List[float]]] = [None] * len(texts)
        texts_to_fetch: List[str] = []
        fetch_indices: List[int] = []

        # 캐시에서 가능한 것 먼저 가져옴
        for i, text in enumerate(texts):
            cache_key = text.strip()
            if cache_key in self._embedding_cache:
                self._embedding_cache.move_to_end(cache_key)
                self.embedding_cache_hits += 1
                results[i] = self._embedding_cache[cache_key]
            else:
                texts_to_fetch.append(text)
                fetch_indices.append(i)

        # 캐시 미스된 것만 API 호출
        if texts_to_fetch:
            for attempt in range(self.max_retries):
                try:
                    response = self.client.embeddings.create(
                        input=texts_to_fetch,
                        model=self.embedding_model,
                    )

                    self.embedding_count += len(texts_to_fetch)
                    fetched = [item.embedding for item in response.data]

                    for idx, embedding in zip(fetch_indices, fetched):
                        results[idx] = embedding
                        self._cache_embedding(texts[idx].strip(), embedding)

                    break
                except RateLimitError:
                    wait = self.retry_delay * (2 ** attempt)
                    logger.warning("Batch embedding rate limit, retrying in %.1fs", wait)
                    time.sleep(wait)
                except Exception as e:
                    logger.error("Unexpected error in batch embedding: %s", e)
                    break
            else:
                logger.warning("Batch embedding failed after %d retries, using zero vectors.", self.max_retries)
                for idx in fetch_indices:
                    results[idx] = [0.0] * 1536

        logger.debug(
            "Batch embedding: %d total, %d cached, %d fetched",
            len(texts), len(texts) - len(texts_to_fetch), len(texts_to_fetch),
        )
        return results  # type: ignore

    def get_stats(self) -> dict:
        """호출 통계 반환"""
        return {
            "call_count": self.call_count,
            "embedding_count": self.embedding_count,
            "embedding_cache_hits": self.embedding_cache_hits,
            "embedding_cache_size": len(self._embedding_cache),
            "total_tokens": self.total_tokens,
        }


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """코사인 유사도 계산 (numpy 없이)"""
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ── 글로벌 인스턴스 (싱글톤) ──

_gpt_instance: Optional[GPTWrapper] = None


def get_gpt() -> GPTWrapper:
    """글로벌 GPTWrapper 인스턴스 반환"""
    global _gpt_instance
    if _gpt_instance is None:
        from dotenv import load_dotenv
        # Try loading .env from multiple possible locations
        _env_candidates = [
            os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env"),
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "0_platform", "backend", "office-game-api", ".env"),
        ]
        for _env_path in _env_candidates:
            _env_path = os.path.normpath(_env_path)
            if os.path.isfile(_env_path):
                load_dotenv(_env_path)
                logger.info("Loaded .env from %s", _env_path)

        _gpt_instance = GPTWrapper(
            api_key=os.getenv("OPENAI_API_KEY"),
            model=os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
            embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002"),
        )
    return _gpt_instance
