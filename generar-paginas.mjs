// =====================================================================
//  Agro Valle Conecta — generador de páginas para Google (SEO)
//
//  Qué hace: lee los anuncios ACTIVOS desde Supabase y crea archivos
//  HTML reales (una página por anuncio, una por categoría, un índice
//  "explorar") más el sitemap.xml. Así Google puede encontrarlos.
//
//  No necesita ninguna clave secreta: solo usa la clave pública que ya
//  está en tu página, y la base de datos solo deja leer anuncios activos.
//  Nunca lee ni publica el WhatsApp ni el email de nadie.
// =====================================================================
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SITE = (process.env.SITE_URL || 'https://gastonaltube.github.io/AgroValle-Conecta/').replace(/\/?$/, '/');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yolccrvajsaltnfzvglr.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_lt6djx886Pwd8aqreZ7TSg_97WUM0Wf';
const OUT = process.env.OUT_DIR || '.';
const NOMBRE = 'Agro Valle Conecta';
const IMG_COMPARTIR = SITE + 'avc-compartir.jpg';

/* ---------- utilidades ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'anuncio';
const recortar = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const dinero = (p) => '$ ' + Number(p).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Mendoza' });
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const esProducto = (a) => a.tipo === 'producto';

/* ---------- 1) leer anuncios ---------- */
async function leerAnuncios() {
  const cols = 'id,tipo,titulo,categoria,descripcion,precio,unidad,zona,estado_producto,cantidad,creado_en,vendedor,anuncio_imagenes(url,orden)';
  const url = `${SUPABASE_URL}/rest/v1/anuncios?select=${cols}&activo=eq.true&order=creado_en.desc&limit=1000`;
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      let r = await fetch(url, { headers: { apikey: KEY } });
      if (r.status === 401 || r.status === 403) r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (!r.ok) throw new Error(`Supabase respondió ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error('Respuesta inesperada de Supabase');
      return data.map((a) => ({
        ...a,
        fotos: (a.anuncio_imagenes || []).slice().sort((x, y) => x.orden - y.orden).map((x) => x.url).filter((u) => /^https:\/\//.test(u)),
        slug: `${slug(a.titulo)}-${String(a.id).slice(0, 8)}`,
        catSlug: `${esProducto(a) ? 'productos' : 'servicios'}-${slug(a.categoria)}`,
      }));
    } catch (e) {
      ultimoError = e;
      console.warn(`Intento ${intento} falló: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
  throw ultimoError;
}

/* ---------- 2) plantilla común ---------- */
const CSS = `:root{--g:#1E3A2B;--g2:#16301F;--s:#6C8F53;--sl:#E4EDDC;--bg:#F5F7F1;--card:#fff;--ink:#1B2119;--ink2:#4B564A;--line:rgba(30,58,43,.15);--acc:#C8892B}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 'Work Sans',system-ui,sans-serif;background:var(--bg);color:var(--ink)}
h1,h2,h3,.logo,.btn,.precio{font-family:'Space Grotesk',system-ui,sans-serif}
a{color:var(--g)}.wrap{max-width:1100px;margin:0 auto;padding:0 18px}
header{background:var(--card);border-bottom:1px solid var(--line)}
.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;flex-wrap:wrap}
.logo{font-weight:700;font-size:19px;color:var(--g2);text-decoration:none}
.nv{display:flex;gap:6px;flex-wrap:wrap}.nv a{padding:8px 10px;text-decoration:none;color:var(--ink);border-radius:8px;font-weight:500}.nv a:hover{background:var(--sl)}
.btn{display:inline-block;background:var(--g);color:#fff;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none}
.btn.o{background:none;color:var(--g2);border:1.5px solid var(--g)}
.mig{font-size:14px;color:var(--ink2);margin:18px 0 12px}.mig a{color:var(--ink2)}
.det{display:grid;grid-template-columns:1.1fr 1fr;gap:28px;margin-bottom:28px}
.fotos img{width:100%;border-radius:12px;display:block;background:var(--sl)}
.mini{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.mini img{width:84px;height:84px;object-fit:cover;border-radius:8px}
.sinfoto{aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;font-size:64px;background:linear-gradient(135deg,#dfe9d3,#b9cca6);border-radius:12px}
.cat{color:var(--ink2);font-size:14px}h1{font-size:30px;line-height:1.2;margin:4px 0 8px}.precio{font-size:28px;font-weight:700;margin:6px 0 14px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 16px}dt{color:var(--ink2)}dd{margin:0;font-weight:500}
.desc{white-space:pre-line;color:var(--ink2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin:12px 0 28px}
.tarjeta{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--ink);display:flex;flex-direction:column}
.tarjeta img,.tarjeta .sinfoto{width:100%;height:160px;aspect-ratio:auto;object-fit:cover;border-radius:0;font-size:44px}
.tarjeta div{padding:12px 14px}.tarjeta small{color:var(--ink2)}.tarjeta h3{font-size:17px;margin:2px 0 6px}.tarjeta b{font-family:'Space Grotesk',sans-serif}
.cats{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 24px;padding:0;list-style:none}.cats a{display:block;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 16px;text-decoration:none;color:var(--ink)}
footer{background:#16301F;color:#CFE0C4;padding:26px 0 20px;margin-top:40px;font-size:14px}footer a{color:#CFE0C4;margin-right:16px}
@media(max-width:760px){.det{grid-template-columns:1fr}h1{font-size:25px}}`;

function pagina({ titulo, descripcion, canonico, imagen, root, cuerpo, datos = [] }) {
  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${esc(canonico)}">
<meta name="theme-color" content="#16301F">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_AR">
<meta property="og:site_name" content="${NOMBRE}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(canonico)}">
<meta property="og:image" content="${esc(imagen || IMG_COMPARTIR)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🌱%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
${datos.map(jsonLd).join('\n')}
</head>
<body>
<header><div class="wrap hd">
<a class="logo" href="${root}">🌱 Agro Valle <b>Conecta</b></a>
<nav class="nv" aria-label="Principal"><a href="${root}explorar/">Explorar</a><a href="${root}#productos">Productos</a><a href="${root}#servicios">Servicios</a><a href="${root}#nosotros">Nosotros</a></nav>
<a class="btn" href="${root}#publicar">Publicar gratis</a>
</div></header>
<main class="wrap">
${cuerpo}
</main>
<footer><div class="wrap">
<p><b>${NOMBRE}</b> — El mercado del agro del Valle de Uco. Tupungato, Mendoza, Argentina.</p>
<p><a href="${root}explorar/">Explorar anuncios</a><a href="${root}#terminos">Términos y condiciones</a><a href="${root}#privacidad">Política de privacidad</a></p>
</div></footer>
</body>
</html>
`;
}

const migas = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: it[1] })),
});

const tarjeta = (a, root) => `<a class="tarjeta" href="${root}anuncio/${a.slug}/">${a.fotos[0] ? `<img src="${esc(a.fotos[0])}" alt="${esc(a.titulo)}" loading="lazy" decoding="async">` : '<div class="sinfoto">🌱</div>'}<div><small>${esc(a.categoria)} · ${esc(a.zona)}</small><h3>${esc(a.titulo)}</h3><b>${a.precio != null && Number(a.precio) > 0 ? esc(dinero(a.precio)) : 'A convenir'}</b></div></a>`;

/* ---------- 3) páginas ---------- */
function paginaAnuncio(a, todos) {
  const root = '../../';
  const url = `${SITE}anuncio/${a.slug}/`;
  const prod = esProducto(a);
  const conPrecio = a.precio != null && Number(a.precio) > 0;
  const titulo = recortar(`${a.titulo} — ${a.categoria} en ${a.zona}`, 58) + ` | ${NOMBRE}`;
  const desc = recortar(`${a.descripcion || a.titulo} ${conPrecio ? dinero(a.precio) + '.' : ''} ${a.categoria} en ${a.zona}, Valle de Uco.`, 155);
  const relacionados = todos.filter((x) => x.catSlug === a.catSlug && x.id !== a.id).slice(0, 4);
  const lista = [
    prod && a.estado_producto ? ['Estado', a.estado_producto] : null,
    prod && a.cantidad ? ['Cantidad', a.cantidad] : null,
    ['Zona', a.zona],
    ['Categoría', a.categoria],
    ['Publicado', fecha(a.creado_en)],
  ].filter(Boolean);

  const datos = [migas([['Inicio', SITE], [a.categoria, `${SITE}categoria/${a.catSlug}/`], [a.titulo, url]])];
  if (prod) {
    const p = { '@context': 'https://schema.org', '@type': 'Product', name: a.titulo, description: recortar(a.descripcion || a.titulo, 500), category: a.categoria };
    if (a.fotos.length) p.image = a.fotos;
    if (conPrecio) p.offers = { '@type': 'Offer', url, price: String(Number(a.precio)), priceCurrency: 'ARS', availability: 'https://schema.org/InStock', areaServed: a.zona };
    if (p.offers && a.estado_producto) p.offers.itemCondition = a.estado_producto === 'Nuevo' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition';
    datos.push(p);
  } else {
    const s = { '@context': 'https://schema.org', '@type': 'Service', name: a.titulo, description: recortar(a.descripcion || a.titulo, 500), serviceType: a.categoria, areaServed: { '@type': 'Place', name: `${a.zona}, Mendoza, Argentina` } };
    if (a.fotos.length) s.image = a.fotos;
    if (conPrecio) s.offers = { '@type': 'Offer', price: String(Number(a.precio)), priceCurrency: 'ARS' };
    datos.push(s);
  }

  const fotos = a.fotos.length
    ? `<img src="${esc(a.fotos[0])}" alt="${esc(a.titulo)}" fetchpriority="high">${a.fotos.length > 1 ? `<div class="mini">${a.fotos.slice(1).map((f, i) => `<a href="${esc(f)}" target="_blank" rel="noopener"><img src="${esc(f)}" alt="${esc(a.titulo)} — foto ${i + 2}" loading="lazy"></a>`).join('')}</div>` : ''}`
    : '<div class="sinfoto">🌱</div>';

  const cuerpo = `<nav class="mig" aria-label="Ubicación"><a href="${root}">Inicio</a> › <a href="${root}categoria/${a.catSlug}/">${esc(a.categoria)}</a> › ${esc(a.titulo)}</nav>
<article class="det">
<div class="fotos">${fotos}</div>
<div>
<span class="cat">${esc(a.categoria)} · ${esc(a.zona)}</span>
<h1>${esc(a.titulo)}</h1>
<p class="precio">${conPrecio ? esc(dinero(a.precio)) + (a.unidad ? ` <small style="font-size:16px;font-weight:500">/ ${esc(a.unidad)}</small>` : '') : 'A convenir'}</p>
<dl>${lista.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<p class="desc">${esc(a.descripcion)}</p>
<p>Publicado por <b>${esc(a.vendedor || 'un usuario')}</b></p>
<p><a class="btn" href="${root}#d-${esc(a.id)}">Contactar al ${prod ? 'vendedor' : 'profesional'}</a></p>
</div>
</article>
${relacionados.length ? `<h2>Más de ${esc(a.categoria)}</h2><div class="grid">${relacionados.map((x) => tarjeta(x, root)).join('')}</div>` : ''}`;

  return pagina({ titulo, descripcion: desc, canonico: url, imagen: a.fotos[0], root, cuerpo, datos });
}

function paginaCategoria(cat, items) {
  const root = '../../';
  const url = `${SITE}categoria/${cat.slug}/`;
  const prod = cat.tipo === 'producto';
  const titulo = `${cat.nombre} ${prod ? 'en venta' : '— servicios'} en el Valle de Uco | ${NOMBRE}`;
  const desc = recortar(`${items.length} ${items.length === 1 ? 'anuncio' : 'anuncios'} de ${cat.nombre.toLowerCase()} en Tupungato, el Valle de Uco y Mendoza. ${prod ? 'Comprá y vendé' : 'Contratá'} directo con productores y profesionales del agro.`, 155);
  const cuerpo = `<nav class="mig" aria-label="Ubicación"><a href="${root}">Inicio</a> › <a href="${root}explorar/">Explorar</a> › ${esc(cat.nombre)}</nav>
<h1>${esc(cat.nombre)} ${prod ? 'en venta' : '— servicios'} en el Valle de Uco</h1>
<p class="desc">${items.length} ${items.length === 1 ? 'anuncio publicado' : 'anuncios publicados'} por productores, empresas y profesionales de Mendoza.</p>
<div class="grid">${items.map((x) => tarjeta(x, root)).join('')}</div>`;
  return pagina({ titulo, descripcion: desc, canonico: url, imagen: items[0]?.fotos[0], root, cuerpo, datos: [migas([['Inicio', SITE], ['Explorar', `${SITE}explorar/`], [cat.nombre, url]])] });
}

function paginaExplorar(todos, categorias) {
  const root = '../';
  const url = `${SITE}explorar/`;
  const desc = 'Explorá productos, insumos, maquinaria y servicios agropecuarios publicados en Tupungato, el Valle de Uco y toda Mendoza.';
  const cuerpo = `<nav class="mig" aria-label="Ubicación"><a href="${root}">Inicio</a> › Explorar</nav>
<h1>Explorar anuncios del agro</h1>
<p class="desc">Productos, insumos, maquinaria y servicios del Valle de Uco y Mendoza.</p>
${categorias.length ? `<h2>Categorías</h2><ul class="cats">${categorias.map((c) => `<li><a href="${root}categoria/${c.slug}/">${esc(c.nombre)} (${c.items.length})</a></li>`).join('')}</ul>` : ''}
<h2>Últimos anuncios</h2>
${todos.length ? `<div class="grid">${todos.slice(0, 24).map((x) => tarjeta(x, root)).join('')}</div>` : '<p class="desc">Todavía no hay anuncios publicados. ¡Sé el primero!</p><p><a class="btn" href="' + root + '#publicar">Publicar gratis</a></p>'}`;
  return pagina({ titulo: `Explorar anuncios agropecuarios en el Valle de Uco | ${NOMBRE}`, descripcion: desc, canonico: url, imagen: todos[0]?.fotos[0], root, cuerpo, datos: [migas([['Inicio', SITE], ['Explorar', url]])] });
}

/* ---------- 4) escribir todo ---------- */
async function escribir(ruta, contenido) {
  await mkdir(join(OUT, ruta, '..'), { recursive: true });
  await writeFile(join(OUT, ruta), contenido, 'utf8');
}

async function main() {
  const anuncios = await leerAnuncios();
  console.log(`Anuncios activos: ${anuncios.length}`);

  // limpiar lo generado antes (así desaparecen los anuncios borrados o pausados)
  for (const d of ['anuncio', 'categoria', 'explorar']) await rm(join(OUT, d), { recursive: true, force: true });

  const porCat = new Map();
  for (const a of anuncios) {
    if (!porCat.has(a.catSlug)) porCat.set(a.catSlug, { slug: a.catSlug, nombre: a.categoria, tipo: a.tipo, items: [] });
    porCat.get(a.catSlug).items.push(a);
  }
  const categorias = [...porCat.values()].sort((x, y) => y.items.length - x.items.length || x.nombre.localeCompare(y.nombre, 'es'));

  const urls = [{ loc: SITE, lastmod: anuncios[0]?.creado_en }, { loc: `${SITE}explorar/`, lastmod: anuncios[0]?.creado_en }];
  for (const a of anuncios) {
    await escribir(`anuncio/${a.slug}/index.html`, paginaAnuncio(a, anuncios));
    urls.push({ loc: `${SITE}anuncio/${a.slug}/`, lastmod: a.creado_en });
  }
  for (const c of categorias) {
    await escribir(`categoria/${c.slug}/index.html`, paginaCategoria(c, c.items));
    urls.push({ loc: `${SITE}categoria/${c.slug}/`, lastmod: c.items[0].creado_en });
  }
  await escribir('explorar/index.html', paginaExplorar(anuncios, categorias));

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  await writeFile(join(OUT, 'sitemap.xml'), sitemap, 'utf8');

  console.log(`Listo: ${anuncios.length} páginas de anuncios, ${categorias.length} de categorías, 1 índice y el sitemap (${urls.length} direcciones).`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
