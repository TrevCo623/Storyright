import ThemeToggle from '@/components/ThemeToggle';

export default function SubjectOverviewPage() {
  return (
    <main className="editor-area">
      <header className="topbar">
        <div className="breadcrumb">Overview</div>
        <div className="topbar-right">
          <ThemeToggle />
        </div>
      </header>
      <div className="editor-scroll">
        <div className="editor-column">
          <p className="empty-state">
            Pick an entry from the sidebar, or add a new one with the “+” next to a section, to
            start writing.
          </p>
        </div>
      </div>
    </main>
  );
}
