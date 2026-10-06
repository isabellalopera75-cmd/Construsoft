# web/ — la interfaz

Proyecto aparte del backend, a propósito: **esta carpeta y `src/` no comparten
ningún archivo**, porque las escriben dos asistentes distintos y dos autores no
se pisan si no tocan los mismos archivos. La frontera es la API, y está escrita
en `CONTRATO.md`.

La única excepción es el formateador de cifras, que se importa de
`src/comun/formatoNumerico.ts` por un alias de Vite. No se copia: dos
formateadores harían que el mismo número se viera distinto en la pantalla y en
el PDF que recibe el cliente.

## Para correrlo

Hacen falta dos procesos. La API primero, en la raíz del repositorio:

```
npm run api
```

Y la interfaz, acá:

```
cd web
npm install
npm run dev
```

Queda en `http://localhost:5173`. El `/api` lo redirige Vite al 3000, y eso no
es comodidad: la cookie de sesión es `SameSite=Strict`, así que si la interfaz y
la API vivieran en orígenes distintos el navegador no la mandaría nunca y todo
respondería 401. En producción se sirven del mismo origen por la misma razón.

## Reglas de la casa

- **El dinero es texto y nunca pasa por `Number()`.** El tipo ya impide
  multiplicarlo; una regla de lint impide convertirlo.
- **Las cuentas las hace el servidor.** La interfaz no suma dos renglones del
  pie, no calcula una incidencia, no multiplica cantidad por precio.
- **El orden lo manda el servidor.** La numeración de la EDT la calcula la base
  y ordenar por el texto del código es incorrecto: pone el capítulo 10 entre el
  1 y el 2.
- **Ningún color escrito directo en un componente.** Todo sale de los tokens.

## El enlace de restablecimiento

`npm run enlace -- correo` imprime el enlace completo si el `.env` de la raíz
tiene:

```
URL_RECUPERACION=http://localhost:5173/#/recuperar?token=
```

El token va después del «#» a propósito: no sale del navegador.
