#!/bin/sh

# Set up runtime env vars and start next server
bash scripts/replace-variable.sh && 
NODE_ENV=production HOSTNAME=:: PORT=3000 node server.js

