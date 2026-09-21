import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import NewSubjectCard from '@/components/NewSubjectCard';
import NewProjectButton from '@/components/NewProjectButton';
import ProjectCard from '@/components/ProjectCard';
import ThemeToggle from '@/components/ThemeToggle';

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function SubjectsPage() {
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

  if (profile && !profile.onboarded_at) {
    redirect('/onboarding');
  }

  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('updated_at', { ascending: false });

  return (
    <div className="picker-wrap">
      <div className="picker-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Storyright" className="picker-brand-wordmark" />
        <NewProjectButton />
      </div>

      {subjects && subjects.length > 0 ? (
        <div className="picker-grid">
          {subjects.map((s) => (
            <ProjectCard
              key={s.id}
              id={s.id}
              title={s.title}
              meta={`Edited ${relativeTime(s.updated_at)}`}
              summary={s.premise}
            />
          ))}
          <NewSubjectCard />
        </div>
      ) : (
        <div className="picker-grid">
          <NewSubjectCard />
        </div>
      )}

      <div className="picker-footer-controls">
        <ThemeToggle />
        <form action="/auth/signout" method="post">
          <button type="submit" className="picker-logout-btn">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
