# Local development only: the API and worker with the source mounted from your checkout.
# Production images come later with hosting.
FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir uv==0.11.32

WORKDIR /app/backend
# The virtual environment lives outside the mounted source, so your checkout stays clean.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    # Clew itself runs straight from the mounted source, so edits apply without a rebuild.
    PYTHONPATH=/app/backend/src

# Dependencies only, so this layer is reused until uv.lock changes.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project
