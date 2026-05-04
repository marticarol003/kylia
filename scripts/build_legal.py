#!/usr/bin/env python3
"""Convierte los legales .md a HTML estilados con el branding de Kylia."""
import os
import re
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEGAL_OUT = f"{ROOT}/legal"
LEGAL_SRC = f"{ROOT}/docs/legal-fuente"

DOCS = [
    ("terminos",       "Términos y Condiciones",     "Términos del servicio Kylia: planes, derechos, obligaciones, limitación de responsabilidad y derecho de desistimiento."),
    ("privacidad",     "Política de Privacidad",     "Cómo Kylia trata tus datos personales: bases legales, retención, subencargados, derechos RGPD y reclamación AEPD."),
    ("cookies",        "Política de Cookies",        "Tipos de cookies que usa Kylia. Solo técnicas estrictamente necesarias. Sin publicidad, sin terceros comerciales."),
    ("dpa-enterprise", "Acuerdo de Tratamiento",     "DPA Enterprise compatible con el art. 28 del RGPD para clientes con datos sensibles o volúmenes elevados."),
]

CSS = """
:root {
  --verde:#2b7a3a; --verde-700:#1f5a2b; --verde-900:#0f3617; --verde-50:#e8f3ea;
  --slate-900:#0f172a; --slate-700:#334155; --slate-500:#64748b; --slate-300:#cbd5e1; --slate-200:#e2e8f0; --slate-50:#f8fafc;
  --text:var(--slate-900); --muted:var(--slate-500); --subtle:var(--slate-700); --border:var(--slate-200);
  --max:820px; --radius:16px;
  --shadow-md: 0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.05);
}
*,*::before,*::after { box-sizing:border-box; }
html,body,h1,h2,h3,h4,p,ul,ol { margin:0; padding:0; }
body { font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, system-ui, sans-serif;
       color:var(--text); line-height:1.65; -webkit-font-smoothing:antialiased; background:#fff; }
a { color:var(--verde); text-decoration:none; }
a:hover { text-decoration:underline; }
.wrap { max-width:var(--max); margin:0 auto; padding:0 24px; }

.nav { position:sticky; top:0; z-index:50; background:rgba(255,255,255,0.92);
       backdrop-filter:saturate(180%) blur(10px); border-bottom:1px solid var(--border); }
.nav-inner { display:flex; align-items:center; justify-content:space-between; padding:14px 0; gap:24px; max-width:1180px; margin:0 auto; padding-left:24px; padding-right:24px; }
.brand { display:inline-flex; align-items:center; gap:8px; color:var(--verde-900); font-weight:800; letter-spacing:-0.02em; font-size:1.1rem; }
.brand-dot { width:14px; height:14px; border-radius:50%; background:var(--verde); }
.nav-links { display:flex; gap:24px; align-items:center; font-size:0.95rem; }
.nav-links a { color:var(--subtle); }
.nav-links a:hover { color:var(--text); text-decoration:none; }

main.legal { padding:56px 0 96px; }
.legal .eyebrow { display:inline-block; background:var(--verde-50); border:1px solid var(--verde); color:var(--verde-700);
           padding:5px 12px; border-radius:999px; font-weight:700; font-size:0.72rem; letter-spacing:0.18em; text-transform:uppercase; }
.legal h1 { font-size:clamp(2rem, 4.2vw, 2.6rem); line-height:1.1; margin:18px 0 6px; color:var(--verde-900); letter-spacing:-0.02em; }
.legal h2 { font-size:1.35rem; margin:36px 0 12px; color:var(--verde-900); border-top:1px solid var(--border); padding-top:24px; }
.legal h2:first-of-type { border-top:none; padding-top:0; }
.legal h3 { font-size:1.08rem; margin:24px 0 8px; color:var(--verde-700); }
.legal p { margin:0 0 14px; color:var(--subtle); }
.legal ul, .legal ol { margin:0 0 16px 22px; color:var(--subtle); }
.legal li { margin-bottom:6px; }
.legal strong { color:var(--text); }
.legal table { border-collapse:collapse; width:100%; margin:16px 0; font-size:0.95rem; }
.legal th, .legal td { border:1px solid var(--border); padding:10px 12px; text-align:left; vertical-align:top; }
.legal th { background:var(--slate-50); font-weight:700; color:var(--text); }
.legal hr { border:none; border-top:1px solid var(--border); margin:32px 0; }
.legal code { background:var(--slate-50); padding:2px 6px; border-radius:4px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.9em; color:var(--verde-900); }
.legal blockquote { border-left:4px solid var(--verde); background:var(--verde-50); padding:14px 18px; margin:16px 0; border-radius:6px; color:var(--text); }

.metadata { color:var(--muted); font-size:0.92rem; margin-top:8px; }
.toc { background:var(--slate-50); border:1px solid var(--border); border-radius:12px; padding:18px 22px; margin:28px 0 36px; }
.toc-title { font-size:0.78rem; letter-spacing:0.16em; text-transform:uppercase; color:var(--verde-700); font-weight:700; margin-bottom:8px; }
.toc ul { list-style:none; margin:0; padding:0; columns:2; gap:18px; }
@media (max-width:560px) { .toc ul { columns:1; } }
.toc li { margin:0 0 4px; padding-left:0; }
.toc a { color:var(--subtle); font-size:0.92rem; }

.related { background:var(--verde-50); border:1px solid var(--verde); border-radius:14px; padding:20px 24px; margin-top:48px; }
.related h3 { color:var(--verde-900); font-size:1rem; margin-bottom:8px; }
.related ul { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:16px 24px; }
.related li::before { content:"→ "; color:var(--verde); font-weight:700; }

footer { border-top:1px solid var(--border); padding:32px 0; color:var(--muted); font-size:0.9rem; text-align:center; }
"""

NAV_HTML = """
<nav class="nav" aria-label="Principal">
  <div class="nav-inner">
    <a href="/" class="brand"><span class="brand-dot" aria-hidden="true"></span>Kylia</a>
    <div class="nav-links">
      <a href="/precios">Precios</a>
      <a href="/cooperativas">Cooperativas</a>
      <a href="/legal/">Legal</a>
    </div>
  </div>
</nav>
"""

RELATED_LINKS = {
    "terminos":       [("privacidad", "Privacidad"), ("cookies", "Cookies"), ("dpa-enterprise", "DPA Enterprise")],
    "privacidad":     [("terminos", "Términos"),    ("cookies", "Cookies"), ("dpa-enterprise", "DPA Enterprise")],
    "cookies":        [("terminos", "Términos"),    ("privacidad", "Privacidad"), ("dpa-enterprise", "DPA Enterprise")],
    "dpa-enterprise": [("terminos", "Términos"),    ("privacidad", "Privacidad"), ("cookies", "Cookies")],
}

def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[áàä]", "a", text); text = re.sub(r"[éèë]", "e", text)
    text = re.sub(r"[íìï]", "i", text); text = re.sub(r"[óòö]", "o", text)
    text = re.sub(r"[úùü]", "u", text); text = re.sub(r"ñ", "n", text)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"\s+", "-", text).strip("-")
    return text

def add_h2_ids(html):
    """Añade id='slug' a cada <h2> para enlaces TOC."""
    def repl(match):
        text = re.sub(r"<[^>]+>", "", match.group(2))
        return f'<h2 id="{slugify(text)}">{match.group(2)}</h2>'
    return re.sub(r"<h2>(.*?)</h2>", lambda m: f'<h2 id="{slugify(re.sub(r"<[^>]+>", "", m.group(1)))}">{m.group(1)}</h2>', html, flags=re.DOTALL)

def build_toc(html):
    headings = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', html, flags=re.DOTALL)
    if len(headings) < 3:
        return ""
    items = "\n".join(f'        <li><a href="#{slug}">{re.sub(r"<[^>]+>", "", title)}</a></li>' for slug, title in headings)
    return f"""<aside class="toc">
      <div class="toc-title">Contenido</div>
      <ul>
{items}
      </ul>
    </aside>"""

def render_page(slug, title, description, md_content):
    html_body = markdown.markdown(md_content, extensions=["tables", "extra", "sane_lists"])
    # Quitar el primer h1 del markdown (el título lo gestiona el template)
    html_body = re.sub(r"^\s*<h1>.*?</h1>\s*", "", html_body, count=1, flags=re.DOTALL)
    html_body = add_h2_ids(html_body)
    toc = build_toc(html_body)

    related = RELATED_LINKS[slug]
    related_html = "\n      ".join(f'<li><a href="/legal/{s}">{n}</a></li>' for s, n in related)

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#2b7a3a" />
<meta name="robots" content="index,follow" />
<title>{title} — Kylia</title>
<meta name="description" content="{description}" />
<link rel="canonical" href="https://kylia.app/legal/{slug}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="{title} — Kylia" />
<meta property="og:description" content="{description}" />
<meta property="og:image" content="https://kylia.app/assets/img/og-image.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><circle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%232b7a3a%22/><path d=%22M10 20 Q16 10 22 20 Z%22 fill=%22white%22/></svg>" />
<style>{CSS}</style>
</head>
<body>
{NAV_HTML}
<main class="legal">
  <div class="wrap">
    <span class="eyebrow">Legal</span>
    <h1>{title}</h1>
    <p class="metadata">Última revisión: 28 abril 2026 · <a href="/legal/">← volver al índice legal</a></p>
    {toc}
    <article>
{html_body}
    </article>
    <div class="related">
      <h3>Otros documentos legales</h3>
      <ul>
      {related_html}
      </ul>
    </div>
  </div>
</main>
<footer>
  <div class="wrap">© 2026 Kylia · <a href="/">Inicio</a> · <a href="mailto:hola@kylia.app">hola@kylia.app</a></div>
</footer>
</body>
</html>"""

INDEX_HTML = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#2b7a3a" />
<meta name="robots" content="index,follow" />
<title>Legal — Kylia</title>
<meta name="description" content="Términos, privacidad, cookies y DPA Enterprise de Kylia. Conformidad RGPD y LSSI." />
<link rel="canonical" href="https://kylia.app/legal/" />
<meta property="og:type" content="website" />
<meta property="og:title" content="Legal — Kylia" />
<meta property="og:description" content="Documentos legales de Kylia: términos, privacidad, cookies y DPA." />
<meta property="og:image" content="https://kylia.app/assets/img/og-image.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><circle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%232b7a3a%22/><path d=%22M10 20 Q16 10 22 20 Z%22 fill=%22white%22/></svg>" />
<style>{CSS}
.cards {{ display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:18px; margin-top:32px; }}
@media (max-width:600px) {{ .cards {{ grid-template-columns:1fr; }} }}
.card {{ display:block; background:#fff; border:1.5px solid var(--border); border-radius:14px; padding:22px 24px; transition:all .15s ease; }}
.card:hover {{ border-color:var(--verde); transform:translateY(-2px); text-decoration:none; box-shadow:var(--shadow-md); }}
.card .badge {{ font-size:.72rem; letter-spacing:.16em; color:var(--verde-700); font-weight:700; text-transform:uppercase; }}
.card h2 {{ font-size:1.18rem; color:var(--verde-900); margin:6px 0 6px; border:none; padding:0; }}
.card p {{ font-size:.95rem; color:var(--subtle); margin:0; }}
</style>
</head>
<body>
{NAV_HTML}
<main class="legal">
  <div class="wrap">
    <span class="eyebrow">Legal</span>
    <h1>Documentos legales</h1>
    <p class="metadata">Conformidad con RGPD, LOPDGDD y LSSI-CE. Última revisión: 28 abril 2026.</p>

    <section class="cards">
      <a class="card" href="/legal/terminos">
        <span class="badge">Contrato</span>
        <h2>Términos y Condiciones</h2>
        <p>Planes, derechos del cliente, limitación de responsabilidad y derecho de desistimiento.</p>
      </a>
      <a class="card" href="/legal/privacidad">
        <span class="badge">RGPD</span>
        <h2>Política de Privacidad</h2>
        <p>Bases legales, retención, subencargados internacionales y derechos del interesado.</p>
      </a>
      <a class="card" href="/legal/cookies">
        <span class="badge">LSSI</span>
        <h2>Política de Cookies</h2>
        <p>Solo técnicas estrictamente necesarias. Sin publicidad ni terceros comerciales.</p>
      </a>
      <a class="card" href="/legal/dpa-enterprise">
        <span class="badge">Art. 28 RGPD</span>
        <h2>DPA Enterprise</h2>
        <p>Acuerdo de tratamiento para clientes con datos sensibles o volúmenes elevados.</p>
      </a>
    </section>

    <p style="margin-top:48px; font-size:.92rem; color:var(--muted);">¿Dudas sobre el cumplimiento normativo o necesitas un DPA personalizado? Escribe a <a href="mailto:legal@kylia.app">legal@kylia.app</a>.</p>
  </div>
</main>
<footer>
  <div class="wrap">© 2026 Kylia · <a href="/">Inicio</a> · <a href="mailto:hola@kylia.app">hola@kylia.app</a></div>
</footer>
</body>
</html>"""

# Generar páginas
for slug, title, desc in DOCS:
    md_path = f"{LEGAL_SRC}/{slug}.md"
    out_dir = f"{LEGAL_OUT}/{slug}"
    out_path = f"{out_dir}/index.html"
    with open(md_path) as f:
        md = f.read()
    os.makedirs(out_dir, exist_ok=True)
    html = render_page(slug, title, desc, md)
    with open(out_path, "w") as f:
        f.write(html)
    print(f"✓ {out_path}  ({len(html):,} bytes)")

# Índice
os.makedirs(LEGAL_OUT, exist_ok=True)
with open(f"{LEGAL_OUT}/index.html", "w") as f:
    f.write(INDEX_HTML)
print(f"✓ {LEGAL_OUT}/index.html  ({len(INDEX_HTML):,} bytes)")
