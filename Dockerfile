FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 \
      fonts-liberation fonts-dejavu-core tex-gyre \
      libreoffice-writer-nogui \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py engine.py assets.enc ./
CMD gunicorn -b 0.0.0.0:${PORT:-10000} -w 1 --threads 4 --timeout 300 app:app
