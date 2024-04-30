import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import GitlabProvider from 'next-auth/providers/gitlab'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'
import { NextApiRequest, NextApiResponse } from 'next'

type AccessTokenResponse = {
  access_token: string
  refresh_token: string
}

type NextAuthOptionsCallback = (req: NextApiRequest, res: NextApiResponse) => NextAuthOptions

export const authOptions: NextAuthOptionsCallback = (_req, res) => {
  const providers = []

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      })
    )

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      })
    )

  if (process.env.GITLAB_CLIENT_ID && process.env.GITLAB_CLIENT_SECRET)
    providers.push(
      GitlabProvider({
        clientId: process.env.GITLAB_CLIENT_ID,
        clientSecret: process.env.GITLAB_CLIENT_SECRET,
      })
    )

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
