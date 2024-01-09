# ---- Base Node ----
FROM node:alpine AS base
# set working directory
WORKDIR /app

# install system dependencies
RUN apk add curl

# Add a new user "app" and change ownership of the /app directory
RUN addgroup app && adduser -S -G app app && chown -R app:app /app

# Switch to the new user "app"
USER app

# copy project file
COPY --chown=app:app package.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies

# install node packages
RUN yarn install --frozen-lockfile --no-cache && yarn cache clean
# copy production node_modules aside
RUN cp -R node_modules /tmp/node_modules
# install ALL node_modules, including 'devDependencies'
RUN yarn install --frozen-lockfile

# ---- Build ----
FROM dependencies AS build
COPY --chown=app:app . .

# Set environment variables
ARG NEXT_PUBLIC_BACKEND_API_BASE=BAKED_NEXT_PUBLIC_BACKEND_API_BASE
ARG NEXT_PUBLIC_NEXTAUTH_PROVIDERS=BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS
ARG NEXT_PUBLIC_APP_HOST=BAKED_NEXT_PUBLIC_APP_HOST
ARG NEXT_PUBLIC_POSTHOG_KEY=BAKED_NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID=BAKED_NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID
RUN yarn build

# ---- Release ----
FROM base AS release
# copy production node_modules
COPY --from=dependencies /tmp/node_modules ./node_modules
# copy app sources
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# copy scripts directory
COPY --chown=app:app scripts ./scripts
# copy next config
COPY --chown=app:app next.config.js ./

# Switch back to root to change permissions and then back to app user
USER root
RUN chmod 555 ./scripts/*
USER app

# expose port and define CMD
EXPOSE 3000
CMD ["/app/scripts/start.sh"]
