# =============================================================================
# MAIDOL backend (backend_9006) application image — v198, 2026-08-21
# =============================================================================
# WHAT
#   Two-stage image for the FastAPI backend that serves port 9006. Stage 1
#   builds a self-contained virtualenv at /opt/venv (madmom is compiled from
#   source there); stage 2 keeps only the runtime: ffmpeg, Korean fonts, and
#   the venv. Application assets are copied last so a code change does not
#   invalidate the expensive dependency layers.
#
# HOW TO BUILD  (build context is backend_9006/)
#   cd backend_9006 && docker build -t maidol-backend:v198 .
#
# HOW TO RUN    (secrets are injected at runtime — never baked into the image)
#   docker run --rm -p 9006:9006 --env-file /etc/maidol/backend.env \
#     maidol-backend:v198
#
# WHY python:3.11-slim-bookworm AND NOT ubuntu:24.04 (deliberate deviation)
#   The migration request recommended Ubuntu 24.04. We deviate for three
#   measured reasons:
#     1. The only substantive reason to prefer Ubuntu 24.04 was that its apt
#        ffmpeg ships librubberband and libass. Debian 12 (bookworm) apt
#        ffmpeg 5.1.9 ships BOTH as well — verified by running both candidate
#        base images and inspecting `ffmpeg -filters` / build flags inside the
#        containers. So the reason for the recommendation is already satisfied.
#     2. Ubuntu 24.04 has NO python3.11 in its archive (default is 3.12). This
#        project is pinned to 3.11 (.python-version 3.11.15) and madmom is
#        installed from git specifically for Python 3.11 compatibility
#        (requirements.txt). Moving to 3.12 would force a re-validation of the
#        madmom / numba / llvmlite stack — the opposite of this change's goal
#        (build reproducibility). Getting 3.11 onto 24.04 would require the
#        deadsnakes PPA or a source build, i.e. adding an external, unpinned
#        dependency to a reproducibility change. Self-contradictory.
#     3. The container base OS is independent of the EC2 host OS — only the
#        kernel is shared. Target is t3.large, x86_64, glibc; identical here.
#
# NOTE — htdemucs model weights are NOT baked in.
#   demucs_service.py calls get_model("htdemucs"), which loads from the torch
#   hub cache. The cache is empty in this image, so the FIRST /api/vocal-repair
#   request downloads the checkpoint from dl.fbaipublicfiles.com. That is fine
#   on a VPC with egress; in an air-gapped VPC, mount a pre-populated cache and
#   point $TORCH_HOME at it, e.g.
#     -e TORCH_HOME=/var/cache/torch -v maidol-torch-cache:/var/cache/torch
#   Baking the weights in was rejected: +300-400MB and it would make the build
#   depend on an external download, defeating build reproducibility.
#
# NOTE — logging differs from run.sh on purpose.
#   run.sh pipes uvicorn through awk|tee into logs/server.log. In a container
#   that pipeline is an anti-pattern: PID 1 would become the shell, so SIGTERM
#   would never reach uvicorn and the lifespan shutdown hooks (close_postgres
#   etc.) would not run. Here uvicorn is exec'd directly and logs go to stdout;
#   use `docker logs` instead of /api/_logs/tail.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — builder: compile madmom and resolve the locked dependency set.
# -----------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential + python3-dev: madmom is Cython source, it must be compiled.
# git: REQUIRED — madmom is installed from a git+https URL and pip shells out
#      to git to clone it. Without it the build fails late and confusingly.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        python3-dev \
        git; \
    rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Dependency manifests only — copied BEFORE the application code so that
# editing a route does not invalidate the (very expensive) install layers.
COPY requirements.lock constraints-cpu.txt requirements.txt ./

# --- madmom, in three deliberately separate layers ---------------------------
# (1) Build prerequisites first. madmom's setup.py does `import numpy` and
#     `from Cython... import ...` at top level, so they must already exist.
RUN pip install "Cython==3.2.5" "numpy==2.4.6"

# (2) madmom itself, pinned to the exact commit currently running in the dev
#     venv (read from its direct_url.json), so an upstream main that moves —
#     or breaks — cannot shift this build.
#
#     --no-build-isolation is REQUIRED, not an optimisation: with isolation on,
#     pip builds madmom in a throwaway env that has no numpy, and would either
#     die with ModuleNotFoundError or pull a *different* numpy in and produce a
#     compiled extension whose ABI does not match the numpy 2.4.6 that ends up
#     at runtime.
#
#     Kept as its own layer so a madmom compile failure is immediately visible
#     rather than buried inside a 110-package install.
RUN pip install --no-build-isolation \
    "madmom @ git+https://github.com/CPJKU/madmom.git@27f032e8947204902c675e5e341a3faf5dc86dae"

# (3) Everything else, fully pinned. The lock file carries
#     `--extra-index-url https://download.pytorch.org/whl/cpu` at the top and
#     pins torch/torchaudio to +cpu builds, so no CUDA runtime enters the image
#     (~3.4GB saved). madmom is already satisfied by step (2).
RUN pip install -r requirements.lock

# -----------------------------------------------------------------------------
# Stage 2 — runtime: no compilers, no git, no build headers (~300MB saved).
# -----------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# ffmpeg        — 13 source files shell out to ffmpeg/ffprobe. The Debian build
#                 carries librubberband (pitch shift, no fallback path in the
#                 code), libass (subtitle burn-in), libmp3lame and libx264.
# fonts-nanum   — REQUIRED. mv_pipeline.py:2345,3086,3395 and mv.py:2239 render
#   + fontconfig  ASS WITHOUT passing fontsdir, so libass resolves the font name
#                 (`NanumGothic`) through fontconfig. A slim base has zero fonts
#                 installed; without these the subtitles render as blank/tofu
#                 boxes with NO error at all — the worst kind of regression.
# curl          — used by HEALTHCHECK below.
# ca-certificates — TLS for httpx / boto3 / minio.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-nanum \
        fontconfig \
        curl \
        ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    fc-cache -f

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

WORKDIR /srv/app

# --- Application assets, copied LAST to minimise cache invalidation ----------
# infra/ MUST be included: infra/style_samples/ (7.9MB) is read at runtime by
# character.py:74-80 and served by GET /api/character/style-samples. The
# infra/init_*.{sql,js,py} and seed_data.py files are kept so first-boot
# bootstrap can be run with `docker exec`.
# app/assets/fonts/NanumGothic-Regular.ttf comes along inside app/ — it is what
# share_video.py:39-40 passes to ffmpeg as `ass=...:fontsdir=`.
# scripts/ holds backfill utilities (backfill_es.py etc.) run via docker exec.
COPY app/ ./app/
COPY infra/ ./infra/
COPY scripts/ ./scripts/
COPY seed_item_store.py ./
COPY requirements.txt requirements.lock constraints-cpu.txt ./

# --- Build-time self-check ---------------------------------------------------
# If any of these fails, no image is produced. This is the defence line for the
# three silent-degradation risks: a missing ffmpeg filter (rubberband/ass have
# NO fallback in the code — they hard-fail at request time), a missing Korean
# font (renders blank, no error), and a CUDA torch sneaking back in.
#
# The final assert is the CPU-only regression guard: if someone reverts the
# lock file to plain PyPI torch wheels, this build breaks loudly.
RUN set -eux; \
    command -v ffmpeg; \
    command -v ffprobe; \
    ffmpeg -hide_banner -filters | grep -qw rubberband; \
    ffmpeg -hide_banner -filters | grep -q ' ass  *V->V'; \
    ffmpeg -hide_banner -encoders | grep -qw libmp3lame; \
    ffmpeg -hide_banner -encoders | grep -qw libx264; \
    fc-list | grep -qi nanum; \
    python -c "import madmom, torch, librosa, soundfile, numpy; print('madmom', madmom.__version__); print('torch', torch.__version__); print('numpy', numpy.__version__); assert '+cpu' in torch.__version__, 'CUDA torch leaked into image'"

# --- Non-root ----------------------------------------------------------------
# Nothing is written to the image filesystem at runtime: every temporary file
# goes through tempfile.TemporaryDirectory() (i.e. /tmp) and every artefact is
# uploaded to MinIO/S3. So a read-only, unprivileged rootfs is sufficient.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin app
USER app

EXPOSE 9006

# /api/health (main.py:657-659) is a liveness probe only — it does not touch the
# databases. Deliberately left as-is here; a dependency-aware readiness endpoint
# is a separate work item, and this directive only needs its URL swapped when
# that lands.
# start-period=90s: the lifespan runs ~40 idempotent migrations plus the
# Elasticsearch index bootstrap before serving. A shorter grace period would
# mark a perfectly healthy container unhealthy while it is still starting.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:9006/api/health || exit 1

# exec form (no shell, no pipes) so uvicorn is PID 1 and receives SIGTERM,
# which is what triggers the lifespan shutdown (close_postgres/mongo/redis).
# No --workers on purpose: on 2 vCPU / 8GB each extra worker loads its own copy
# of torch + numpy + numba, roughly doubling RSS for no throughput gain. This
# also matches run.sh, which does not set --workers either.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9006"]
