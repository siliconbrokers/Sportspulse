import { createRoot } from 'react-dom/client';
import { AppRoot } from './App.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<AppRoot />);
}
