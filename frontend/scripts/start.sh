#!/bin/sh

# Set up runtime env vars and start next server
bash scripts/replace-variable.sh && 
node server.js
