import './globals.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoot } from './App.js';
import { SessionProvider } from './auth/SessionProvider.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <BrowserRouter>
      <SessionProvider>
        <AppRoot />
      </SessionProvider>
    </BrowserRouter>,
  );
}
