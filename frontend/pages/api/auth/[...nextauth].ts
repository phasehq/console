import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import GitlabProvider from 'next-auth/providers/gitlab'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'
import { NextApiRequest, NextApiResponse } from 'next'
import { getSecret } from '@/utils/secretConfig'
import { OIDCProvider } from '@/ee/authentication/sso/oidc/util/genericOIDCProvider'

type AccessTokenResponse = {
  access_token: string
  refresh_token: string
}

type NextAuthOptionsCallback = (req: NextApiRequest, res: NextApiResponse) => NextAuthOptions

export const authOptions: NextAuthOptionsCallback = (_req, res) => {
  const providers = []

  if (process.env.GOOGLE_CLIENT_ID) {
    const clientSecret = getSecret('GOOGLE_CLIENT_SECRET')
    if (clientSecret) {
      providers.push(
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: clientSecret,
        })
      )
    }
  }

  if (process.env.GITHUB_CLIENT_ID) {
    const clientSecret = getSecret('GITHUB_CLIENT_SECRET') 
    if (clientSecret) {
      providers.push(
        GitHubProvider({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: clientSecret,
        })
      )
    }
  }

  if (process.env.GITLAB_CLIENT_ID) {
    const clientSecret = getSecret('GITLAB_CLIENT_SECRET')
    if (clientSecret) {
      providers.push(
        GitlabProvider({
          clientId: process.env.GITLAB_CLIENT_ID,
          clientSecret: clientSecret,
          authorization: {
            url: `${process.env.GITLAB_AUTH_URL || 'https://gitlab.com'}/oauth/authorize`,
            params: { scope: 'read_user' },
          },
          token: `${process.env.GITLAB_AUTH_URL || 'https://gitlab.com'}/oauth/token`,
          userinfo: `${process.env.GITLAB_AUTH_URL || 'https://gitlab.com'}/api/v4/user`,
        })
      )
    }
  }

  if (process.env.GOOGLE_OIDC_CLIENT_ID) {
    const clientSecret = getSecret('GOOGLE_OIDC_CLIENT_SECRET')
    if (clientSecret) {
      providers.push(
        OIDCProvider({
          id: 'google-oidc',
          name: 'Google OIDC',
          type: 'oauth',
          clientId: process.env.GOOGLE_OIDC_CLIENT_ID,
          clientSecret: clientSecret,
          issuer: 'https://accounts.google.com',
          wellKnown: 'https://accounts.google.com/.well-known/openid-configuration',
          authorization: { params: { scope: 'openid email profile' } },
          profile: (profile) => {
            return {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
            }
          },
        })
      )
    }
  }

  return {
    secret: process.env.NEXTAUTH_SECRET,
    session: {
      strategy: 'jwt',
      maxAge: 24 * 60 * 60, // 24 hours
    },
    jwt: {
      secret: process.env.NEXTAUTH_SECRET,
    },
    providers,
    callbacks: {
      async signIn({ user }) {
        const domainWhitelist = process.env.USER_EMAIL_DOMAIN_WHITELIST?.split(',') || []

        if (domainWhitelist.length) {
          let userEmail = user.email!

          // Extract domain from email
          const domain = userEmail?.split('@')[1]

          if (domainWhitelist.includes(domain)) {
            return true // Sign-in allowed
          } else {
            return false // Sign-in denied
          }
        }
        return true
      },
      async jwt({ token, user, account, profile }) {
        if (user) {
          if (account?.provider) {
            let loginPayload = {}
            if (account.provider === 'google') {
              const { access_token, id_token } = account
              loginPayload = {
                access_token: id_token,
                id_token: id_token,
              }
            } else if (account.provider === 'github') {
              const { access_token } = account
              loginPayload = {
                access_token: access_token,
              }
            } else if (account.provider === 'gitlab') {
              const { access_token } = account
              loginPayload = {
                access_token: access_token,
              }
            }

            try {
              //get client user agent and ip
              const userAgent = _req.headers['user-agent']
              const ip = _req.headers['x-forwarded-for']

              const response = await axios.post<AccessTokenResponse>(
                UrlUtils.makeUrl(
                  process.env.BACKEND_API_BASE!,
                  'social',
                  'login',
                  account.provider
                ),
                loginPayload,
                {
                  withCredentials: true,
                  headers: {
                    'User-agent': userAgent,
                    'X-forwarded-for': ip,
                  },
                }
              )

              // Add set-cookie header to response
              if (response.headers['set-cookie'])
                res.setHeader('set-cookie', response.headers['set-cookie'])

              // Add OAuth profile data to token
              token.user = profile

              return token
            } catch (error) {
              console.log(error)
              throw 'Backend error'
            }
          }
        }
        return token
      },
    },
    pages: {
      newUser: '/signup',
      signIn: '/login',
    },
    debug: process.env.DEBUG ? process.env.DEBUG === 'True' : false,
  }
}

// eslint-disable-next-line import/no-anonymous-default-export
export default (req: NextApiRequest, res: NextApiResponse) =>
  NextAuth(req, res, authOptions(req, res))
