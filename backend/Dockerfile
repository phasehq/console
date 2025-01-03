# Stage 1: Build dependencies
FROM python:3.12.1-alpine3.19

ADD requirements.txt /app/requirements.txt
ADD constraints.txt /app/constraints.txt

ENV PIP_CONSTRAINT=/app/constraints.txt
ENV SKIP_DJANGO_MIGRATIONS=false

RUN set -ex \
    && apk add --no-cache --virtual .build-deps postgresql-dev build-base gcc musl-dev jpeg-dev zlib-dev libffi-dev cairo-dev pango-dev gdk-pixbuf-dev mariadb-dev python3-dev \
    && python -m venv /env \
    && /env/bin/pip install --upgrade pip \
    && /env/bin/pip install --no-cache-dir -r /app/requirements.txt \
    && runDeps="$(scanelf --needed --nobanner --recursive /env \
    | awk '{ gsub(/,/, "\nso:", $2); print "so:" $2 }' \
    | sort -u \
    | xargs -r apk info --installed \
    | sort -u)" \
    && apk add --virtual rundeps $runDeps \
    && apk del .build-deps

RUN apk add --no-cache curl
RUN addgroup -S app && adduser -S app -G app
ADD . /app
WORKDIR /app
RUN chmod 555 /app/scripts/*
RUN chown -R app:app /app
USER app

ENV VIRTUAL_ENV /env
ENV PATH /env/bin:$PATH

EXPOSE 8000

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["gunicorn", "-b", "[::]:8000", "--workers", "3", "backend.wsgi:application"]
