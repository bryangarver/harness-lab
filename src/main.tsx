import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
const Studio = React.lazy(() => import('./studio/Studio'));
import './styles.css';
// Fonts are bundled locally so simulator mode also works without an internet connection.
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={<p style={{ padding: 32 }}>Opening the experiment studio…</p>}>{location.pathname.replace(/\/$/, '') === '/studio' ? <Studio /> : <App />}</React.Suspense></React.StrictMode>);
