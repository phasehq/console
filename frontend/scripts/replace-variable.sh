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

# Go to the directory where Next.js generates its static files
cd /app/.next

# Find .js files and replace BAKED_NEXT_PUBLIC_BACKEND_API_BASE with the value of NEXT_PUBLIC_BACKEND_API_BASE
# and BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS with the value of NEXT_PUBLIC_NEXTAUTH_PROVIDERS
find . -type f -name "*.js" -exec sed -i "s|BAKED_NEXT_PUBLIC_BACKEND_API_BASE|$NEXT_PUBLIC_BACKEND_API_BASE|g" {} \;
find . -type f -name "*.js" -exec sed -i "s|BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS|$NEXT_PUBLIC_NEXTAUTH_PROVIDERS|g" {} \;

echo "Replacement complete."
