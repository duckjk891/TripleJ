# 읽기 전용 — 컨테이너의 공급 경로 스위치 상태(값이 아니라 경로 이름만) 출력. 키·비밀 값은 출력하지 않는다.
import sys

sys.path.insert(0, "/srv/app")
from app.config import settings  # noqa: E402
from app.services import ai_providers as ap  # noqa: E402

print("claude={} gemini={} gemini_vertex_ratio={} gemini_aistudio_fallback={} openai={} image_fallback_gemini={} "
      "alert_threshold={}/{}s alert_mail={}".format(
          ap.claude_provider(), ap.gemini_provider(), ap.gemini_vertex_ratio(),
          bool(settings.gemini_aistudio_fallback), ap.openai_provider(), bool(settings.image_fallback_gemini),
          settings.ai_429_alert_threshold, settings.ai_429_alert_window_sec,
          "on" if (settings.ai_429_alert_email or "").strip() else "off"))
print("keys_present google={} vertex={} anthropic={} openai={} azure={}".format(
    bool(settings.google_api_key), bool(settings.vertex_api_key), bool(settings.anthropic_api_key),
    bool(settings.openai_api_key), bool(settings.azure_openai_api_key)))
