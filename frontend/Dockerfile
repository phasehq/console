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

# ---- Copy Files ----
FROM dependencies AS prepare-release
COPY . .

# ---- Release ----
FROM base AS release
# copy production node_modules
COPY --from=dependencies /tmp/node_modules ./node_modules
# copy app sources
COPY --from=prepare-release /app ./
# expose port 
EXPOSE 3000
# set the entrypoint to build and start the application
ENTRYPOINT ["sh", "-c", "yarn build && yarn start"]
