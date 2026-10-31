import { Component, useEffect, type ReactNode } from 'react';
import Editor2D from './editor/Editor2D';
import { translate } from './i18n';
import { PlansProvider } from './nav/PlansContext';
import { useStore } from './store';
import Scene from './three/Scene';
import { AskDialogHost } from './ui/AskDialog';
import { Layout, PickBanner } from './ui/Chrome';
import { useProjectAutosave } from './ui/ProjectFile';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    const lang = useStore.getState().ui.lang;
    return (
      <div className="crash">
        <h2>{translate(lang, 'errorTitle')}</h2>
        <pre>{this.state.error.message}</pre>
        <button
          className="btn danger"
          onClick={() => {
            localStorage.removeItem('modelo-planta-3d');
            location.reload();
          }}
        >
          {translate(lang, 'errorReset')}
        </button>
      </div>
    );
  }
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Escape') {
        if (st.ui.pickPersonId) st.setUi({ pickPersonId: null });
        else st.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.ui.view === '2d' && st.ui.selection) {
        const sel = st.ui.selection;
        if (sel.type === 'space') st.deleteSpace(sel.floorId, sel.id);
        else if (sel.type === 'item') st.deleteItem(sel.id);
        else if (sel.type === 'furniture') st.deleteFurniture(sel.floorId, sel.id);
        else st.deleteWall(sel.floorId, sel.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const view = useStore((s) => s.ui.view);
  useShortcuts();
  useProjectAutosave();
  return (
    <ErrorBoundary>
      <PlansProvider>
        <Layout>
          {view === '3d' ? <Scene /> : <Editor2D />}
          <PickBanner />
        </Layout>
        <AskDialogHost />
      </PlansProvider>
    </ErrorBoundary>
  );
}
