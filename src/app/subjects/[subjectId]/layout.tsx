import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar/Sidebar';

export default async function SubjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { subjectId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: subject } = await supabase
    .from('subjects')
    .select('*')
    .eq('id', params.subjectId)
    .single();
  if (!subject) notFound();

  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .eq('subject_id', params.subjectId)
    .order('position');

  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: entries } = sectionIds.length
    ? await supabase.from('entries').select('*').in('section_id', sectionIds).order('position')
    : { data: [] };

  return (
    <div className="app">
      <Sidebar
        subjectId={params.subjectId}
        subjectTitle={subject.title}
        sections={sections ?? []}
        entries={entries ?? []}
      />
      {children}
    </div>
  );
}
