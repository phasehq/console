#!/bin/sh

# Set up runtime env vars and start next server
bash scripts/replace-variable.sh && 
NODE_ENV=production HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT=3000 node server.js
