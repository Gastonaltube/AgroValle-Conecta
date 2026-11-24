#!/usr/bin/env python3
"""
Lee el Boletin Hidronivometeorologico diario del Departamento General de
Irrigacion (DGI) de Mendoza y guarda los caudales de los rios en caudales.json.

Reglas de seguridad:
- Si algo no cuadra (PDF raro, tabla distinta, numeros fuera de rango, fecha vieja)
  NO escribe nada y termina con error: la pagina sigue mostrando el ultimo dato bueno.
- Solo usa la libreria estandar de Python y el programa pdftotext.
"""
import os, re, sys, json, subprocess, tempfile, unicodedata
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

BASE = os.environ.get('BASE_URL', 'https://www.irrigacion.gov.ar').rstrip('/')
OUT = os.environ.get('OUT', 'caudales.json')
AR = timezone(timedelta(hours=-3))
UA = {'User-Agent': 'AgroValleConecta/1.0 (lectura diaria del boletin publico del DGI)'}

# (nombre en el boletin, seccion de aforo que mostramos)
RIOS = [('mendoza', 'Mendoza', 'Guido'), ('tunuyan', 'Tunuyán', 'Valle de Uco'),
        ('diamante', 'Diamante', 'La Jaula'), ('atuel', 'Atuel', 'Loma Negra'),
        ('malargue', 'Malargüe', 'La Barda'), ('grande', 'Grande', 'La Gotera')]
MESES = {m: i + 1 for i, m in enumerate(
    'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split())}
MESES['setiembre'] = 9


def log(*a):
    print(*a, flush=True)


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()


def descargar(url, limite=25_000_000):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        datos = r.read(limite + 1)
    if len(datos) > limite:
        raise ValueError('archivo demasiado grande')
    return datos


def candidatos(hoy):
    """Direcciones probables del boletin, de la mas nueva a la mas vieja."""
    vistos = []
    for atras in range(0, 6):
        d = hoy - timedelta(days=atras)
        nombre = urllib.parse.quote('Boletín-de-Información-Hidronivometeorológica-%s.pdf' % d.strftime('%d-%m-%y'))
        for carpeta in (d, d + timedelta(days=1)):
            u = '%s/web/wp-content/uploads/%s/%s/%s' % (BASE, carpeta.strftime('%Y'), carpeta.strftime('%m'), nombre)
            if u not in vistos:
                vistos.append(u)
    return vistos


def links_de_portada():
    """Plan B: buscar en la portada del DGI enlaces a PDF del boletin."""
    try:
        html = descargar(BASE + '/web/', 3_000_000).decode('utf-8', 'ignore')
    except Exception as e:
        log('Portada no disponible:', e)
        return []
    res = []
    for h in re.findall(r'href=["\']([^"\']+\.pdf)["\']', html, re.I):
        if 'hidronivomet' in sin_tildes(urllib.parse.unquote(h)):
            res.append(urllib.parse.urljoin(BASE + '/web/', h))
    return res


def texto_pdf(ruta, modo):
    cmd = ['pdftotext'] + (['-layout'] if modo == 'layout' else []) + [ruta, '-']
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True).stdout


def a_numero(t):
    return None if t == 's/d' else float(t.replace(',', '.'))


def leer_tabla1(txt):
    """Devuelve {clave_rio: {...}} o None si no encuentra la Tabla 1."""
    m = re.search(r'TABLA\s+N.{0,2}\s*1\b', txt)
    if not m:
        return None
    resto = txt[m.end():]
    e = re.search(r'TABLA\s+N.{0,2}\s*2\b', resto)
    bloque = resto[:e.start()] if e else resto[:3000]
    claves = {k for k, _, _ in RIOS}
    filas = {}
    for linea in bloque.splitlines():
        t = linea.split()
        if not t or sin_tildes(t[0]) not in claves or sin_tildes(t[0]) in filas:
            continue
        clave, nums, pcts = sin_tildes(t[0]), [], []
        for tok in t[1:]:
            if sin_tildes(tok) in claves:      # empieza otra tabla en la misma linea
                break
            if re.fullmatch(r'\d+(?:[.,]\d+)?%', tok):
                pcts.append(float(tok[:-1].replace(',', '.')))
            elif re.fullmatch(r's/d|\d+(?:[.,]\d+)?', tok):
                nums.append(a_numero(tok))
        if len(nums) >= 2:
            filas[clave] = {'nums': nums, 'pcts': pcts}
    return filas


def fecha_boletin(txt):
    for m in re.finditer(r'(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})', txt[:3000]):
        mes = MESES.get(sin_tildes(m.group(2)))
        if mes:
            return datetime(int(m.group(3)), mes, int(m.group(1))).date()
    return None


def armar(filas, boletin, fuente):
    rios = []
    for clave, nombre, estacion in RIOS:
        f = filas.get(clave)
        if not f:
            continue
        n = (f['nums'] + [None] * 4)[:4]
        p = f['pcts'][0] if f['pcts'] and n[0] is not None else None
        rios.append({'rio': nombre, 'estacion': estacion, 'caudal': n[0], 'historico_diario': n[1],
                     'pct_historico': p, 'pronostico_mensual': n[2], 'historico_mensual': n[3]})
    return {'actualizado': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'boletin': boletin.isoformat(), 'dato_del_dia': (boletin - timedelta(days=1)).isoformat(),
            'fuente': fuente, 'rios': rios}


def validar(d, hoy):
    con_dato = [r for r in d['rios'] if r['caudal'] is not None]
    if len(con_dato) < 4:
        return 'menos de 4 rios con dato'
    for r in d['rios']:
        for k in ('caudal', 'historico_diario', 'pronostico_mensual', 'historico_mensual'):
            v = r[k]
            if v is not None and not (0 <= v <= 1500):
                return 'valor fuera de rango en %s/%s: %s' % (r['rio'], k, v)
        if r['pct_historico'] is not None and not (0 <= r['pct_historico'] <= 2000):
            return 'porcentaje fuera de rango en ' + r['rio']
    b = datetime.fromisoformat(d['boletin']).date()
    if not (hoy - timedelta(days=8) <= b <= hoy + timedelta(days=1)):
        return 'la fecha del boletin (%s) no es reciente' % b
    return None


def procesar(url, hoy):
    """Devuelve ('sin_pdf', None) | ('ok', None) | ('ilegible', motivo)."""
    try:
        datos = descargar(url)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log('HTTP', e.code, url)
        return 'sin_pdf', None
    except Exception as e:
        log('Error de red:', e, url)
        return 'sin_pdf', None
    if not datos.startswith(b'%PDF'):
        return 'sin_pdf', None
    log('Boletin encontrado:', url)
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tf:
        tf.write(datos)
        ruta = tf.name
    motivo = 'no se pudo leer el PDF'
    try:
        for modo in ('raw', 'layout'):
            try:
                txt = texto_pdf(ruta, modo)
            except Exception as e:
                motivo = 'pdftotext fallo: %s' % e
                continue
            filas, fb = leer_tabla1(txt), fecha_boletin(txt)
            if not filas or not fb:
                motivo = 'modo %s: no pude leer la Tabla 1 o la fecha' % modo
                continue
            d = armar(filas, fb, url)
            err = validar(d, hoy)
            if err:
                motivo = 'modo %s: %s' % (modo, err)
                continue
            previo = None
            try:
                previo = json.load(open(OUT, encoding='utf-8')).get('boletin')
            except Exception:
                pass
            tmp = OUT + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(d, f, ensure_ascii=False, indent=1)
            os.replace(tmp, OUT)
            log('OK: boletin del', d['boletin'], '-', len(d['rios']), 'rios')
            if os.environ.get('GITHUB_OUTPUT') and previo != d['boletin']:
                with open(os.environ['GITHUB_OUTPUT'], 'a') as g:
                    g.write('boletin=%s\n' % d['boletin'])
            return 'ok', None
        log('::group::Texto del PDF (para diagnostico)')
        try:
            log(texto_pdf(ruta, 'layout')[:6000])
        except Exception:
            pass
        log('::endgroup::')
        return 'ilegible', motivo
    finally:
        os.unlink(ruta)


def main():
    hoy = datetime.now(AR).date()
    for fase in ('patron', 'portada'):
        urls = candidatos(hoy) if fase == 'patron' else links_de_portada()
        for url in urls:
            estado, motivo = procesar(url, hoy)
            if estado == 'ok':
                return 0
            if estado == 'ilegible':
                # es el boletin mas nuevo y no se pudo leer: no probamos con uno viejo
                log('::warning::No se actualizaron los caudales: %s' % motivo)
                return 1
    log('::warning::No se actualizaron los caudales: no se encontro ningun boletin')
    return 1


if __name__ == '__main__':
    sys.exit(main())
