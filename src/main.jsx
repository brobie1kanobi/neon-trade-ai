import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Benign browser notice: charts/animated panels resize themselves during a
// ResizeObserver callback, so the browser defers the rest to the next frame and
// logs this. Nothing is broken and nothing is lost — silence just this one
// message so it stops surfacing as an app error.
const RO_NOISE = 'ResizeObserver loop completed with undelivered notifications';
window.addEventListener('error', (e) => {
  if (typeof e.message === 'string' && e.message.includes(RO_NOISE)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}