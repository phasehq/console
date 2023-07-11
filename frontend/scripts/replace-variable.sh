#!/bin/bash

# Ensure NEXT_PUBLIC_BACKEND_API_BASE and NEXT_PUBLIC_NEXTAUTH_PROVIDERS are set
if [ -z "$NEXT_PUBLIC_BACKEND_API_BASE" ]; then
    echo "NEXT_PUBLIC_BACKEND_API_BASE is not set. Please set it and rerun the script."
    exit 1
fi

if [ -z "$NEXT_PUBLIC_NEXTAUTH_PROVIDERS" ]; then
    echo "NEXT_PUBLIC_NEXTAUTH_PROVIDERS is not set. Please set it and rerun the script."
    exit 1
fi

find /app/public /app/.next -type f -name "*.js" |
while read file; do
    sed -i "s|BAKED_NEXT_PUBLIC_BACKEND_API_BASE|$NEXT_PUBLIC_BACKEND_API_BASE|g" "$file"
    sed -i "s|BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS|$NEXT_PUBLIC_NEXTAUTH_PROVIDERS|g" "$file"
    sed -i "s|BAKED_NEXT_PUBLIC_APP_HOST|$NEXT_PUBLIC_APP_HOST|g" "$file"
done