// The chapter editor no longer has a left nav — project navigation lives in
// the shared top bar (TopNav, rendered by EntryEditor) instead. This layout
// just provides the full-height app frame the editor and notes rail sit in.
export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return <div className="app editor-app">{children}</div>;
}
