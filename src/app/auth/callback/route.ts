import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Google OAuth redirects here with a `code` param after the consent screen.
// Exchanging it sets the Supabase session cookie, then we send the user into
// the app (new users land on /onboarding via the profiles.onboarded_at check
// on the /subjects page itself).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/subjects';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
