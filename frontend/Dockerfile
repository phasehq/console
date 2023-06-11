# ---- Base Node ----
FROM node:alpine AS base
# set working directory
WORKDIR /app
# copy project file
COPY package.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies
# install node packages
RUN yarn install --frozen-lockfile --no-cache && yarn cache clean
# copy production node_modules aside (this is a neat trick to get only production modules)
RUN cp -R node_modules /tmp/node_modules
# install ALL node_modules, including 'devDependencies'
RUN yarn install --frozen-lockfile

# ---- Build ----
FROM dependencies AS build
COPY . .

# Set environment variables
ENV NEXT_PUBLIC_BACKEND_API_BASE=BAKED_NEXT_PUBLIC_BACKEND_API_BASE
ENV NEXT_PUBLIC_NEXTAUTH_PROVIDERS=BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS
RUN yarn build

# ---- Release ----
FROM base AS release
# copy production node_modules
COPY --from=dependencies /tmp/node_modules ./node_modules
# copy app sources
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# copy next config
COPY next.config.js ./
# expose port and define CMD
RUN chmod 555 /app/scripts/*
EXPOSE 3000
CMD ["/app/scripts/start.sh"]
