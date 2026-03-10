"""Relationship Module - 에이전트 간 관계 추적

논문 구현: 대화 후 감정(sentiment)을 키워드 기반으로 자동 업데이트.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# 감정 분석용 키워드 사전 (LLM 호출 없이 빠르게 처리)
_POSITIVE_KEYWORDS = [
    "thank", "thanks", "appreciate", "great", "wonderful", "amazing",
    "love", "like", "enjoy", "happy", "glad", "excited", "awesome",
    "helpful", "kind", "nice", "agree", "support", "welcome",
    "congratulations", "congrats", "excellent", "fantastic", "perfect",
    "fun", "laugh", "smile", "friend", "together", "collaborate",
    "고마", "감사", "좋아", "좋은", "훌륭", "행복", "즐거",
    "기쁘", "멋진", "최고", "함께", "협력", "도움",
]

_NEGATIVE_KEYWORDS = [
    "hate", "dislike", "annoyed", "angry", "upset", "frustrated",
    "terrible", "awful", "horrible", "disappointing", "disagree",
    "argue", "conflict", "rude", "mean", "selfish", "ignore",
    "complain", "blame", "criticize", "worse", "bad", "sorry",
    "싫어", "짜증", "화나", "실망", "나쁜", "갈등", "불만",
    "비난", "무시", "미안",
]


def _analyze_sentiment_keywords(text: str) -> float:
    """키워드 기반 감정 분석. -1.0 ~ 1.0 반환."""
    text_lower = text.lower()
    pos_count = sum(1 for kw in _POSITIVE_KEYWORDS if kw in text_lower)
    neg_count = sum(1 for kw in _NEGATIVE_KEYWORDS if kw in text_lower)

    total = pos_count + neg_count
    if total == 0:
        return 0.0

    # 범위: -1.0 ~ 1.0
    raw = (pos_count - neg_count) / total
    return max(-1.0, min(1.0, raw))


@dataclass
class Relationship:
    """두 에이전트 간의 관계 정보"""

    other_id: str
    other_name: str
    familiarity: int = 0          # 0-10, 상호작용 횟수에 따라 증가
    sentiment: float = 0.0        # -1.0 ~ 1.0 (부정 ~ 긍정)
    interaction_count: int = 0
    last_interaction: Optional[datetime] = None
    notes: List[str] = field(default_factory=list)  # 최근 상호작용 요약 (최대 5개)

    def to_dict(self) -> dict:
        return {
            "other_id": self.other_id,
            "other_name": self.other_name,
            "familiarity": self.familiarity,
            "sentiment": round(self.sentiment, 3),
            "interaction_count": self.interaction_count,
            "last_interaction": self.last_interaction.isoformat() if self.last_interaction else None,
            "notes": list(self.notes),
        }


class RelationshipModule:
    """에이전트의 모든 관계를 관리하는 모듈"""

    def __init__(self):
        self.relationships: Dict[str, Relationship] = {}  # other_id -> Relationship

    def get_relationship(self, other_id: str) -> Optional[Relationship]:
        """특정 에이전트와의 관계 조회"""
        return self.relationships.get(other_id)

    def update_after_conversation(
        self,
        other_id: str,
        other_name: str,
        conversation_summary: str,
        game_time: Optional[datetime] = None,
    ) -> Relationship:
        """대화 후 관계 업데이트

        - interaction_count 증가
        - familiarity 증가 (최대 10)
        - notes에 요약 추가 (최근 5개 유지)
        - last_interaction 갱신
        - sentiment 자동 업데이트 (대화 내용 키워드 분석)
        """
        rel = self.relationships.get(other_id)

        if rel is None:
            rel = Relationship(other_id=other_id, other_name=other_name)
            self.relationships[other_id] = rel

        rel.interaction_count += 1
        rel.familiarity = min(10, rel.familiarity + 1)
        rel.last_interaction = game_time or datetime.now()

        # 최근 5개 노트만 유지
        rel.notes.append(conversation_summary)
        if len(rel.notes) > 5:
            rel.notes = rel.notes[-5:]

        # 감정 자동 업데이트: 키워드 분석
        conversation_sentiment = _analyze_sentiment_keywords(conversation_summary)
        if conversation_sentiment != 0.0:
            # 지수이동평균(EMA) 방식: 기존 감정 70% + 새 대화 감정 30%
            alpha = 0.3
            rel.sentiment = rel.sentiment * (1 - alpha) + conversation_sentiment * alpha
            rel.sentiment = max(-1.0, min(1.0, rel.sentiment))
            logger.debug(
                "Sentiment updated for %s -> %s: %.3f (conversation: %.3f)",
                other_name, other_id, rel.sentiment, conversation_sentiment,
            )

        return rel

    def get_context_for(self, other_id: str) -> str:
        """LLM 프롬프트에 주입할 관계 컨텍스트 텍스트 생성"""
        rel = self.relationships.get(other_id)

        if rel is None:
            return "They have never interacted before. They are complete strangers."

        # 친밀도 레벨 설명
        if rel.familiarity <= 1:
            familiarity_desc = "barely acquainted"
        elif rel.familiarity <= 3:
            familiarity_desc = "somewhat familiar"
        elif rel.familiarity <= 5:
            familiarity_desc = "fairly familiar"
        elif rel.familiarity <= 7:
            familiarity_desc = "well acquainted"
        elif rel.familiarity <= 9:
            familiarity_desc = "very close"
        else:
            familiarity_desc = "extremely close"

        # 감정 설명
        if rel.sentiment < -0.5:
            sentiment_desc = "and has a negative impression of them"
        elif rel.sentiment < -0.1:
            sentiment_desc = "and feels slightly negative toward them"
        elif rel.sentiment < 0.1:
            sentiment_desc = "and feels neutral toward them"
        elif rel.sentiment < 0.5:
            sentiment_desc = "and feels somewhat positive toward them"
        else:
            sentiment_desc = "and feels very positive toward them"

        # 최근 대화 노트
        recent_notes = ""
        if rel.notes:
            recent_notes = "\nRecent interactions:\n" + "\n".join(
                f"- {note}" for note in rel.notes
            )

        return (
            f"They have spoken {rel.interaction_count} time(s). "
            f"They are {familiarity_desc} (familiarity {rel.familiarity}/10) "
            f"{sentiment_desc} (sentiment {rel.sentiment:.1f})."
            f"{recent_notes}"
        )

    def to_dict(self) -> dict:
        """직렬화"""
        return {
            other_id: rel.to_dict()
            for other_id, rel in self.relationships.items()
        }

    @classmethod
    def from_dict(cls, data: dict) -> RelationshipModule:
        """저장된 데이터에서 RelationshipModule 복원"""
        module = cls()
        for other_id, rel_data in data.items():
            last_interaction = None
            if rel_data.get("last_interaction"):
                last_interaction = datetime.fromisoformat(rel_data["last_interaction"])
            module.relationships[other_id] = Relationship(
                other_id=rel_data["other_id"],
                other_name=rel_data["other_name"],
                familiarity=rel_data.get("familiarity", 0),
                sentiment=rel_data.get("sentiment", 0.0),
                interaction_count=rel_data.get("interaction_count", 0),
                last_interaction=last_interaction,
                notes=rel_data.get("notes", []),
            )
        return module
