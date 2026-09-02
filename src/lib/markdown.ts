// Converts a Tiptap/ProseMirror JSON document into Markdown for the
// "Export as Markdown" action. Scoped to the node/mark set StarterKit
// actually enables in the editor (see EntryEditor.tsx's useEditor config —
// headings are turned off, so the writing surface only ever produces
// paragraphs, blockquotes, lists, code blocks, rules, and the bold/italic/
// strike/code marks below).

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PMNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

function renderMarks(text: string, marks?: PMMark[]): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `_${out}_`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      default:
        break;
    }
  }
  return out;
}

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'text') return renderMarks(n.text ?? '', n.marks);
      if (n.type === 'hardBreak') return '  \n';
      return '';
    })
    .join('');
}

function renderListItem(item: PMNode, depth: number, ordered: boolean, index: number): string {
  const indent = '  '.repeat(depth);
  const marker = ordered ? `${index}.` : '-';
  const parts = (item.content ?? []).map((child) =>
    child.type === 'bulletList' || child.type === 'orderedList'
      ? renderBlock(child, depth + 1)
      : renderBlock(child, depth)
  );
  const [first, ...rest] = parts;
  return [`${indent}${marker} ${first ?? ''}`, ...rest].join('\n');
}

function renderBlock(node: PMNode, listDepth = 0): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content);
    case 'blockquote':
      return (node.content ?? [])
        .map((child) => renderBlock(child, listDepth))
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const text = (node.content ?? []).map((n) => n.text ?? '').join('');
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return (node.content ?? []).map((item) => renderListItem(item, listDepth, false, 0)).join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map((item, i) => renderListItem(item, listDepth, true, i + 1))
        .join('\n');
    default:
      return renderInline(node.content);
  }
}

export function docToMarkdown(doc: { content?: PMNode[] }): string {
  const blocks = (doc.content ?? []).map((node) => renderBlock(node));
  return blocks.join('\n\n').trim() + '\n';
}
