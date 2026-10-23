/*
 * Las fuentes vienen de npm y viajan dentro de la aplicación: no se le piden a
 * Google en tiempo de ejecución. El porqué está en tokens.css.
 */
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './estilos/tokens.css';
import './estilos/base.css';
import './estilos/componentes.css';

// «/superadmin» sin la barra final cae aquí, en la aplicación de las empresas,
// y un superadministrador que ingresaba ahí gastaba sus intentos contra el
// ingreso equivocado (bitácora de la API, 11 de octubre de 2026). Se lo lleva
// al panel antes de pintar nada.
if (window.location.pathname.replace(/\/+$/, '') === '/superadmin') {
  window.location.replace(`/superadmin/${window.location.hash}`);
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { restaurarTema } from './tema.ts';
import { restaurarTamanoDeLetra } from './tamanoDeLetra.ts';

// Antes de pintar: si la persona eligió un tema, que no destelle el otro.
restaurarTema();
restaurarTamanoDeLetra();

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz en index.html.');
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
