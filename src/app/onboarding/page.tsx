import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import OnboardingForm from '@/components/Onboarding/OnboardingForm';

export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile?.onboarded_at) redirect('/subjects');

  return <OnboardingForm initialManifesto={profile?.writing_manifesto ?? ''} />;
}
