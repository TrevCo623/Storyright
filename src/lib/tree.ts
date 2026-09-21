import type { Entry } from '@/lib/types';

export interface EntryNode extends Entry {
  children: EntryNode[];
}

// Turns the flat entries list (parent_entry_id-linked) into a nested tree per
// section, for sidebar rendering. Orphaned parent references (shouldn't
// happen given the FK, but defensive) fall back to root level.
export function buildEntryTree(entries: Entry[]): EntryNode[] {
  const map = new Map<string, EntryNode>();
  entries.forEach((e) => map.set(e.id, { ...e, children: [] }));
  const roots: EntryNode[] = [];

  entries.forEach((e) => {
    const node = map.get(e.id)!;
    const parent = e.parent_entry_id ? map.get(e.parent_entry_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const byPosition = (a: EntryNode, b: EntryNode) => a.position - b.position;
  const sortRec = (nodes: EntryNode[]) => {
    nodes.sort(byPosition);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export const SECTION_LABELS: Record<string, string> = {
  chapters: 'Chapters',
  threads: 'Threads',
  research: 'Research & Notes',
};
