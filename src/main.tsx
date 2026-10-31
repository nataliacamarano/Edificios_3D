import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './styles.css';

// App instalable y sin conexión: solo en la versión publicada en un servidor (no en desarrollo
// ni al abrir el archivo único con doble clic, donde los service workers no funcionan).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined);
  });
}

// Acceso al estado desde la consola del navegador, solo en desarrollo.
if (import.meta.env.DEV) (window as unknown as { store: typeof useStore }).store = useStore;

// Sin StrictMode: las etiquetas <Html> de drei crean raíces de React propias y el doble
// montaje de desarrollo provoca avisos de desmontaje concurrente.
createRoot(document.getElementById('root')!).render(<App />);
