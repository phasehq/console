#!/bin/sh

find /app/public /app/.next -type f -name "*.js" |
while read file; do
    sed -i "s|BAKED_NEXT_PUBLIC_BACKEND_API_BASE|$NEXT_PUBLIC_BACKEND_API_BASE|g" "$file"
    sed -i "s|BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS|$NEXT_PUBLIC_NEXTAUTH_PROVIDERS|g" "$file"
done