'use client';

import { useRouter } from 'next/navigation';

export default function NewProjectButton() {
  const router = useRouter();

  return (
    <button className="picker-new-btn" onClick={() => router.push('/subjects/new')}>
      <span>+</span> New Project
    </button>
  );
}
