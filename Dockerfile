FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 \
      fonts-liberation fonts-dejavu-core tex-gyre fontconfig \
      libreoffice-writer-nogui libreoffice-impress-nogui \
    && rm -rf /var/lib/apt/lists/*
COPY fonts/ /usr/share/fonts/truetype/ascend/
RUN fc-cache -f
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py engine.py assets.enc roadmap.py roadmap_job.py roadmap_timing.py ./
COPY templates/ ./templates/
CMD gunicorn -b 0.0.0.0:${PORT:-10000} -w 1 --threads 4 --timeout 300 app:app
