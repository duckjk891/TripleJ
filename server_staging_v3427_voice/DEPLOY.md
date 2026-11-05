# v3.427 목소리 샘플 삭제 (11-05 운영 반영)
- 대상: app/routes/voice_clone.py, app/services/voice_clone_service.py (운영본 기준 수정본, origin/backend 는 v3.423 이전)
- 추가: POST /api/voice-clone/samples/delete, svc.delete_voice_sample
- 옛 컨테이너: maidol-app-old-v3427, 파일 백업: /home/ubuntu/maidol/backup_v3427_*
