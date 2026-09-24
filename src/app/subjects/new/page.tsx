import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import NewStoryView from '@/components/NewStoryView';

export default async function NewStoryPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <NewStoryView />;
}
