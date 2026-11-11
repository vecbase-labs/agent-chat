import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '#/components/ui/sonner'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Agent Chat',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a href="/" className="underline underline-offset-4">
        Return to Agent Chat
      </a>
    </main>
  ),
  errorComponent: () => (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <h1 className="text-2xl font-semibold">Unable to open this page</h1>
      <p className="text-muted-foreground">
        Reload to reconnect. If the issue continues, check the server and
        database.
      </p>
      <a href="/" className="underline underline-offset-4">
        Reload Agent Chat
      </a>
    </main>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 2000, retry: false } },
      }),
  )
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
        >
          <QueryClientProvider client={queryClient}>
            {children}
            <Toaster />
          </QueryClientProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
