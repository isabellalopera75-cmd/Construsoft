/*
 * Las fuentes vienen de npm y viajan dentro de la aplicación: no se le piden a
 * Google en tiempo de ejecución. El porqué está en tokens.css.
 */
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './estilos/tokens.css';
import './estilos/base.css';

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz en index.html.');
createRoot(raiz).render(<App />);
