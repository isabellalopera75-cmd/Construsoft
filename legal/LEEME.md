# Términos y política de datos, por versión

Cada carpeta se llama **exactamente** como el valor de `VERSION_TERMINOS` que
la publica, y contiene un único `legal.html` con los cuatro documentos
(`<article class="legal-doc" id="…">`: privacidad, terminos, cookies,
reembolsos). La API no arranca si la carpeta que nombra la variable no existe
o le falta un documento.

**Una carpeta publicada no se edita nunca.** La Ley 1581 obliga a poder
reconstruir el texto exacto que una persona aceptó, y la base guarda la
versión aceptada. Un texto nuevo es una carpeta nueva con otro nombre.

Las versiones `PROVISIONAL-<fecha>` son borradores sin revisión legal: la API
solo las publica con `TERMINOS_PROVISIONALES=si` y les antepone un aviso a
cada documento.

- `PROVISIONAL-2026-09-25`: el borrador con las correcciones de
  accesibilidad del 25 de septiembre de 2026, copiado de
  `prototipo/legal.html`. Pendiente de revisión por un abogado.
