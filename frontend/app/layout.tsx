import '@/app/globals.css'
import Providers from './providers'

import { Inter, JetBrains_Mono } from 'next/font/google'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.min.css'
import '@/utils/logoAnimation.css'
import NextTopLoader from 'nextjs-toploader'
import { Metadata } from 'next'

const inter = Inter({
  weight: 'variable',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const jetbrains_mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

// TODO: Set metadata for specific page routes
export const metadata: Metadata = {
  title: 'Phase Console',
  description: 'Open source secrets manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href={`/favicon.svg`} key="favicon" />
        <link
          rel="mask-icon"
          type="image/svg+xml"
          href={`/favicon.svg`}
          key="favicon-safari"
          color="#000000"
        />
      </head>
      <Providers>
        <body
          className={`${inter.variable} ${jetbrains_mono.variable} font-sans w-full bg-neutral-200 dark:bg-neutral-900 min-h-screen antialiased`}
        >
          <NextTopLoader color="#10B981" showSpinner={false} height={1} />
          <ToastContainer
            position="bottom-right"
            autoClose={4000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme={'dark'}
            stacked
            bodyClassName="text-xs"
          />

          {children}
        </body>
      </Providers>
    </html>
  )
}
