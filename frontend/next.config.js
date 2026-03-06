/** @type {import('next').NextConfig} */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://session.phase.dev https://checkout.stripe.com https://js.stripe.com https://*.js.stripe.com;
  style-src 'self' 'unsafe-inline';
  object-src 'none';
  base-uri 'self';
  connect-src 'self' data: http://127.0.0.1:* https://*.phase.dev https://phase.statuspage.io/api/v2/status.json https://checkout.stripe.com https://api.stripe.com https://api.github.com; 
  font-src 'self';
  frame-src 'self' https://checkout.stripe.com https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com;
  img-src 'self' https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://secure.gravatar.com https://gitlab.com https://*.stripe.com; 
  manifest-src 'self';
  media-src 'self';
  worker-src 'self' blob:;
`

const securityHeaders = [
  //Strict-Transport-Security: This header informs browsers it should only be accessed using HTTPS, instead of using HTTP. Using the configuration below, all present and future subdomains will use HTTPS for a max-age of 2 years. This blocks access to pages or subdomains that can only be served over HTTP.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // X-DNS-Prefetch-Control: This header controls DNS prefetching, allowing browsers to proactively perform domain name resolution on external links, images, CSS, JavaScript, and more. This prefetching is performed in the background, so the DNS is more likely to be resolved by the time the referenced items are needed. This reduces latency when the user clicks a link.
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  // X-XSS-Protection: This header stops pages from loading when they detect reflected cross-site scripting (XSS) attacks. Although this protection is not necessary when sites implement a strong Content-Security-Policy disabling the use of inline JavaScript ('unsafe-inline'), it can still provide protection for older web browsers that don't support CSP.
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  // X-Frame-Options: This header indicates whether the site should be allowed to be displayed within an iframe. This can prevent against clickjacking attacks. This header has been superseded by CSP's frame-ancestors option, which has better support in modern browsers.
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  // X-Content-Type-Options: This header prevents the browser from attempting to guess the type of content if the Content-Type header is not explicitly set. This can prevent XSS exploits for websites that allow users to upload and share files. For example, a user trying to download an image, but having it treated as a different Content-Type like an executable, which could be malicious. This header also applies to downloading browser extensions. The only valid value for this header is nosniff.
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  // Permissions-Policy (previously known as Feature-Policy), which is a mechanism that allows you to control which web platform features your site can access (like geolocation, microphone, camera, etc.)
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=()',
  },
  // Referrer-Policy: This header controls how much information the browser includes when navigating from the current website (origin) to another.
  {
    key: 'Referrer-Policy',
    value: 'no-referrer',
  },
  // Content-Security-Policy: This header helps prevent cross-site scripting (XSS), clickjacking and other code injection attacks. Content Security Policy (CSP) can specify allowed origins for content including scripts, stylesheets, images, fonts, objects, media (audio, video), iframes, and more.
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy.replace(/\s{2,}/g, ' ').trim(),
  },
]

const nextConfig = {
  async headers() {
    return process.env.NODE_ENV === 'development'
      ? []
      : [
          {
            // Apply security headers to all routes.
            source: '/:path*',
            headers: securityHeaders,
          },
        ]
  },
  output: 'standalone',
  experimental: {},
  webpack: (config, options) => {
    config.module.rules.push({
      test: /\.(graphql|gql)/,
      exclude: /node_modules/,
      loader: 'graphql-tag/loader',
    })

    return config
  },
}

module.exports = nextConfig
