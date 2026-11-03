// MangaTrack v0.1.16 — lector de mangas para Kino con pantalla propia.
// Fuente de esta versión: LeerCapitulo (www.leercapitulo.co).
// Requiere Kino 0.9.74 o superior (apiVersion 14, capability "screen").
// Una sola pantalla con rutas (inicio, serie, lector, buscar, catálogo) y un
// adaptador de scraping por fuente: las próximas fuentes se agregan
// como funciones nuevas sin tocar la interfaz.

const VERSION = "0.7.2";
const FUENTE = "LeerCapitulo";
const BASE = "https://www.leercapitulo.co";
const MAX_CAPS = 490;

// ------------------------------------------------------------------ red

async function getHtml(path) {
  const r = await kino.fetch(BASE + path, { headers: { Accept: "text/html" } });
  if (!r.ok) throw kino.error("network", "HTTP " + r.status, {
    userMessage: "No se pudo conectar con " + FUENTE + ". Inténtalo de nuevo.",
  });
  return r.text();
}

function log(msg) {
  try { kino.log("[MangaTrack] " + msg); } catch (e) {}
}

function clean(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ").trim();
}

function absoluta(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("/") === 0) return BASE + u;
  return u;
}

// -------------------------------------------------------------- scraping

// Tarjetas de series: cada enlace /manga/<id>/<slug>/ con una imagen cerca.
// El título sale del alt o title de la imagen o del texto del enlace.
function homeCards(html, max) {
  const out = [];
  const seen = {};
  // Títulos de respaldo: en el catálogo las portadas no traen alt y el
  // texto del enlace es la insignia del tipo ("Manga"); el título de
  // verdad vive en OTRO enlace de texto puro a la misma serie.
  const titulos = {};
  const reT = /<a[^>]+href="([^"]*[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/])"[^>]*>([^<]{2,90})<[/]a>/gi;
  let mt;
  while ((mt = reT.exec(html)) !== null) {
    const u = mt[1].replace(/^https?:[/][/](?:www[.])?leercapitulo[.]co/i, "");
    const t = clean(mt[2]);
    if (t && !/^(manga|manhwa|manhua)$/i.test(t) && !titulos[u]) titulos[u] = t;
  }
  const reA = /<a[^>]+href="([^"]*[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/])"[^>]*>([\s\S]{0,600}?)<[/]a>/gi;
  let m;
  while ((m = reA.exec(html)) !== null) {
    const url = m[1].replace(/^https?:[/][/](?:www[.])?leercapitulo[.]co/i, "");
    if (seen[url]) continue;
    const inner = m[2];
    let poster = "";
    let title = "";
    const im = inner.match(/<img\b[^>]*>/i);
    if (im) {
      const tag = im[0];
      const p = tag.match(/\b(?:data-src|data-lazy-src|src)="([^"]+)"/i);
      if (p) poster = absoluta(p[1]);
      const a = tag.match(/\balt="([^"]*)"/i) || tag.match(/\btitle="([^"]*)"/i);
      // El alt de las portadas dice "Portada de <título>": se quita el
      // prefijo para que la tarjeta muestre solo el título de la serie.
      if (a) title = clean(a[1]).replace(/^portada de\s+/i, "");
    }
    if (!title) {
      const texto = clean(inner.replace(/<[^>]*>/g, " "));
      if (texto && texto.length <= 90) title = texto;
    }
    if (!title) title = url.split("/").filter(Boolean).pop() || url;
    const slug = url.split("/").filter(Boolean).pop() || url;
    if ((title === slug || /^(manga|manhwa|manhua)$/i.test(title)) && titulos[url]) title = titulos[url];
    if (poster && !/logo|banner|icon|avatar|placeholder|ads?[-_/]/i.test(poster)) {
      seen[url] = 1;
      out.push({ url: url, title: title, poster: poster });
    }
    if (out.length >= max) break;
  }
  if (!out.length) {
    const reB = /<img\b[^>]*\b(?:data-src|data-lazy-src|src)="([^"]+)"[^>]*>[\s\S]{0,300}?href="([^"]*[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/])"/gi;
    let mb;
    while ((mb = reB.exec(html)) !== null) {
      const url = mb[2].replace(/^https?:[/][/](?:www[.])?leercapitulo[.]co/i, "");
      if (seen[url]) continue;
      seen[url] = 1;
      out.push({ url: url, title: url.split("/").filter(Boolean).pop() || url, poster: absoluta(mb[1]) });
      if (out.length >= max) break;
    }
  }
  log("portada: " + out.length + " series");
  return out;
}

// Metadatos de la página de una serie (etiquetas og: de WordPress)
// Portada de la serie: en las páginas de LeerCapitulo la portada es una
// imagen /covers/… (con ruta RELATIVA y a veces con ?v= de caché tras la
// extensión) cuyo alt dice "Portada de <título de la serie>", y vive junto
// al título. Antes del título vienen las portadas de la barra lateral
// ("Populares"), cada una con el alt de SU serie. Orden de búsqueda:
// og:image; la imagen cuyo alt calza con el título; la última portada
// antes del <h1>; la primera después; la primera de la página.
function posterDe(html, titulo) {
  const norm = (s) => clean(s).toLowerCase()
    .replace(/[áàäâã]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i")
    .replace(/[óòöôõ]/g, "o").replace(/[úùüû]/g, "u")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const og = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1];
  if (og) return absoluta(og);
  const urlDe = (tag) => {
    const attrs = tag.match(/[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi) || [];
    for (const a of attrs) {
      const v = a.slice(a.indexOf("=") + 1).replace(/^["']|["']$/g, "");
      const u = v.match(/(?:https?:)?(?:\/\/)?[^"'\s]*[/](?:covers|wp-content[/]uploads)[/][^\s"']*[.](?:jpe?g|png|webp)/i);
      if (u) return u[0];
    }
    return "";
  };
  const h1 = html.search(/<h1[^>]*>/i);
  const t = titulo ? norm(titulo).slice(0, 18) : "";
  let porAlt = "", ultimoAntes = "", primeroDespues = "", primeroTodo = "";
  let m;
  const reImg = /<img\b[^>]*>/gi;
  while ((m = reImg.exec(html)) !== null) {
    const url = urlDe(m[0]);
    if (!url) continue;
    if (!primeroTodo) primeroTodo = url;
    if (h1 >= 0 && m.index < h1 && h1 - m.index <= 3000) ultimoAntes = url;
    else if (h1 >= 0 && m.index >= h1 && m.index - h1 <= 8000 && !primeroDespues) primeroDespues = url;
    if (!porAlt && t) {
      const alt = (m[0].match(/\balt\s*=\s*(["'])(.*?)\1/i) || [])[2] || "";
      if (norm(alt.replace(/portada de/i, "")).slice(0, 18) === t) porAlt = url;
    }
  }
  return absoluta(porAlt || ultimoAntes || primeroDespues || primeroTodo || "");
}

function seriesMeta(html) {
  const pick = (re) => { const m = html.match(re); return m ? clean(m[1]) : ""; };
  const titulo = pick(/<h1[^>]*>([\s\S]{1,200}?)<[/]h1>/) ||
    pick(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const poster = posterDe(html, titulo);
  // Descripción: la sinopsis de verdad vive en su propia sección; las
  // metas de la página son solo el respaldo. La sinopsis de algunas series
  // arrastra al final enlaces oficiales de traducción ("--- - [Official
  // … Translation](url)"): se corta ahí y se limpian enlaces y URLs.
  const sm = html.match(/<h[1-6][^>]*>\s*(?:Sinopsis|Synopsis|Descripci[oó]n|Resumen)[^<]{0,40}<[/]h[1-6]>([\s\S]{10,4000}?)<h[1-6]/i);
  const sinopsis = sm ? clean(sm[1]
    .replace(/<[^>]*>/g, " ")
    .split(/\s*[-—–]{3,}\s*/)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")).slice(0, 600) : "";
  const overview = sinopsis ||
    pick(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/content=["']([^"']+)["'][^>]*property=["']og:description["']/i) ||
    pick(/name=["']description["'][^>]*content=["']([^"']+)["']/i);
  // Datos de la ficha (lista «lc-facts»): estado, tipo, autor y última actualización; y las
  // etiquetas de la propia serie (géneros y temáticas), que son las que van antes de esa lista.
  const fact = (k) => {
    const m = html.match(new RegExp('<li><span class="k">' + k + '</span>(?:<a[^>]*>|<span>)([^<]{1,80})'));
    return m ? clean(m[1]) : "";
  };
  const estados = { ongoing: "En emisión", completed: "Finalizado", hiatus: "En pausa", cancelled: "Cancelado" };
  const st = fact("Estado");
  const idx = html.indexOf('class="lc-facts');
  const zona = idx > 0 ? html.slice(Math.max(0, idx - 6000), idx) : "";
  const tags = [];
  const reTag = /<a[^>]*class="[^"]*badge[^"]*"[^>]*href="[/]manga[/][?](?:genre|theme)=[^"]*"[^>]*>([^<]{1,40})<[/]a>/g;
  let mt;
  while ((mt = reTag.exec(zona)) !== null && tags.length < 8) tags.push(clean(mt[1]));
  return { title: titulo, poster: poster, overview: overview,
    status: estados[st.toLowerCase()] || st, type: fact("Tipo"), author: fact("Autor").replace(/\s*\([^)]*\)/g, "").slice(0, 60),
    updated: fact("Actualizado"), tags: tags };
}

// ------------------------------------------------ favoritos (kino.storage)
// La lista vive en el aparato y, con la capacidad "shared" del manifiesto,
// viaja entre los aparatos vinculados: los favoritos marcados en el
// teléfono se ven también en la TV. Los valores que llegan de shared NO
// son de confianza (los escribió otro aparato): se valida cada campo.

function getJson(key, fallback) {
  try {
    const v = (typeof kino.storage === "object" && kino.storage) ? kino.storage.get(key) : null;
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function setJson(key, val) {
  try { kino.storage.set(key, JSON.stringify(val)); } catch (e) { log("storage: " + e); }
}
function favs() { return getJson("favs", []); }
function isFav(url) { return favs().some((f) => f.url === url); }

function favValido(f) {
  return !!f && typeof f === "object" && typeof f.url === "string" &&
    /^[/]manga[/][a-z0-9]{4,}[/]/i.test(f.url);
}

function syncPushFavs() {
  try { if (typeof kino.shared === "object" && kino.shared) kino.shared.set("favs", favs()); }
  catch (e) { log("sync: " + e); }
}
function syncPullFavs() {
  let sf = null;
  try { if (typeof kino.shared === "object" && kino.shared) sf = kino.shared.get("favs"); }
  catch (e) { log("sync: " + e); }
  if (!Array.isArray(sf)) return;
  const local = favs();
  const have = new Set(local.map((f) => f.url));
  let changed = false;
  for (const f of sf.slice(0, 200)) {
    if (!favValido(f) || have.has(f.url)) continue;
    local.push({ url: f.url, title: String(f.title || "").slice(0, 200),
      poster: typeof f.poster === "string" ? f.poster.slice(0, 500) : "" });
    have.add(f.url);
    changed = true;
  }
  if (local.length > 100) local.length = 100;
  if (changed) { setJson("favs", local); syncPushFavs(); }
}

// Historial de lectura: el último capítulo abierto de cada serie,
// guardado en el aparato y sincronizado entre los vinculados (como
// los favoritos). Con él la portada muestra "Seguir leyendo", el
// detalle marca con ✓ los capítulos leídos y el botón "Continuar"
// vuelve al capítulo donde quedó la persona.
function hist() { return getJson("hist", {}); }

function histValido(v) {
  return !!v && typeof v === "object" && typeof v.url === "string" &&
    /^[/]leer[/][a-z0-9]{4,}[/][a-z0-9-]+[/][0-9]+(?:[.][0-9]+)?[/]$/i.test(v.url);
}

function syncPushHist() {
  try { if (typeof kino.shared === "object" && kino.shared) kino.shared.set("hist", hist()); }
  catch (e) { log("sync hist: " + e); }
}
function syncPullHist() {
  let sh = null;
  try { if (typeof kino.shared === "object" && kino.shared) sh = kino.shared.get("hist"); }
  catch (e) { log("sync hist: " + e); }
  if (!sh || typeof sh !== "object") return;
  const local = hist();
  let changed = false;
  const sk = Object.keys(sh).slice(0, 200);
  for (let i = 0; i < sk.length; i++) {
    const k = sk[i];
    if (!/^[/]manga[/][a-z0-9]{4,}[/]/i.test(k)) continue;
    const v = sh[k];
    if (!histValido(v) || typeof v.idx !== "number" || !(v.idx >= 0)) continue;
    const l = local[k];
    if (l && (l.ts || 0) >= (v.ts || 0)) continue;
    local[k] = { url: v.url, num: String(v.num || "").slice(0, 12), idx: v.idx, ts: v.ts || 0,
      page: typeof v.page === "number" && v.page >= 0 && v.page < 1000 ? Math.floor(v.page) : 0,
      pos: typeof v.pos === "number" && v.pos >= 0 && v.pos <= 1 ? v.pos : 0,
      title: String(v.title || "").slice(0, 200),
      poster: typeof v.poster === "string" ? v.poster.slice(0, 500) : "" };
    changed = true;
  }
  const lk = Object.keys(local);
  if (lk.length > 100) { lk.sort((a, b) => (local[b].ts || 0) - (local[a].ts || 0));
    for (let i = 100; i < lk.length; i++) delete local[lk[i]]; }
  if (changed) { setJson("hist", local); syncPushHist(); }
}

// Capítulos de una serie: enlaces /leer/<id>/<slug>/<número>/
function chapterList(html) {
  const map = new Map();
  const re = /href="([^"]*[/]leer[/][a-z0-9]{4,}[/][a-z0-9-]+[/]([0-9]+(?:[.][0-9]+)?)[/])"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!map.has(m[2])) map.set(m[2], { url: m[1], num: m[2] });
  }
  const arr = [...map.values()];
  arr.sort((a, b) => parseFloat(b.num) - parseFloat(a.num));
  if (arr.length) log("capítulos: " + arr.length + " (ej. " + arr[0].url + ")");
  return arr;
}

// Imágenes de un capítulo: varios métodos con registro de cada intento.
function readerImages(html) {
  let imgs = [];
  const mj = html.match(/ts_reader[.]run[(]([\s\S]*?)[)];/);
  if (mj) {
    try {
      const j = JSON.parse(mj[1]);
      const src = j.sources && j.sources[0] && j.sources[0].images;
      if (Array.isArray(src)) {
        imgs = src.filter((x) => typeof x === "string" && x);
        log("lector: ts_reader dio " + imgs.length + " páginas");
      }
    } catch (e) { log("lector: ts_reader JSON roto"); }
  }
  if (!imgs.length) {
    const rc = html.match(/class="[^"]*(?:reading-content|read-container|entry-content|chap-content)[^"]*"/i);
    imgs = imgsDe(rc ? rc[0] : html);
    log("lector: etiquetas img (" + (rc ? "zona de lectura" : "página completa") + ") dieron " + imgs.length + " páginas");
  }
  return imgs;
}

function imgsDe(zona) {
  const out = [];
  const seen = {};
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(zona)) !== null) {
    const tag = m[0];
    const p = tag.match(/\bdata-src="([^"]+)"/i) || tag.match(/\bdata-lazy-src="([^"]+)"/i) || tag.match(/\bsrc="([^"]+)"/i);
    if (!p) continue;
    const src = absoluta(p[1]);
    if (!src || src.indexOf("data:") === 0) continue;
    if (!/[.](jpe?g|png|webp|gif)([?]|#|$)/i.test(src)) continue;
    if (/logo|banner|icon|avatar|placeholder|ads?[-_/]|loader|spinner/i.test(src)) continue;
    if (seen[src]) continue;
    seen[src] = 1;
    const w = parseInt((tag.match(/\bwidth="(\d+)"/) || [])[1] || "0", 10);
    const h = parseInt((tag.match(/\bheight="(\d+)"/) || [])[1] || "0", 10);
    out.push(w > 0 && h > 0 ? { url: src, w: w, h: h } : { url: src });
  }
  return out;
}

// ------------------------------------------------------------- interfaz

function loadingTree(msg) {
  return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
    { type: "CircularProgressIndicator" },
    { type: "Text", text: msg || "Cargando…", textEn: "Loading…", color: "muted" },
  ] };
}

function errorTree(msg) {
  return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
    { type: "Icon", name: "error", color: "muted" },
    { type: "Text", text: msg || "No se pudo cargar.", textEn: "Could not load.", color: "muted" },
    { type: "ElevatedButton", icon: "refresh", labelText: "Reintentar", labelTextEn: "Retry",
      onPressed: { event: "retry" } },
  ] };
}

function serieKey(prefix, url) {
  return prefix + String(url).replace(/[^a-z0-9]/gi, "").slice(-40);
}

function posterCard(it, prefix, rail) {
  const img = {
    type: "Image", url: it.poster || "", aspect: "2:3",
    alt: it.title, altEn: it.title,
    fallback: { type: "Column", padding: 16, crossAxisAlignment: "center",
      children: [{ type: "Icon", name: "list", color: "muted" }] },
  };
  if (rail) img.width = 120;
  // Tarjeta tonal con esquinas redondeadas (la portada va recortada a ellas); el título ocupa siempre
  // dos líneas de alto, así las tarjetas de una fila quedan iguales.
  const card = {
    type: "Card", key: serieKey(prefix, it.url), flush: true, variant: "filled", radius: "medium",
    onTap: { event: "openSeries", arg: it.url },
    children: [img, { type: "Text", text: String(it.title || ""), textEn: String(it.title || ""),
      style: "label", maxLines: 2, padding: 8, minH: 48 }],
  };
  if (rail) card.width = 120;
  return card;
}
function gridOf(items, vacio) {
  if (!items || !items.length) return vacio;
  return {
    type: "ListView", key: "grid", gap: 12, padding: 12,
    columns: { compact: 3, medium: 4, expanded: 6 },
    items: items.map((it) => posterCard(it, "c-")),
  };
}

const VACIO_SERIES = { type: "emptyState", icon: "list",
  title: "No se encontraron series.", titleEn: "No series found." };
const VACIO_BUSQUEDA = { type: "emptyState", icon: "search",
  title: "Sin resultados.", titleEn: "No results." };

function railOf(titulo, tituloEn, items, key, prefix) {
  if (!items || !items.length) return [];
  return [
    { type: "Text", text: titulo, textEn: tituloEn, style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: key, direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8,
        children: items.slice(0, 15).map((it) => posterCard(it, prefix, true)) }] },
  ];
}

function fuenteCard(nombre, nota, activa) {
  return { type: "Card", key: "fuente-" + nombre.replace(/[^a-z0-9]/gi, ""), flush: true,
    onTap: { event: activa ? "fuenteActual" : "fuentePronto", arg: nombre },
    children: [
      { type: "Text", text: nombre, textEn: nombre, style: "h3", padding: 16 },
      { type: "Text", text: nota, textEn: nota, style: "caption", color: "muted", padding: 16 },
    ] };
}

// ---- Carrusel de tendencias (PageView con viewportFraction < 1): una tarjeta por título, la siguiente asoma a
// un lado y pasa sola cada 5 s. Seis páginas (el límite es 24, pero cada una gasta nodos de los 600 de la pantalla).
const CARRUSEL_PAGINAS = 6;

function paginaCarrusel(it, i) {
  const portada = { type: "Card", flush: true, radius: "medium", elevation: 6, children: [
    { type: "Image", url: it.poster || "", width: 120, aspect: "2:3", alt: it.title, altEn: it.title,
      fallback: { type: "Icon", name: "list", color: "muted" } } ] };
  return { type: "Card", key: "car-" + i, variant: "filled", radius: "large", margin: 8,
    onTap: { event: "openSeries", arg: it.url },
    children: [{ type: "Row", gap: 16, padding: 16, crossAxisAlignment: "center", children: [
      portada,
      { type: "Column", gap: 8, flex: 1, crossAxisAlignment: "start", children: [
        { type: "Badge", text: "#" + (i + 1) + " en tendencias", color: "primary" },
        { type: "Text", text: String(it.title || ""), textEn: String(it.title || ""), style: "h3", maxLines: 3 },
        { type: "ElevatedButton", key: "carv-" + i, icon: "play", radius: "full",
          labelText: "Ver serie", labelTextEn: "See series", onPressed: { event: "openSeries", arg: it.url } },
      ] },
    ] }] };
}

function carruselHome(items) {
  const lista = (items || []).filter((x) => x && x.url && x.title && x.poster).slice(0, CARRUSEL_PAGINAS);
  if (lista.length < 2) return [];
  return [
    { type: "Text", text: "Tendencias", textEn: "Trending", style: "h3", padding: 16 },
    { type: "PageView", key: "carrusel", viewportFraction: { compact: 0.9, medium: 0.6, expanded: 0.42 },
      padEnds: false, autoPlayMs: 5000, children: lista.map(paginaCarrusel) },
  ];
}

// ---- Filas de categorías del Home: se piden en paralelo al abrir, se guardan 6 h y mientras
// llegan se enseñan esqueletos. Cada fila trae «Ver todo», que abre el catálogo ya filtrado.
const HOME_FILAS = [
  { key: "accion", es: "Acción", en: "Action", q: { genre: "action" } },
  { key: "romance", es: "Romance", en: "Romance", q: { genre: "romance" } },
  { key: "comedia", es: "Comedia", en: "Comedy", q: { genre: "comedy" } },
  { key: "fantasia", es: "Fantasía", en: "Fantasy", q: { genre: "fantasy" } },
  { key: "aventura", es: "Aventura", en: "Adventure", q: { genre: "adventure" } },
  { key: "isekai", es: "Isekai", en: "Isekai", q: { genre: "isekai" } },
  { key: "manhwa", es: "Manhwa", en: "Manhwa", q: { type: "manhwa" } },
  { key: "finalizados", es: "Finalizados", en: "Completed", q: { status: "completed" } },
];
const FILAS_TTL = 6 * 3600 * 1000;
const FILA_CARTAS = 6;

function filasCache() {
  const c = getJson("filas", null);
  return c && typeof c === "object" && c.rows && typeof c.rows === "object" ? c : { ts: 0, rows: {} };
}

// Pide las filas que faltan (todas si la caché caducó); true si algo cambió.
async function cargarFilasHome() {
  const c = filasCache();
  const fresco = Date.now() - (c.ts || 0) < FILAS_TTL;
  const faltan = HOME_FILAS.filter((f) => !fresco || !Array.isArray(c.rows[f.key]) || !c.rows[f.key].length);
  if (!faltan.length) return false;
  setJson("filasTry", Date.now());
  const res = await Promise.all(faltan.map(async (f) => {
    try { return [f.key, homeCards(await getHtml(catalogoUrl(f.q, 1)), FILA_CARTAS)]; }
    catch (e) { log("fila " + f.key + ": " + ((e && e.message) || e)); return [f.key, null]; }
  }));
  let cambio = false;
  for (const par of res) {
    if (par[1] && par[1].length) { c.rows[par[0]] = par[1]; cambio = true; }
  }
  if (cambio) { c.ts = Date.now(); setJson("filas", c); }
  setJson("filasTry", Date.now());
  return cambio;
}

// ¿Faltan filas por cargar y no se ha intentado hace poco? (el temporizador del Home no depende del evento open)
function filasPendientes() {
  const c = filasCache();
  const intento = getJson("filasTry", 0) || 0;
  if (intento && Date.now() - intento < 60000) return false;
  return HOME_FILAS.some((f) => !Array.isArray(c.rows[f.key]) || !c.rows[f.key].length) ||
    Date.now() - (c.ts || 0) >= FILAS_TTL;
}

function filaHeader(f) {
  return { type: "Row", padding: 16, crossAxisAlignment: "center", children: [
    { type: "Text", text: f.es, textEn: f.en, style: "h3", flex: 1 },
    { type: "TextButton", key: "ver-" + f.key, labelText: "Ver todo", labelTextEn: "See all",
      onPressed: { event: "verFila", arg: f.key } },
  ] };
}

function filaRail(f, items) {
  return [
    filaHeader(f),
    { type: "SingleChildScrollView", key: "rail-" + f.key, direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8,
        children: items.slice(0, FILA_CARTAS).map((it) => posterCard(it, "g" + f.key + "-", true)) }] },
  ];
}

function filaEsqueleto(f) {
  const celda = (i) => ({ type: "Column", key: "sk-" + f.key + i, gap: 8, children: [
    { type: "Skeleton", shape: "block", width: 120, height: 200 },
    { type: "Skeleton", shape: "line", width: 96 },
  ] });
  return [
    { type: "Text", text: f.es, textEn: f.en, style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: "rail-" + f.key, direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8, children: [0, 1, 2, 3].map(celda) }] },
  ];
}

// Las filas de categoría del Home: las de la caché, y un esqueleto en las que aún no han llegado.
function filasHome() {
  const c = filasCache();
  const intentando = Date.now() - (getJson("filasTry", 0) || 0) < 20000 || !getJson("filasTry", 0);
  let out = [];
  for (const f of HOME_FILAS) {
    const items = c.rows[f.key];
    if (Array.isArray(items) && items.length) out = out.concat(filaRail(f, items));
    else if (intentando) out = out.concat(filaEsqueleto(f));
  }
  return out;
}

async function homeTree() {
  const html = await getHtml("/");
  // La portada del sitio trae tres secciones (Tendencias, Populares,
  // Ultimos mangas): se reparte el HTML por sus encabezados y cada rail
  // se llena con la suya. Si el sitio cambia y no aparecen, se vuelve a
  // la cuadrícula mixta de siempre.
  const posT = html.search(/tendencias/i);
  const posP = html.search(/populares/i);
  const posU = html.search(/ultimos\s+mangas/i);
  let populares = [];
  let recientes = [];
  let mixtas = [];
  let tendencias = [];
  if (posT >= 0 && posP > posT && posU > posP) {
    populares = homeCards(html.slice(posP, posU), 10)
      .concat(homeCards(html.slice(posT, posP), 24)).slice(0, 15);
    recientes = homeCards(html.slice(posU), 24).slice(0, 15);
    tendencias = homeCards(html.slice(posT, posP), 24);
    const vp = {};
    populares = populares.filter((x) => (!vp[x.url] && (vp[x.url] = 1)));
    const vr = {};
    recientes = recientes.filter((x) => (!vr[x.url] && (vr[x.url] = 1)));
  } else {
    mixtas = homeCards(html, 40);
  }
  if (!populares.length && !recientes.length && !mixtas.length) mixtas = homeCards(html, 40);
  if (!tendencias.length) tendencias = (populares.length ? populares : mixtas).slice();
  const mf = favs();
  const railFavs = mf.length ? [
    { type: "Text", text: "Mis favoritos", textEn: "My favourites", style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: "railFavs", direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8,
        children: mf.slice(0, 12).map((it) => posterCard(it, "f-", true)) }] },
  ] : [];
  const hh = hist();
  const hItems = Object.keys(hh).map((k) => ({ url: k, title: hh[k].title || "",
      poster: hh[k].poster || "", ts: hh[k].ts || 0 }))
    .filter((x) => x.title).sort((a, b) => b.ts - a.ts).slice(0, 8);
  const railHist = hItems.length ? [
    { type: "Text", text: "Seguir leyendo", textEn: "Keep reading", style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: "railHist", direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8,
        children: hItems.map((it) => posterCard(it, "h-", true)) }] },
  ] : [];
  const fuentes = [
    { type: "Text", text: "Fuentes", textEn: "Sources", style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: "railFuentes", direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8, children: [
        fuenteCard(FUENTE, "Activa", true),
        fuenteCard("MangaOni", "Pronto", false),
        fuenteCard("Mangas.in", "Pronto", false),
      ] }] },
  ];
  const gridSeries = mixtas.length ? [
    { type: "Text", text: "Series de " + FUENTE, textEn: FUENTE + " series",
      style: "h3", padding: 16 },
    gridOf(mixtas, VACIO_SERIES),
  ] : [];
  const catalogo = [
    { type: "Card", key: "catEntry", flush: true, onTap: { event: "openCatalog" },
      children: [
        { type: "Text", text: "Catálogo completo · " + FUENTE, textEn: "Full catalog · " + FUENTE,
          style: "h3", padding: 16 },
        { type: "Text", text: "Explora por género, tipo y estado",
          textEn: "Browse by genre, type and status", style: "caption", color: "muted", padding: 16 },
      ] },
  ];
  if (!populares.length && !recientes.length && !mixtas.length) return VACIO_SERIES;
  // El último capítulo abierto, a lo grande, con «Continuar» (abre el lector donde se quedó) y «Ver serie».
  const ult = hItems.length ? hItems[0] : null;
  const hu = ult ? hh[ult.url] : null;
  const hero = ult && hu ? [{
    type: "heroCard", key: "heroUltimo", title: ult.title, titleEn: ult.title,
    text: "Capítulo " + hu.num + (hu.page > 0 ? " · pág. " + (hu.page + 1) : ""),
    textEn: "Chapter " + hu.num + (hu.page > 0 ? " · p. " + (hu.page + 1) : ""),
    image: ult.poster || undefined,
    buttons: [
      { type: "ElevatedButton", key: "heroContinuar", icon: "play", labelText: "Continuar", labelTextEn: "Continue",
        onPressed: { event: "continuarUltimo", arg: ult.url } },
      { type: "TextButton", key: "heroSerie", labelText: "Ver serie", labelTextEn: "See series",
        onPressed: { event: "openSeries", arg: ult.url } },
    ],
  }] : [];
  return { type: "SingleChildScrollView", key: "home", children: []
    .concat(hero)
    .concat(carruselHome(tendencias))
    .concat(railHist)
    .concat(railFavs)
    .concat(railOf("Populares en español", "Popular in Spanish", populares, "railPop", "p-"))
    .concat(railOf("Actualizados recientes", "Recently updated", recientes, "railRec", "r-"))
    .concat(filasHome())
    .concat(gridSeries)
    .concat(catalogo)
    .concat(fuentes) };
}

function plural(n, uno, varios) { return n + " " + (n === 1 ? uno : varios); }

// Orden de la lista de capítulos: los más recientes primero (lo habitual en un lector).
function orden() { return getJson("ord", "desc") === "asc" ? "asc" : "desc"; }

function detailTree(state) {
  const d = state.detail;
  if (!d) return loadingTree("Cargando serie…");
  const meta = d.meta || {};
  const chapters = Array.isArray(d.chapters) ? d.chapters : [];
  const hInfo = hist()[d.url];
  const hIdx = hInfo && hInfo.idx >= 0 && hInfo.idx < chapters.length ? hInfo.idx : -1;
  if (!chapters.length) {
    return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "error", color: "muted" },
      { type: "Text", text: "No se encontraron capítulos para esta serie.",
        textEn: "No chapters found for this series.", color: "muted" },
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Volver", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
    ] };
  }
  const fav = isFav(d.url);
  const asc = orden() === "asc";

  // Portada pequeña al lado de los datos (en una fila, también en el teléfono).
  const cover = meta.poster
    ? { type: "Card", variant: "plain", flush: true, elevation: 6, radius: "medium", children: [
        { type: "Image", url: meta.poster, width: { compact: 96, medium: 120, expanded: 160 },
          aspect: "2:3", alt: meta.title, fallback: { type: "Icon", name: "list" } } ] }
    : { type: "Icon", name: "list" };
  const quien = [meta.type, meta.status].filter(Boolean).join(" · ");
  const total = meta.totalCaps > chapters.length ? meta.totalCaps : chapters.length;
  const datos = [
    { type: "Text", text: meta.title || d.url, style: "h2", maxLines: 3 },
    quien ? { type: "Text", text: quien, style: "label", color: "muted" } : null,
    meta.author ? { type: "Text", text: meta.author, style: "caption", color: "muted", maxLines: 1 } : null,
    { type: "Text", text: plural(total, "capítulo", "capítulos") + (meta.updated ? " · act. " + meta.updated : ""),
      textEn: plural(total, "chapter", "chapters") + (meta.updated ? " · upd. " + meta.updated : ""),
      style: "caption", color: "muted" },
  ].filter(Boolean);

  const etiquetas = (meta.tags || []).slice(0, 6).map((t) => ({ type: "Badge", text: String(t).slice(0, 14), color: "secondary" }));

  const principal = hIdx >= 0
    ? { type: "ElevatedButton", key: "continuar", icon: "play", flex: 1, radius: "full",
        labelText: "Continuar · cap. " + chapters[hIdx].num, labelTextEn: "Continue · ch. " + chapters[hIdx].num,
        onPressed: { event: "read", arg: String(hIdx) } }
    : { type: "ElevatedButton", key: "start", icon: "play", flex: 1, radius: "full",
        labelText: "Empezar a leer", labelTextEn: "Start reading",
        onPressed: { event: "read", arg: "0" } };
  const acciones = { type: "Row", gap: 8, crossAxisAlignment: "center", children: [
    principal,
    { type: "IconButton", key: "fav", icon: fav ? "heart" : "star",
      labelText: fav ? "Quitar de favoritos" : "Añadir a favoritos",
      labelTextEn: fav ? "Remove favourite" : "Add favourite", onPressed: "fav" },
  ] };
  const ultimo = chapters.length > 1
    ? { type: "TextButton", key: "latest", icon: "expand_more",
        labelText: "Leer el último (cap. " + chapters[chapters.length - 1].num + ")",
        labelTextEn: "Read the latest (ch. " + chapters[chapters.length - 1].num + ")",
        onPressed: { event: "read", arg: String(chapters.length - 1) } }
    : null;

  // Sinopsis recortada a 4 líneas con «Ver más» (si es larga).
  const sinopsis = meta.overview ? String(meta.overview).slice(0, 1500) : "";
  const abierta = state.descOpen === true;
  const sinopsisNodes = sinopsis ? [
    { type: "Text", text: sinopsis, style: "p", color: "muted", maxLines: abierta ? undefined : 4 },
    sinopsis.length > 220
      ? { type: "TextButton", key: "verMas", labelText: abierta ? "Ver menos" : "Ver más",
          labelTextEn: abierta ? "Show less" : "Show more", onPressed: "toggleDesc" }
      : null,
  ].filter(Boolean) : [];

  const panel = { type: "Column", gap: 12, children: [
    { type: "Row", gap: 16, crossAxisAlignment: "start", children: [
      cover,
      { type: "Column", gap: 4, flex: 1, crossAxisAlignment: "start", children: datos },
    ] },
    etiquetas.length ? { type: "Row", gap: 4, wrap: true, children: etiquetas } : null,
    acciones,
    ultimo,
  ].concat(sinopsisNodes).filter(Boolean) };
  // Todo el encabezado en una tarjeta con relleno, con margen y esquinas grandes.
  const head = { type: "Card", variant: "filled", radius: "large", margin: 16, children: [panel] };

  // Cabecera de la lista: contador y orden. Un ListTile por capítulo (1 nodo cada uno): con series
  // largas, dos nodos por capítulo superaban los 600 que Kino admite por pantalla.
  const totalTxt = meta.totalCaps > chapters.length
    ? plural(chapters.length, "capítulo", "capítulos") + " (de " + meta.totalCaps + ": los más recientes)"
    : plural(chapters.length, "capítulo", "capítulos");
  const items = [
    head,
    { type: "Row", gap: 8, padding: 16, crossAxisAlignment: "center", children: [
      { type: "Text", text: totalTxt, textEn: plural(chapters.length, "chapter", "chapters"), style: "h3", flex: 1 },
      { type: "TextButton", key: "orden", icon: "filter_list",
        labelText: asc ? "Más antiguos primero" : "Más recientes primero",
        labelTextEn: asc ? "Oldest first" : "Newest first", onPressed: "toggleOrden" },
    ] },
  ];
  const ids = chapters.map((c, i) => i);
  if (!asc) ids.reverse();
  for (const i of ids) {
    const leido = hIdx >= 0 && i < hIdx;
    const actual = i === hIdx;
    const row = {
      type: "ListTile", key: "cap" + i, dense: true,
      title: (leido ? "✓ " : "") + "Capítulo " + chapters[i].num,
      titleEn: (leido ? "✓ " : "") + "Chapter " + chapters[i].num,
      onTap: { event: "read", arg: String(i) },
    };
    if (actual) {
      row.subtitle = hInfo && hInfo.page > 0 ? "Donde te quedaste · pág. " + (hInfo.page + 1) : "Donde te quedaste";
      row.subtitleEn = hInfo && hInfo.page > 0 ? "Where you left off · p. " + (hInfo.page + 1) : "Where you left off";
    }
    items.push(row);
  }
  return {
    type: "Scaffold",
    appBar: { type: "AppBar", key: "barDetail", mergeWithKinoBar: true, dense: true, title: String(meta.title || "Serie").slice(0, 30),
      leading: { type: "IconButton", key: "backFromDetail", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "popBack" } },
      actions: [] },
    body: { type: "ListView", key: "detailBody", items: items },
  };
}

// ------------------------------------------------------------- lector
// Tres modos: vertical continuo (webtoon), página a página de izquierda a
// derecha (cómic) y de derecha a izquierda (manga). Las imágenes usan
// fit:"width" (Kino les da la altura de su proporción real: ya no se miden
// ni se recortan) y cada página va en un scroll con zoom (pellizco, doble
// toque y arrastre). Requiere la Kino con Image.fit, scroll.zoom y
// pages.reverse/progress.

const MODOS = ["vertical", "ltr", "rtl"];
const MODO_INFO = {
  vertical: { icon: "tune", es: "Vertical continuo", en: "Continuous vertical" },
  ltr: { icon: "tune", es: "Página a página →", en: "Page by page →" },
  rtl: { icon: "tune", es: "Página a página ← (manga)", en: "Page by page ← (manga)" },
};

function cfg() {
  const c = getJson("cfg", {});
  return { mode: c && MODOS.indexOf(c.mode) >= 0 ? c.mode : "vertical" };
}
function setCfg(c) {
  setJson("cfg", c);
  try { if (typeof kino.shared === "object" && kino.shared) kino.shared.set("cfg", c); }
  catch (e) { log("sync cfg: " + e); }
}
function syncPullCfg() {
  let sc = null;
  try { if (typeof kino.shared === "object" && kino.shared) sc = kino.shared.get("cfg"); }
  catch (e) { log("sync cfg: " + e); }
  if (sc && typeof sc === "object" && MODOS.indexOf(sc.mode) >= 0 && !getJson("cfg", null)) {
    setJson("cfg", { mode: sc.mode });
  }
}

function paginaImagen(url, i) {
  return {
    type: "Image", key: "p" + i, url: url, fit: "width", aspect: "2:3",
    alt: "Página " + (i + 1), altEn: "Page " + (i + 1),
    fallback: { type: "Column", padding: 16, children: [
      { type: "Text", text: "Página " + (i + 1), textEn: "Page " + (i + 1), color: "muted" } ] },
  };
}

// Lo que se ve al terminar el capítulo: seguir con el siguiente o volver.
function finCapitulo(ch, hasNext) {
  const kids = [
    { type: "Icon", name: "check", color: "muted" },
    { type: "Text", text: "Fin del capítulo " + (ch ? ch.num : ""),
      textEn: "End of chapter " + (ch ? ch.num : ""), style: "h3" },
  ];
  if (hasNext) kids.push({ type: "ElevatedButton", icon: "arrow_forward", key: "finNext",
    labelText: "Capítulo siguiente", labelTextEn: "Next chapter", onPressed: "nextChap" });
  else kids.push({ type: "Text", text: "Estás al día con esta serie.", textEn: "You are up to date.", color: "muted" });
  kids.push({ type: "TextButton", key: "finBack", labelText: "Volver a la serie", labelTextEn: "Back to the series",
    onPressed: { event: "popBack" } });
  return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: kids };
}

function readerTree(state) {
  const r = state.reader;
  if (!r || !Array.isArray(r.images) || !r.images.length) {
    return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "error", color: "muted" },
      { type: "Text", text: "Este capítulo no tiene páginas cargadas.",
        textEn: "This chapter has no pages loaded.", color: "muted" },
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Volver", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
    ] };
  }
  const d = state.detail;
  const chapters = (d && Array.isArray(d.chapters)) ? d.chapters : [];
  const idx = r.idx || 0;
  const ch = chapters[idx];
  const hasNext = idx + 1 < chapters.length;
  const hasPrev = idx > 0;
  const chKey = ch ? String(ch.num).replace(/[^a-z0-9]/gi, "") : String(idx);
  const modo = r.images.length < 2 ? "vertical" : cfg().mode;
  const tk = idx + "-" + chKey + "-" + (r.tk || 0) + "-" + modo;
  const imgs = r.images.slice(0, 249);
  const info = MODO_INFO[modo];

  let lector;
  if (modo === "vertical") {
    lector = { type: "SingleChildScrollView", key: "pages-" + tk, flex: 1, zoom: true, onScroll: "scrolled", children: [
      { type: "Column", gap: 0, crossAxisAlignment: "center", children:
        imgs.map((p, i) => paginaImagen(p.url, i)).concat([finCapitulo(ch, hasNext)]) } ] };
  } else {
    const paginas = imgs.map((p, i) => ({
      type: "SingleChildScrollView", key: "z" + i + "-" + tk, zoom: true,
      children: [{ type: "Column", crossAxisAlignment: "center", children: [paginaImagen(p.url, i)] }],
    }));
    paginas.push({ type: "Column", key: "fin-" + tk, mainAxisAlignment: "center", children: [finCapitulo(ch, hasNext)] });
    lector = { type: "pages", key: "pgs", flex: 1, reverse: modo === "rtl", progress: "bar",
      children: paginas, onPageChanged: "pageChanged" };
  }

  // Los botones van en una fila y el selector de capítulo en su propia línea, a todo el ancho:
  // junto a ellos, en un teléfono, se quedaba sin sitio y solo asomaba "..".
  const barra = { type: "Column", key: "barraLector", gap: 8, padding: 16, children: [
    { type: "Row", gap: 12, mainAxisAlignment: "center", children: [
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Anterior", labelTextEn: "Previous",
        onPressed: "prevChap", enabled: hasPrev },
      { type: "ElevatedButton", labelText: hasNext ? "Siguiente" : "Último capítulo",
        labelTextEn: hasNext ? "Next" : "Last chapter",
        icon: "arrow_forward", onPressed: "nextChap", enabled: hasNext },
    ] },
    { type: "DropdownButton", key: "jumpChap", labelText: "Ir a capítulo", labelTextEn: "Go to chapter",
      value: String(idx), onChanged: "jumpChap",
      options: chapters.length ? chapters.map((c, i) => ({ value: String(i), label: "Capítulo " + c.num })) : [{ value: "0", label: "—" }] },
  ] };

  return {
    type: "Scaffold",
    appBar: { type: "AppBar", key: "barReader", mergeWithKinoBar: true, dense: true, title: ch ? "Capítulo " + ch.num : "Leyendo",
      titleEn: ch ? "Chapter " + ch.num : "Reading",
      leading: { type: "IconButton", key: "backFromReader", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "popBack" } },
      actions: [
        { type: "IconButton", key: "modoLector", icon: info.icon,
          labelText: "Modo de lectura: " + info.es, labelTextEn: "Reading mode: " + info.en,
          onPressed: "cycleMode" },
        { type: "IconButton", key: "verBarra", icon: "visibility",
          labelText: "Ocultar o mostrar controles", labelTextEn: "Hide or show controls",
          onPressed: { ui: [{ toggle: "barraLector" }] } },
      ] },
    body: { type: "Column", children: [lector, barra] },
  };
}

// Cuadrícula de esqueletos con la forma de los resultados: se enseña al momento al buscar (una operación
// local de Kino, sin llamar al plugin) y se oculta cuando llegan los resultados.
function esqueletosBusqueda(key) {
  const celda = (i) => ({ type: "Column", key: "sk" + i, gap: 8, children: [
    { type: "Skeleton", shape: "block", height: 200 },
    { type: "Skeleton", shape: "line", lines: 2 },
  ] });
  return { type: "Column", key: key || "buscando", hidden: true, padding: 12, children: [
    { type: "GridView", columns: { compact: 3, medium: 4, expanded: 6 }, gap: 12,
      children: [0, 1, 2, 3, 4, 5].map(celda) },
  ] };
}

// Las operaciones locales de un filtro o de «Cargar más»: esqueleto y botón ocupado al instante.
const CAT_OCUPADO = [{ show: "catSkel" }, { hide: "catGrid" }];
const CAT_LISTO = [{ hide: "catSkel" }, { show: "catGrid" }, { hide: "catSpin" }, { enable: "catMore" }];
const BUSCAR = { ui: [{ show: "buscando" }, { hide: "resultados" }], event: "search" };

function searchTree(state) {
  const q = typeof state.resultsQ === "string" ? state.resultsQ : "";
  const results = Array.isArray(state.results) ? state.results : null;
  return {
    type: "Scaffold",
    appBar: { type: "AppBar", key: "barSearch", mergeWithKinoBar: true, dense: true, title: "Buscar manga", titleEn: "Search manga",
      leading: { type: "IconButton", key: "backFromSearch", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "popBack" } },
      actions: [] },
    body: { type: "SingleChildScrollView", key: "searchBody", children: [{
      type: "Column", children: [
        { type: "TextField", key: "q", kind: "search", value: q, padding: 16, autofocus: true,
          labelText: "Buscar manga", labelTextEn: "Search manga",
          hintText: "P. ej. one piece", hintEn: "e.g. one piece",
          trailingIcon: "search", trailingLabel: "Buscar", trailingLabelEn: "Search",
          onSubmitted: BUSCAR, onTrailingTap: BUSCAR },
        esqueletosBusqueda("buscando"),
        { type: "Column", key: "resultados", children: [
          results
            ? (results.length ? gridOf(results, VACIO_BUSQUEDA) : VACIO_BUSQUEDA)
            : { type: "Text", text: "Escribe un título y pulsa Buscar.",
                textEn: "Type a title and press Search.", color: "muted", padding: 16 },
        ] },
      ] },
    ] },
  };
}

const GENEROS = [
  ["", "Todos los géneros"],
  ["action", "Acción"], ["adventure", "Aventura"], ["comedy", "Comedia"],
  ["drama", "Drama"], ["fantasy", "Fantasía"], ["horror", "Terror"],
  ["isekai", "Isekai"], ["josei", "Josei"], ["mecha", "Mecha"],
  ["mystery", "Misterio"], ["psychological", "Psicológico"], ["romance", "Romance"],
  ["sci-fi", "Ciencia ficción"], ["seinen", "Seinen"], ["shoujo", "Shoujo"],
  ["shounen", "Shounen"], ["slice-of-life", "Slice of life"],
];
const TIPOS = [["", "Todos"], ["manga", "Manga"], ["manhwa", "Manhwa"], ["manhua", "Manhua"]];
const ESTADOS = [["", "Todos"], ["ongoing", "En emisión"], ["completed", "Finalizado"]];
const CAT_POR_PAG = 30;
const CAT_TOPE = 90;

function catalogoUrl(cat, page) {
  let p = "/manga/?page=" + (page || 1);
  if (cat.genre) p += "&genre=" + encodeURIComponent(cat.genre);
  if (cat.type) p += "&type=" + encodeURIComponent(cat.type);
  if (cat.status) p += "&status=" + encodeURIComponent(cat.status);
  return p;
}

// Texto sin tildes ni mayúsculas, para que el buscador de la hoja de géneros no distinga «Acción» de «accion».
function norm(t) {
  return String(t || "").toLowerCase().replace(/[áàä]/g, "a").replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n");
}

function etiquetaDe(opciones, valor) {
  const o = opciones.find((x) => x[0] === (valor || ""));
  return o ? o[1] : "";
}

// Un filtro es un botón con el valor elegido; al pulsarlo se abre una hoja con las opciones (la de géneros,
// con buscador). Elegir una opción cierra la hoja y recarga con esqueletos.
function filtroBoton(label, labelEn, sheetKey, opciones, valor) {
  const activo = !!valor;
  return { type: activo ? "ElevatedButton" : "TextButton", key: "btn-" + sheetKey, radius: "full",
    icon: "expand_more", labelText: label + ": " + (etiquetaDe(opciones, valor) || "Todos"),
    labelTextEn: labelEn + ": " + (etiquetaDe(opciones, valor) || "All"),
    onPressed: { ui: [{ open: sheetKey }] } };
}

function filtroSheet(sheetKey, titulo, tituloEn, opciones, valor, evento, q) {
  const buscando = q ? norm(q) : "";
  const lista = opciones.filter((o) => !buscando || norm(o[1]).indexOf(buscando) >= 0);
  const act = valor || "";
  const filas = lista.map((o) => {
    const fila = { type: "ListTile", key: sheetKey + "-" + (o[0] || "all"), dense: true, title: o[1],
      onTap: { ui: [{ close: sheetKey }].concat(CAT_OCUPADO), event: evento, arg: o[0] || "all" } };
    if (o[0] === act) fila.trailing = { type: "Icon", name: "check" };
    return fila;
  });
  const hijos = [];
  if (opciones.length > 8) hijos.push({ type: "TextField", key: "gq", kind: "search", value: q || "", padding: 8,
    labelText: "Buscar género", labelTextEn: "Search genre", hintText: "P. ej. romance", hintEn: "e.g. romance",
    onChanged: "gq" });
  hijos.push(filas.length ? { type: "ListView", key: sheetKey + "-lista", items: filas }
    : { type: "Text", text: "Ningún género coincide.", textEn: "No genre matches.", color: "muted", padding: 16 });
  return { type: "BottomSheet", key: sheetKey, title: titulo, titleEn: tituloEn, children: hijos };
}

function catalogTree(c, state) {
  const items = Array.isArray(c.items) ? c.items : [];
  const total = parseInt(String(c.totalTxt || "").replace(/[^0-9]/g, ""), 10) || 0;
  const hayMas = items.length < total && items.length < CAT_TOPE;
  const q = state && typeof state.gq === "string" ? state.gq : "";
  return {
    type: "Scaffold",
    appBar: { type: "AppBar", key: "barCatalog", mergeWithKinoBar: true, dense: true, title: "Catálogo · " + FUENTE,
      leading: { type: "IconButton", key: "backFromCatalog", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back", onPressed: { event: "popBack" } },
      actions: [] },
    body: { type: "SingleChildScrollView", key: "catBody", children: [{
      type: "Column", gap: 8, children: [
        { type: "Row", gap: 8, padding: 16, wrap: true, children: [
          filtroBoton("Género", "Genre", "sheetGenero", GENEROS, c.genre),
          filtroBoton("Tipo", "Type", "sheetTipo", TIPOS, c.type),
          filtroBoton("Estado", "Status", "sheetEstado", ESTADOS, c.status),
        ] },
        c.totalTxt ? { type: "Text", text: c.totalTxt + " en el catálogo",
          textEn: c.totalTxt + " in catalog", style: "caption", color: "muted", padding: 16 } : null,
        esqueletosBusqueda("catSkel"),
        { type: "Column", key: "catGrid", children: [
          items.length ? gridOf(items, VACIO_SERIES) :
            { type: "Text", text: "Sin resultados con estos filtros.",
              textEn: "No results with these filters.", color: "muted", padding: 16 },
          items.length >= CAT_TOPE && total > CAT_TOPE ?
            { type: "Text", text: "Mostrando " + CAT_TOPE + " series: afina los filtros para ver otras.",
              textEn: "Showing " + CAT_TOPE + " series: narrow the filters to see others.",
              style: "caption", color: "muted", padding: 16 } : null,
        ].filter(Boolean) },
        hayMas ? { type: "Column", gap: 8, padding: 16, crossAxisAlignment: "center", children: [
          { type: "ElevatedButton", key: "catMore", icon: "expand_more", radius: "full",
            labelText: "Cargar más", labelTextEn: "Load more",
            onPressed: { ui: [{ disable: "catMore" }, { show: "catSpin" }], event: "catMore" } },
          { type: "CircularProgressIndicator", key: "catSpin", hidden: true },
        ] } : null,
        filtroSheet("sheetGenero", "Género", "Genre", GENEROS, c.genre, "catGenre", q),
        filtroSheet("sheetTipo", "Tipo", "Type", TIPOS, c.type, "catType", ""),
        filtroSheet("sheetEstado", "Estado", "Status", ESTADOS, c.status, "catStatus", ""),
      ].filter(Boolean) }] },
  };
}

function conListo(resp) { if (resp && typeof resp === "object") resp.ui = CAT_LISTO; return resp; }

// Carga una página del catálogo con los filtros pedidos y la deja en
// kino.storage ("cat"); la respuesta solo avisa del cambio (catTk)
// para que Kino vuelva a pedir la pantalla, que lee el catálogo del
// almacenamiento — así el estado de la pantalla no crece (Kino admite
// 64 KB de estado y un catálogo de 90 series pesaría 14 KB). Si es
// una página siguiente de los MISMOS filtros, se añade a lo ya
// cargado (botón "Cargar más"); con filtros nuevos empieza de cero.
async function cargarCatalogo(cat, page, conRuta) {
  const page1 = Math.max(1, parseInt(page, 10) || 1);
  const html = await getHtml(catalogoUrl(cat, page1));
  const nuevos = homeCards(html, CAT_POR_PAG);
  const tm = html.match(/([\d][\d,]*)\s*series/i);
  const num = tm ? tm[1].replace(/[^0-9]/g, "") : "";
  let totalTxt = num ? num.replace(/(\d)(?=(\d{3})+$)/g, "$1.") + " series" : "";
  const prevCat = page1 > 1 ? getJson("cat", null) : null;
  const prev = prevCat && Array.isArray(prevCat.items) &&
    (prevCat.genre || "") === (cat.genre || "") &&
    (prevCat.type || "") === (cat.type || "") &&
    (prevCat.status || "") === (cat.status || "") ? prevCat.items : [];
  if (!totalTxt && prevCat && prevCat.totalTxt) totalTxt = prevCat.totalTxt;
  const vistos = {};
  const items = prev.concat(nuevos)
    .filter((x) => (!vistos[x.url] && (vistos[x.url] = 1)))
    .slice(0, CAT_TOPE);
  setJson("cat", { items: items, page: page1, genre: cat.genre || "",
    type: cat.type || "", status: cat.status || "", totalTxt: totalTxt });
  log("catálogo pág. " + page1 + ": +" + nuevos.length + " → " + items.length +
    " series, filtros " + (cat.genre || "-") + "/" + (cat.type || "-") + "/" + (cat.status || "-"));
  const resp = { state: { catTk: Date.now() } };
  if (conRuta) resp.route = { push: "catalog" };
  return resp;
}

function routeUrl(r) {
  if (!r) return "";
  return String((r.params && r.params.url) || (r.args && r.args.url) || r.url || "");
}

// ---- El Home general de Kino: filas de mangas. Kino las enseña tras las suyas con el nombre del plugin
// y las guarda 6 h. Cada ítem abre la pantalla de este plugin (`open.screen`), no la ficha de un título: la portada
// del plugin con la serie empujada encima (así «volver» lleva a la portada, no cierra todo). El tipo es «movie»
// porque la ficha de «series» exigiría `episodes`.
function itemHome(it) {
  const m = /^[/]manga[/]([a-z0-9]{4,})[/]([a-z0-9-]+)[/]$/i.exec(String((it && it.url) || ""));
  if (!m || !it.title) return null;
  const item = { id: (m[2] + "-" + m[1]).slice(0, 128), ref: it.url, title: String(it.title).slice(0, 200),
    kind: "movie", badges: ["Manga"],
    open: { screen: { args: { open: it.url } } } };
  if (it.poster) item.poster = it.poster;
  return item;
}

export async function home() {
  const rows = [];
  const fila = (id, title, items) => {
    const seen = {};
    const list = items.map(itemHome).filter((x) => x && !seen[x.id] && (seen[x.id] = 1)).slice(0, 30);
    if (list.length) rows.push({ id: id, title: title, items: list });
  };
  const hh = hist();
  fila("manga-seguir", "Seguir leyendo manga", Object.keys(hh)
    .map((k) => ({ url: k, title: hh[k].title || "", poster: hh[k].poster || "", ts: hh[k].ts || 0 }))
    .filter((x) => x.title).sort((a, b) => b.ts - a.ts).slice(0, 15));
  fila("manga-favoritos", "Mis mangas favoritos", favs().slice(0, 20));
  const html = await getHtml("/");
  const posT = html.search(/tendencias/i), posP = html.search(/populares/i), posU = html.search(/ultimos\s+mangas/i);
  if (posT >= 0 && posP > posT && posU > posP) {
    fila("manga-populares", "Mangas populares", homeCards(html.slice(posP, posU), 12).concat(homeCards(html.slice(posT, posP), 18)));
    fila("manga-recientes", "Mangas actualizados", homeCards(html.slice(posU), 30));
  } else {
    fila("manga-series", "Mangas", homeCards(html, 30));
  }
  return rows;
}

// Abre el lector en el capítulo `idx` de la serie `d`: lee las páginas, guarda el historial y, con `push`,
// empuja la pantalla del lector.
async function abrirLector(d, idx, push) {
  const ch = d.chapters[idx];
  const html = await getHtml(ch.url);
  let images = readerImages(html);
  if (!images.length) {
    return { toast: "No se pudieron leer las páginas de este capítulo." };
  }
  images = images.map((x) => (typeof x === "string" ? { url: x } : { url: x.url }));
  log("capítulo " + ch.num + " listo: " + images.length + " páginas");
  // Historial: el último capítulo abierto de la serie (para
  // "Seguir leyendo", el botón "Continuar" y las marcas de leído).
  const h = hist();
  // Volver al mismo capítulo retoma la página donde se quedó la persona.
  const antes = h[d.url];
  const page = antes && antes.idx === idx && antes.page > 0 ? Math.min(antes.page, images.length) : 0;
  h[d.url] = { url: ch.url, num: ch.num, idx: idx, ts: Date.now(), page: page, pos: 0,
    title: (d.meta && d.meta.title) || "", poster: (d.meta && d.meta.poster) || "" };
  const hk = Object.keys(h);
  if (hk.length > 100) { hk.sort((a, b) => (h[b].ts || 0) - (h[a].ts || 0));
    for (let i = 100; i < hk.length; i++) delete h[hk[i]]; }
  setJson("hist", h);
  syncPushHist();
  const resp = { state: { reader: { images: images, idx: idx, tk: Date.now() } } };
  if (page > 0 && cfg().mode !== "vertical") resp.ui = [{ set: { key: "pgs", value: page } }];
  if (push) resp.route = { push: "read" };
  return resp;
}

export async function screen(ev) {
  const state = (ev && ev.state) || {};
  const route = (ev && ev.route) || { name: "home" };
  try {
    if (route.name === "detail") {
      const url = routeUrl(route);
      if (!state.detail || (url && state.detail.url !== url)) return loadingTree("Cargando serie…");
      return detailTree(state);
    }
    if (route.name === "read") return readerTree(state);
    if (route.name === "search") return searchTree(state);
    if (route.name === "catalog") {
      const c = getJson("cat", null);
      if (!c || typeof c !== "object") return loadingTree("Cargando catálogo…");
      return catalogTree(c, state);
    }
  } catch (e) {
    return errorTree("No se pudo cargar (" + ((e && e.code) || "error") + ").");
  }
  const body = await homeTree();
  return {
    type: "Scaffold",
    every: filasPendientes() ? { ms: 1000, event: "cargarFilas" } : undefined,
    appBar: { type: "AppBar", key: "barHome", mergeWithKinoBar: true, dense: true, title: "MangaTrack",
      leading: { type: "IconButton", key: "closeHome", icon: "close",
        labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } },
      actions: [
        { type: "IconButton", icon: "search", key: "goSearch",
          labelText: "Buscar", labelTextEn: "Search", onPressed: { event: "goSearch" } },
      ] },
    body: body,
  };
}

export async function screenEvent(ev) {
  const name = ev.name;
  const state = ev.state || {};
  try {
    if (name === "open") {
      syncPullFavs();
      syncPullHist();
      syncPullCfg();
      const r = ev.route || {};
      const args = r.args && typeof r.args === "object" ? r.args : {};
      if (typeof args.open === "string" && /^[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/]$/i.test(args.open)) {
        return await cargarSerie(args.open, true);
      }
      if (r.name === "detail") {
        const url = routeUrl(r);
        if (url && /^[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/]$/i.test(url) &&
            (!state.detail || state.detail.url !== url)) {
          return await cargarSerie(url, false);
        }
      }
      if (r.name === "catalog") {
        const c = getJson("cat", null);
        if (!c || typeof c !== "object") return await cargarCatalogo({ genre: "", type: "", status: "" }, 1, false);
      }
      if (!r.name || r.name === "home" || r.name === "main") {
        return (await cargarFilasHome()) ? { state: { homeTk: Date.now() } } : null;
      }
      return null;
    }
    if (name === "goSearch") return { route: { push: "search" } };
    if (name === "openCatalog") {
      return await cargarCatalogo({ genre: "", type: "", status: "" }, 1, true);
    }
    if (name === "fuentePronto") {
      return { toast: String(ev.arg || "Esa fuente") + " llegará en una próxima versión." };
    }
    if (name === "fuenteActual") {
      return { toast: "Ya estás viendo " + FUENTE + "." };
    }
    if (name === "catGenre" || name === "catType" || name === "catStatus") {
      const c = getJson("cat", {}) || {};
      const nuevo = { genre: c.genre || "", type: c.type || "", status: c.status || "" };
      const crudo = String(ev.arg != null ? ev.arg : (ev.value || ""));
      const v = crudo === "all" ? "" : crudo;
      if (name === "catGenre") nuevo.genre = v;
      else if (name === "catType") nuevo.type = v;
      else nuevo.status = v;
      return conListo(await cargarCatalogo(nuevo, 1, false));
    }
    if (name === "catMore") {
      const c = getJson("cat", null);
      if (!c || !Array.isArray(c.items) || !c.items.length) return null;
      return conListo(await cargarCatalogo({ genre: c.genre || "", type: c.type || "", status: c.status || "" },
        (c.page || 1) + 1, false));
    }
    if (name === "popBack") return { route: { pop: true } };
    if (name === "openSeries") {
      const url = String(ev.arg || "");
      if (!/^[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/]$/i.test(url)) return null;
      return await cargarSerie(url, true);
    }
    if (name === "read" || name === "nextChap" || name === "prevChap" || name === "jumpChap") {
      const d = state.detail;
      if (!d || !Array.isArray(d.chapters) || !d.chapters.length) return null;
      let idx;
      if (name === "read") {
        idx = parseInt(String(ev.arg || "0"), 10) || 0;
      } else if (name === "jumpChap") {
        idx = parseInt(String(ev.value || ""), 10);
        if (!(idx >= 0) || idx >= d.chapters.length) return null;
      } else {
        idx = ((state.reader && state.reader.idx) || 0) + (name === "nextChap" ? 1 : -1);
      }
      if (idx < 0 || idx >= d.chapters.length) return null;
      return await abrirLector(d, idx, name === "read");
    }
    if (name === "search") {
      const q = String(typeof ev.value === "string" ? ev.value : (ev.value && ev.value.q) || "").trim();
      const listo = [{ hide: "buscando" }, { show: "resultados" }];
      if (!q) return { toast: "Escribe un título.", ui: listo };
      const html = await getHtml("/?s=" + encodeURIComponent(q));
      const results = homeCards(html, 30);
      return { state: { results: results, resultsQ: q }, ui: listo,
        toast: results.length ? results.length + " resultados" : "Sin resultados" };
    }
    if (name === "verFila") {
      const f = HOME_FILAS.find((x) => x.key === String(ev.arg || ""));
      if (!f) return null;
      return await cargarCatalogo({ genre: f.q.genre || "", type: f.q.type || "", status: f.q.status || "" }, 1, true);
    }
    if (name === "continuarUltimo") {
      const url = String(ev.arg || "");
      const h = hist()[url];
      if (!h || !/^[/]manga[/][a-z0-9]{4,}[/][a-z0-9-]+[/]$/i.test(url)) return null;
      const serie = await cargarSerie(url, false);
      if (!serie.state || !serie.state.detail) return serie;
      const d = serie.state.detail;
      const resp = await abrirLector(d, Math.max(0, Math.min(h.idx || 0, d.chapters.length - 1)), true);
      if (resp.state) resp.state = Object.assign({}, serie.state, resp.state);
      return resp;
    }
    if (name === "gq") return { state: { gq: String(ev.value || "").slice(0, 40) } };
    if (name === "cargarFilas") {
      await cargarFilasHome();
      return { state: { homeTk: Date.now() } };
    }
    if (name === "toggleDesc") return { state: { descOpen: !(state.descOpen === true) } };
    if (name === "toggleOrden") {
      setJson("ord", orden() === "asc" ? "desc" : "asc");
      return { state: { ordTk: Date.now() } };
    }
    if (name === "cycleMode") {
      const c = cfg();
      c.mode = MODOS[(MODOS.indexOf(c.mode) + 1) % MODOS.length];
      setCfg(c);
      const info = MODO_INFO[c.mode];
      return { state: { modeTk: Date.now() }, toast: info.es };
    }
    if (name === "pageChanged" || name === "scrolled") {
      // Guarda hasta dónde llegó la persona (página o fracción del scroll).
      const d = state.detail, r = state.reader;
      const v = Number(ev.value);
      if (!d || !r || !isFinite(v)) return null;
      const h = hist();
      const e = h[d.url];
      if (!e || e.idx !== r.idx) return null;
      if (name === "pageChanged") e.page = Math.max(0, Math.min(Math.floor(v), r.images.length));
      else e.pos = Math.max(0, Math.min(v, 1));
      e.ts = Date.now();
      setJson("hist", h);
      syncPushHist();
      return null;
    }
    if (name === "fav") {
      const d = state.detail;
      if (!d) return null;
      const f = favs();
      const i = f.findIndex((x) => x.url === d.url);
      let added = false;
      if (i >= 0) f.splice(i, 1);
      else {
        f.unshift({ url: d.url, title: (d.meta && d.meta.title) || "",
          poster: (d.meta && d.meta.poster) || "" });
        added = true;
      }
      if (f.length > 100) f.length = 100;
      setJson("favs", f);
      syncPushFavs();
      return { state: { favTk: Date.now() },
        toast: added ? "Añadido a favoritos" : "Quitado de favoritos" };
    }
    if (name === "retry") return { state: { _r: Date.now() } };
    return null;
  } catch (e) {
    log("error en evento " + name + ": " + ((e && e.message) || e));
    const fallo = { toast: "Algo falló (" + ((e && e.code) || "error") + ")." };
    // Una búsqueda que falla no deja el indicador de carga puesto.
    if (name === "search") fallo.ui = [{ hide: "buscando" }, { show: "resultados" }];
    if (name === "catGenre" || name === "catType" || name === "catStatus" || name === "catMore") fallo.ui = CAT_LISTO;
    return fallo;
  }
}

// Carga la página de una serie y prepara su detalle; si conRuta, empuja la
// pantalla de la serie al terminar.
async function cargarSerie(url, conRuta) {
  const html = await getHtml(url);
  const meta = seriesMeta(html);
  const allCaps = chapterList(html);
  meta.totalCaps = allCaps.length;
  const chapters = allCaps.slice(0, MAX_CAPS).slice().reverse();
  log("serie lista: " + meta.title + " / " + chapters.length + " capítulos");
  if (!chapters.length) return { toast: "No se encontraron capítulos." };
  const resp = { state: { detail: { url: url, meta: meta, chapters: chapters } } };
  if (conRuta) resp.route = { push: "detail", params: { url: url } };
  return resp;
}
