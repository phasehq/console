# ---- Base Node ----
FROM node:alpine AS base
# set working directory
WORKDIR /app

# Add a new user "app" and switch to this non-root user
RUN addgroup app && adduser -S -G app app
USER app

# copy project file
COPY package.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies
# Install node packages
RUN yarn install --frozen-lockfile --no-cache && yarn cache clean
# Copy production node_modules aside (this is a neat trick to get only production modules)
RUN cp -R node_modules /tmp/node_modules
# Install ALL node_modules, including 'devDependencies'
RUN yarn install --frozen-lockfile

# ---- Build ----
FROM dependencies AS build
COPY . .

# Set baked environment variables. These will be replaced once the container starts.
ARG NEXT_PUBLIC_BACKEND_API_BASE=BAKED_NEXT_PUBLIC_BACKEND_API_BASE
ARG NEXT_PUBLIC_NEXTAUTH_PROVIDERS=BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS
ARG NEXT_PUBLIC_APP_HOST=BAKED_NEXT_PUBLIC_APP_HOST
RUN yarn build

# ---- Release ----
FROM base AS release
# copy production node_modules
COPY --from=dependencies /tmp/node_modules ./node_modules
# copy app sources
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# copy scripts directory
COPY scripts ./scripts
# copy next config
COPY next.config.js ./

# Temporarily switch back to root to run chmod and then back to app user
USER root
RUN chmod 555 ./scripts/*
USER app

EXPOSE 3000
CMD ["/app/scripts/start.sh"]
