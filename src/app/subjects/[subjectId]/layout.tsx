import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// The prototype's Outline page has no left nav at all — just a
// "‹ See all projects" back-link in the topbar. The accordion project nav
// only exists inside the chapter/entry editor. So this layout (shared by
// both the Outline route and the entries/[entryId] route) does auth only;
// the nav is scoped to entries/[entryId]/layout.tsx instead.
export default async function SubjectLayout({
  children,
}: {
  children: React.ReactNode;
  params: { subjectId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <>{children}</>;
}
