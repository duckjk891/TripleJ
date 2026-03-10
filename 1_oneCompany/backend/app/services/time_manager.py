"""백엔드 게임 시간 관리 (프론트엔드 GameTimeManager.ts 미러링)"""

import time


class TimeManagerService:
    def __init__(self, start_hour: int = 6):
        self.total_game_minutes = start_hour * 60.0
        self.speed = 1
        self.paused = False
        self._last_real_time = time.time()

    def update(self) -> None:
        if self.paused:
            return
        now = time.time()
        elapsed = now - self._last_real_time
        self._last_real_time = now
        # 1x: 실제 1초 = 게임 1분
        self.total_game_minutes += elapsed * self.speed

    @property
    def hour(self) -> int:
        return int(self.total_game_minutes / 60) % 24

    @property
    def minute(self) -> int:
        return int(self.total_game_minutes) % 60

    @property
    def day(self) -> int:
        return int(self.total_game_minutes / (24 * 60)) + 1

    @property
    def display(self) -> str:
        h = self.hour
        m = self.minute
        period = "AM" if h < 12 else "PM"
        display_h = h % 12
        if display_h == 0:
            display_h = 12
        return f"📅 Day {self.day}   🕐 {display_h}:{m:02d} {period}"

    def set_speed(self, speed: int) -> None:
        self.update()
        self.speed = speed

    def pause(self) -> None:
        self.update()
        self.paused = True

    def resume(self) -> None:
        self.paused = False
        self._last_real_time = time.time()

    def to_dict(self) -> dict:
        self.update()
        return {
            "hour": self.hour,
            "minute": self.minute,
            "day": self.day,
            "display": self.display,
            "speed": self.speed,
            "paused": self.paused,
        }


# 싱글톤 인스턴스
time_manager = TimeManagerService()
