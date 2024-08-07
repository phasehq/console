#!/bin/sh

# Set up runtime env vars
bash scripts/replace-variable.sh

# Set HOST and PORT environment variables
export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-3000}

# Start the Next.js server
echo "Starting server on $HOST:$PORT"
NODE_ENV=production node server.js