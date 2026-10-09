/*
 * El panel del superadministrador (CONTRATO §12, 02 §3.5): otra aplicación,
 * con su propia sesión, sobre los mismos estilos que la de las empresas.
 */
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '../estilos/tokens.css';
import '../estilos/base.css';
import '../estilos/componentes.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { restaurarTema } from '../tema.ts';
import { AppDePlataforma } from './App.tsx';

restaurarTema();

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz en superadmin/index.html.');
createRoot(raiz).render(
  <StrictMode>
    <AppDePlataforma />
  </StrictMode>,
);
