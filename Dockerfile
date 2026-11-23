FROM python:3.12-slim-bookworm

# CPU-only builds use https://download.pytorch.org/whl/cpu instead.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/faseeh/.cache/huggingface \
    FORWARDED_ALLOW_IPS=127.0.0.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 faseeh \
    && install -d -o faseeh -g faseeh /home/faseeh/.cache/huggingface

WORKDIR /app
COPY requirements.txt requirements-model.txt ./
RUN --mount=type=secret,id=build_ca_bundle \
    if [ -f /run/secrets/build_ca_bundle ]; then export PIP_CERT=/run/secrets/build_ca_bundle; fi; \
    python -m pip install --no-cache-dir --index-url "${TORCH_INDEX_URL}" torch==2.8.0 \
    && python -m pip install --no-cache-dir -r requirements.txt -r requirements-model.txt \
    && python -m pip check

COPY --chown=faseeh:faseeh main.py recording_service.py muaalem_engine.py NOTICE ./
COPY --chown=faseeh:faseeh web/ web/
USER faseeh
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--proxy-headers"]
