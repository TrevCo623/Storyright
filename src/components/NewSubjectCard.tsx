'use client';

import { useRouter } from 'next/navigation';
import DashedOutline from '@/components/DashedOutline';

export default function NewSubjectCard() {
  const router = useRouter();

  return (
    <button className="project-card new-project-card" onClick={() => router.push('/subjects/new')}>
      <DashedOutline />
      <div className="new-project-title">New project</div>
      <div className="new-project-circle">+</div>
    </button>
  );
}
