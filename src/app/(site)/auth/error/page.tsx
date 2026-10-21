import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Sign-in failed — Payload Directory', robots: { index: false } }

// Blocked accounts, database errors and unknown reasons deliberately share the generic message.
const MESSAGES: Record<string, string> = {
  denied: 'You cancelled the GitHub authorisation.',
  state_mismatch: 'The sign-in link expired or was opened in another browser. Please try again.',
  missing_code: 'GitHub did not return an authorisation code.',
  exchange_failed: 'GitHub rejected the sign-in. Please try again.',
  profile_failed: 'We could not read your GitHub profile. Please try again.',
  logout_incomplete: 'Signed out on this device, but other sessions could not be ended. Sign in and sign out again to end them everywhere.',
  not_configured: 'GitHub sign-in is not available right now.',
}

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams
  const signOut = reason === 'logout_incomplete'
  const message = (reason && Object.hasOwn(MESSAGES, reason) && MESSAGES[reason]) || 'Something went wrong while signing in.'
  return (
    <div className="container mx-auto max-w-lg px-4 py-16">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{signOut ? 'Sign-out incomplete' : 'Sign-in failed'}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <a href="/auth/github">{signOut ? 'Sign in again' : 'Try again'}</a>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to directory</Link>
        </Button>
      </div>
    </div>
  )
}
