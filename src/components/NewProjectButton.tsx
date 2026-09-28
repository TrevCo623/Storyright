'use client';

import { useRouter } from 'next/navigation';
import { PlusIcon } from '@/components/icons';

export default function NewProjectButton() {
  const router = useRouter();

  return (
    <button className="picker-new-btn" onClick={() => router.push('/subjects/new')}>
      <PlusIcon /> New Project
    </button>
  );
}
