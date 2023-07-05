#!/bin/sh

# Set up runtime env vars and start next server
scripts/replace-variable.sh && 
yarn start
