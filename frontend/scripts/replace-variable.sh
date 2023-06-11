#!/bin/sh

find /app/public /app/.next -type f -name "*.js" |
while read file; do
    sed -i "s|BAKED_NEXTAUTH_SECRET|$NEXTAUTH_SECRET|g" "$file"
    sed -i "s|BAKED_NEXT_PUBLIC_NEXTAUTH_PROVIDERS|$NEXT_PUBLIC_NEXTAUTH_PROVIDERS|g" "$file"
    sed -i "s|BAKED_GITHUB_CLIENT_ID|$GITHUB_CLIENT_ID|g" "$file"
    sed -i "s|BAKED_GITHUB_CLIENT_SECRET|$GITHUB_CLIENT_SECRET|g" "$file"
    sed -i "s|BAKED_GOOGLE_CLIENT_ID|$GOOGLE_CLIENT_ID|g" "$file"
    sed -i "s|BAKED_GOOGLE_CLIENT_SECRET|$GOOGLE_CLIENT_SECRET|g" "$file"
    sed -i "s|BAKED_GITLAB_CLIENT_ID|$GITLAB_CLIENT_ID|g" "$file"
    sed -i "s|BAKED_GITLAB_CLIENT_SECRET|$GITLAB_CLIENT_SECRET|g" "$file"
done