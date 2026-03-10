"""Planning Module - 3단계 계획 분해 (Daily -> Hourly -> Action)"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass
from typing import List, Optional, TYPE_CHECKING
from datetime import datetime

from agent_core.prompt_template.gpt_structure import get_gpt

if TYPE_CHECKING:
    from agent_core.agent import Agent

logger = logging.getLogger(__name__)


@dataclass
class PlanItem:
    start_time: str        # "09:00"
    end_time: str          # "12:00"
    description: str       # "코드 작업"
    location: str = ""     # "Main Office > Open Space"
    completed: bool = False


class PlanningModule:
    """3단계 계획 생성: Daily -> Hourly -> Action"""

    def create_daily_plan(self, agent: Agent, game_date: str = "Day 1") -> List[PlanItem]:
        """하루 일과 계획 생성 (5-8 청크)"""
        # 최근 기억에서 어제 요약 구성
        recent_memories = agent.memory_stream.get_recent(30)
        yesterday_summary = ""
        if recent_memories:
            yesterday_summary = "; ".join(m.content for m in recent_memories[-5:])

        prompt = f"""{agent.name}'s information:
- Occupation: {agent.occupation}
- Traits: {agent.traits}
- Daily routine: {agent.daily_routine}
- Yesterday summary: {yesterday_summary or "No previous day"}

Today is {game_date}. Create a daily plan with 5-8 activities.
Use this EXACT format, one per line:
[HH:MM-HH:MM] Activity at Location

Available locations: Open Space, Meeting Room, Kitchen, Cafe, Park

Example:
[09:00-10:30] Working on code at Open Space
[10:30-11:00] Coffee break at Kitchen"""

        try:
            response = get_gpt().call(prompt, max_tokens=400, temperature=0.7)
            plan = self._parse_daily_plan(response)
            if plan:
                # 계획을 기억에 저장
                plan_summary = f"{agent.name}'s plan for {game_date}: " + ", ".join(
                    f"{p.start_time} {p.description}" for p in plan
                )
                agent.memory_stream.add_plan(plan_summary)
                logger.info("%s created daily plan: %d items", agent.name, len(plan))
                return plan
        except Exception as e:
            logger.error("Daily plan generation failed for %s: %s", agent.name, e)

        # 실패 시 기본 계획
        return self._default_plan()

    def decompose_to_hourly(self, agent: Agent, plan_item: PlanItem) -> List[PlanItem]:
        """일과 항목을 시간 단위(hourly) 블록으로 분해 (중간 단계)

        예: [09:00-12:00] Working -> [09:00-10:00] ... , [10:00-11:00] ... , [11:00-12:00] ...
        """
        # 시간 범위가 1시간 이하면 분해 불필요
        start_h, start_m = map(int, plan_item.start_time.split(":"))
        end_h, end_m = map(int, plan_item.end_time.split(":"))
        duration_minutes = (end_h * 60 + end_m) - (start_h * 60 + start_m)

        if duration_minutes <= 60:
            return [plan_item]

        prompt = f"""Break down this broad activity into hourly sub-tasks:
{plan_item.description} ({plan_item.start_time}-{plan_item.end_time}) at {plan_item.location}

Character: {agent.name} ({agent.occupation})
Traits: {agent.traits}

Divide the time range into roughly 1-hour blocks with specific sub-activities.
Use this EXACT format, one per line:
[HH:MM-HH:MM] Sub-activity at Location

Available locations: Open Space, Meeting Room, Kitchen, Cafe, Park

Example (for a 3-hour work block):
[09:00-10:00] Reviewing pull requests at Open Space
[10:00-11:00] Writing new feature code at Open Space
[11:00-12:00] Testing and debugging at Open Space"""

        try:
            response = get_gpt().call(prompt, max_tokens=300, temperature=0.7)
            hourly = self._parse_daily_plan(response)
            if hourly:
                logger.debug(
                    "%s hourly decomposition: '%s' -> %d blocks",
                    agent.name, plan_item.description[:40], len(hourly),
                )
                return hourly
        except Exception as e:
            logger.warning("Hourly decomposition failed: %s", e)

        return [plan_item]

    def decompose_to_actions(self, agent: Agent, plan_item: PlanItem) -> List[PlanItem]:
        """계획 항목을 5-15분 단위 행동으로 분해 (3단계: hourly 먼저, 각 hourly를 action으로)"""
        # Step 1: hourly 분해
        hourly_blocks = self.decompose_to_hourly(agent, plan_item)

        # Step 2: 각 hourly 블록을 5-15분 action으로 분해
        all_actions: List[PlanItem] = []
        for block in hourly_blocks:
            actions = self._decompose_single_block(agent, block)
            all_actions.extend(actions)

        return all_actions if all_actions else [plan_item]

    def _decompose_single_block(self, agent: Agent, plan_item: PlanItem) -> List[PlanItem]:
        """단일 블록(hourly 또는 그 이하)을 5-15분 단위 행동으로 분해"""
        prompt = f"""Break down this activity into 5-15 minute specific actions:
{plan_item.description} ({plan_item.start_time}-{plan_item.end_time}) at {plan_item.location}

Character: {agent.name} ({agent.occupation})

Use this EXACT format, one per line:
[HH:MM] Action at Location

Example:
[09:00] Sit down at desk at Open Space
[09:05] Open laptop and check emails at Open Space"""

        try:
            response = get_gpt().call(prompt, max_tokens=300, temperature=0.7)
            actions = self._parse_actions(response)
            if actions:
                return actions
        except Exception as e:
            logger.warning("Action decomposition failed: %s", e)

        # 실패 시 원본 그대로
        return [plan_item]

    def get_current_action(self, plan: List[PlanItem], current_hour: int, current_minute: int) -> Optional[PlanItem]:
        """현재 시간에 해당하는 계획 항목 반환"""
        current_str = f"{current_hour:02d}:{current_minute:02d}"

        for item in plan:
            if item.start_time <= current_str < item.end_time:
                return item

        return None

    def regenerate_remaining_plan(
        self, agent: Agent, from_hour: int, from_minute: int, reaction: str, game_date: str = "Day 1",
    ) -> List[PlanItem]:
        """반응 이후 남은 스케줄을 재생성 (B-6 replanning)

        현재 시간 이후의 detailed actions를 새로 만든다.
        """
        from_str = f"{from_hour:02d}:{from_minute:02d}"

        # 현재 시간 이전의 완료된 계획 요약
        done_items = [p for p in agent.daily_plan if p.end_time <= from_str]
        done_summary = "; ".join(f"{p.start_time} {p.description}" for p in done_items) if done_items else "None"

        prompt = f"""{agent.name} ({agent.occupation}) just reacted to something at {from_str}.
Reaction: {reaction}

What was already done today: {done_summary}

Create a new schedule for the rest of the day (from {from_str} until end of day).
Use this EXACT format, one per line:
[HH:MM-HH:MM] Activity at Location

Available locations: Open Space, Meeting Room, Kitchen, Cafe, Park"""

        try:
            response = get_gpt().call(prompt, max_tokens=400, temperature=0.7)
            new_plan = self._parse_daily_plan(response)
            if new_plan:
                logger.info(
                    "%s replanned from %s: %d new items",
                    agent.name, from_str, len(new_plan),
                )
                return new_plan
        except Exception as e:
            logger.warning("Replanning failed for %s: %s", agent.name, e)

        return []

    def _parse_daily_plan(self, response: str) -> List[PlanItem]:
        """LLM 응답에서 계획 파싱"""
        plan = []
        pattern = r"\[(\d{2}:\d{2})-(\d{2}:\d{2})\]\s*(.+?)(?:\s+at\s+(.+))?$"

        for line in response.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            match = re.match(pattern, line)
            if match:
                start, end, desc, loc = match.groups()
                plan.append(PlanItem(
                    start_time=start,
                    end_time=end,
                    description=desc.strip(),
                    location=(loc or "").strip(),
                ))

        return plan

    def _parse_actions(self, response: str) -> List[PlanItem]:
        """분해된 행동 파싱"""
        actions = []
        pattern = r"\[(\d{2}:\d{2})\]\s*(.+?)(?:\s+at\s+(.+))?$"

        for line in response.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            match = re.match(pattern, line)
            if match:
                time_str, desc, loc = match.groups()
                actions.append(PlanItem(
                    start_time=time_str,
                    end_time=time_str,  # 세부 행동은 end_time 없음
                    description=desc.strip(),
                    location=(loc or "").strip(),
                ))

        return actions

    def _default_plan(self) -> List[PlanItem]:
        """기본 계획 (LLM 실패 시)"""
        return [
            PlanItem("09:00", "10:30", "Working", "Open Space"),
            PlanItem("10:30", "11:00", "Coffee break", "Kitchen"),
            PlanItem("11:00", "12:00", "Working", "Open Space"),
            PlanItem("12:00", "13:00", "Lunch", "Cafe"),
            PlanItem("13:00", "15:00", "Meeting", "Meeting Room"),
            PlanItem("15:00", "17:00", "Working", "Open Space"),
            PlanItem("17:00", "18:00", "Walk in the park", "Park"),
        ]
