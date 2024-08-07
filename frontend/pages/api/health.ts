import type { NextApiRequest, NextApiResponse } from 'next'
import auth from './auth/[...nextauth]'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return auth(req, res)
}