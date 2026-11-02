# MangaTrack (fork)

Lector de manga para Kino. Fork de [Susejing/kino-mangatrack](https://github.com/Susejing/kino-mangatrack) con un lector
nuevo. Fuente: LeerCapitulo.

## Qué cambia en esta versión (0.2.0)

- **Tres modos de lectura**, con el botón de la barra superior: vertical continuo (webtoon), página a página de izquierda a
  derecha (cómic) y de derecha a izquierda (manga). El modo se recuerda y se sincroniza entre aparatos.
- **Zoom**: pellizco, doble toque y arrastre en cada página.
- **Sin recortes**: las páginas se ajustan al ancho (`Image.fit: "width"`); se borró la medición de bytes y la escala de cajas.
- **Retoma la página** donde te quedaste en el mismo capítulo, y una pantalla de fin de capítulo con "Siguiente".

## Requisitos

Necesita una Kino con `Image.fit`, `scroll.zoom` y `pages.reverse`/`progress` (rama `feat/reader-sdk` de Kino). En una Kino
anterior el plugin se abre pero las páginas se recortan y no hay zoom.
