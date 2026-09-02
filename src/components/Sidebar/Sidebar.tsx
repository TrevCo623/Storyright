'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildEntryTree, SECTION_LABELS, type EntryNode } from '@/lib/tree';
import type { Entry, Section } from '@/lib/types';
import { createSection, createEntry } from '@/app/subjects/[subjectId]/actions';

interface Props {
  subjectId: string;
  subjectTitle: string;
  sections: Section[];
  entries: Entry[];
}

export default function Sidebar({ subjectId, subjectTitle, sections, entries }: Props) {
  const pathname = usePathname();
  const activeEntryId = pathname?.match(/\/entries\/([^/]+)/)?.[1];
  const [addingSection, setAddingSection] = useState(false);

  const entriesBySection = new Map<string, Entry[]>();
  entries.forEach((e) => {
    const list = entriesBySection.get(e.section_id) ?? [];
    list.push(e);
    entriesBySection.set(e.section_id, list);
  });

  return (
    <aside className="nav">
      <div className="nav-inner">
        <div className="nav-header">
          <Link href="/subjects" className="back-link">
            ‹ All projects
          </Link>
        </div>
        <div className="project-name">{subjectTitle}</div>

        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            subjectId={subjectId}
            section={section}
            tree={buildEntryTree(entriesBySection.get(section.id) ?? [])}
            activeEntryId={activeEntryId}
          />
        ))}

        <div className="nav-spacer" />

        {addingSection ? (
          <form
            action={async (fd) => {
              await createSection(subjectId, fd);
              setAddingSection(false);
            }}
            style={{ marginBottom: 10 }}
          >
            <input
              name="title"
              className="text-input"
              placeholder="Folder name…"
              autoFocus
              style={{ fontSize: 12.5, padding: '6px 8px' }}
              onKeyDown={(e) => e.key === 'Escape' && setAddingSection(false)}
              onBlur={(e) => !e.target.value && setAddingSection(false)}
            />
          </form>
        ) : (
          <button
            className="tree-item"
            style={{ marginBottom: 10 }}
            onClick={() => setAddingSection(true)}
          >
            + New folder
          </button>
        )}

        <div className="nav-footer">
          <Link href="/manifesto">Manifesto</Link>
        </div>
      </div>
    </aside>
  );
}

function SectionBlock({
  subjectId,
  section,
  tree,
  activeEntryId,
}: {
  subjectId: string;
  section: Section;
  tree: EntryNode[];
  activeEntryId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const label = section.type === 'custom' ? section.title : SECTION_LABELS[section.type] ?? section.title;

  return (
    <div>
      <div className="section-row">
        <span className="section-label">{label}</span>
        <button className="add-btn" title={`New ${label.toLowerCase()} entry`} onClick={() => setAdding((v) => !v)}>
          +
        </button>
      </div>

      {adding && (
        <form
          action={async (fd) => {
            const title = String(fd.get('title') || '');
            setAdding(false);
            await createEntry(subjectId, section.id, null, title);
          }}
        >
          <input
            name="title"
            className="text-input"
            placeholder="Untitled…"
            autoFocus
            style={{ fontSize: 12.5, padding: '5px 8px', marginBottom: 4 }}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          />
        </form>
      )}

      {tree.map((node) => (
        <TreeItem
          key={node.id}
          subjectId={subjectId}
          sectionId={section.id}
          node={node}
          depth={0}
          activeEntryId={activeEntryId}
        />
      ))}
    </div>
  );
}

function TreeItem({
  subjectId,
  sectionId,
  node,
  depth,
  activeEntryId,
}: {
  subjectId: string;
  sectionId: string;
  node: EntryNode;
  depth: number;
  activeEntryId?: string;
}) {
  const [addingChild, setAddingChild] = useState(false);
  const [hover, setHover] = useState(false);

  return (
    <div>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        <Link
          href={`/subjects/${subjectId}/entries/${node.id}`}
          className={`tree-item${depth > 0 ? ' nested' : ''}${node.id === activeEntryId ? ' active' : ''}`}
          style={{ flex: 1, paddingLeft: depth > 0 ? 20 + depth * 12 : undefined }}
        >
          {node.title}
        </Link>
        {hover && (
          <button
            className="add-btn"
            title="New nested entry"
            onClick={() => setAddingChild((v) => !v)}
          >
            +
          </button>
        )}
      </div>

      {addingChild && (
        <form
          action={async (fd) => {
            const title = String(fd.get('title') || '');
            setAddingChild(false);
            await createEntry(subjectId, sectionId, node.id, title);
          }}
        >
          <input
            name="title"
            className="text-input"
            placeholder="Untitled…"
            autoFocus
            style={{ fontSize: 12.5, padding: '5px 8px', marginLeft: 20 + depth * 12, marginBottom: 4 }}
            onKeyDown={(e) => e.key === 'Escape' && setAddingChild(false)}
          />
        </form>
      )}

      {node.children.map((child) => (
        <TreeItem
          key={child.id}
          subjectId={subjectId}
          sectionId={sectionId}
          node={child}
          depth={depth + 1}
          activeEntryId={activeEntryId}
        />
      ))}
    </div>
  );
}
