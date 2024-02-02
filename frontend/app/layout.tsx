import '@/app/globals.css'
import Providers from './providers'

import { Inter } from '@next/font/google'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.min.css'
import '@/utils/logoAnimation.css'
import NextTopLoader from 'nextjs-toploader'
import { Metadata } from 'next'

const inter = Inter({
  weight: 'variable',
  subsets: ['latin'],
  display: 'swap',
})

// TODO: Set metadata for specific page routes
export const metadata: Metadata = {
  title: 'Phase Console',
  description: 'Open source secrets manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Providers>
        <body
          className={`${inter.className} w-full bg-neutral-200 dark:bg-neutral-900 min-h-screen antialiased`}
        >
          <NextTopLoader color="#10B981" showSpinner={false} height={1} />
          <ToastContainer
            position="bottom-right"
            autoClose={5000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="colored"
          />
          {children}
        </body>
      </Providers>
    </html>
  )
}
