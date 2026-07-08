#!/bin/bash
cd "/mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000"
exec ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload >> logs/server.log 2>&1
