"""v3.293 [WeeklyMission] 주간 미션 현황 API."""
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..services import weekly_missions as wm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/missions")


@router.get("/weekly")
async def weekly(current_user=Depends(get_current_user)):
    uid = str(current_user["id"])
    try:
        st = await wm.weekly_status(uid)
        logger.info(
            "[WeeklyMission] status user=%s week=%s %s",
            uid[:8], st["week"], [(m["key"], m["count"], m["rewarded"]) for m in st["missions"]],
        )
        return st
    except Exception:
        logger.exception("[WeeklyMission] status failed user=%s", uid[:8])
        return JSONResponse(status_code=500, content={"error": "미션 정보를 불러올 수 없습니다."})
