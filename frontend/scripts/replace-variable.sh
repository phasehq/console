#!/bin/bash
# replace-variables.sh

# Define a list of mandatory environment variables to check
MANDATORY_VARS=("NEXT_PUBLIC_BACKEND_API_BASE" "NEXT_PUBLIC_NEXTAUTH_PROVIDERS")

# Define a list of optional environment variables (no check needed)
OPTIONAL_VARS=("APP_HOST" "NEXT_PUBLIC_POSTHOG_KEY" "NEXT_PUBLIC_POSTHOG_HOST" "NEXT_PUBLIC_GITHUB_INTEGRATION_CLIENT_ID")

# Infer NEXT_PUBLIC_APP_HOST from APP_HOST if not already set
if [ -z "$NEXT_PUBLIC_APP_HOST" ] && [ ! -z "$APP_HOST" ]; then
    export NEXT_PUBLIC_APP_HOST="$APP_HOST"
fi

# Check if each mandatory variable is set
for VAR in "${MANDATORY_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        echo "$VAR is not set. Please set it and rerun the script."
        exit 1
    fi
done

# Combine mandatory and optional variables for replacement
ALL_VARS=("${MANDATORY_VARS[@]}" "${OPTIONAL_VARS[@]}")

# Add NEXT_PUBLIC_APP_HOST to the list for replacement
ALL_VARS+=("NEXT_PUBLIC_APP_HOST")

# Find and replace BAKED values with real values
find /app/public /app/.next -type f -name "*.js" |
while read file; do
    for VAR in "${ALL_VARS[@]}"; do
        if [ ! -z "${!VAR}" ]; then
            sed -i "s|BAKED_$VAR|${!VAR}|g" "$file"
        fi
    done
done
