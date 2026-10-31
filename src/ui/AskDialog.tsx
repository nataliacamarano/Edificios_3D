import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '../i18n';

/**
 * Cuadros de diálogo propios de la app. Sustituyen a window.prompt, que el programa de escritorio
 * no permite (lanza un error y el botón no hacía nada).
 */
interface Ask {
  message: string;
  /** Texto inicial del campo; sin él es una confirmación (Aceptar / Cancelar). */
  value?: string;
  resolve: (v: string | null) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(message: string, value?: string) {
  current?.resolve(null);
  return new Promise<string | null>((resolve) => {
    current = { message, value, resolve };
    emit();
  });
}

/** Pide un texto; devuelve null si se cancela. */
export const askText = (message: string, value = '') => open(message, value);

/** Pide confirmación. */
export const askConfirm = (message: string) => open(message).then((v) => v !== null);

export function AskDialogHost() {
  const ask = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return ask ? <AskBox key={ask.message + (ask.value ?? '')} ask={ask} /> : null;
}

function AskBox({ ask }: { ask: Ask }) {
  const t = useT();
  const [text, setText] = useState(ask.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  // El texto inicial sale seleccionado: al escribir se sustituye
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const isText = ask.value !== undefined;
  const close = (v: string | null) => {
    current = null;
    emit();
    ask.resolve(v);
  };
  return (
    <div className="ask-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close(null)}>
      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          close(isText ? text : '');
        }}
        onKeyDown={(e) => e.key === 'Escape' && close(null)}
      >
        <p>{ask.message}</p>
        {isText && <input ref={input} value={text} onChange={(e) => setText(e.target.value)} />}
        <div className="ask-actions">
          <button type="button" className="btn" onClick={() => close(null)}>
            {t('dialogCancel')}
          </button>
          <button type="submit" className="btn primary" autoFocus={!isText}>
            {t('dialogOk')}
          </button>
        </div>
      </form>
    </div>
  );
}
