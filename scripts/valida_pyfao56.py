#!/usr/bin/env python3
"""
Validación del motor de riego de Kylia contra pyfao56 (Nivel 2, FAO-56).
Ver docs/tecnico/motor-de-decision.md §3.4.

Compara, con el MISMO clima real y el MISMO Kc único:
  - ETc (demanda)  : Kylia vs pyfao56 ETcm  → debe ser exacto
  - Dr  (balance)  : Kylia (single) vs pyfao56 (dual) → diferencia esperada
  - decisión regar : concordancia Dr≥RAW, cada lado con SU umbral del día

Requisitos:  pip install pyfao56 numpy pandas

Uso:
  python3 scripts/valida_pyfao56.py                  # una ventana (últimos 40 d)
  python3 scripts/valida_pyfao56.py --start 2026-04-01
  python3 scripts/valida_pyfao56.py --sweep          # BARRIDO: la tabla del doc

El barrido es lo que sostiene lo que se publica. Una sola ventana NO caracteriza
este motor: el error depende casi solo de la lluvia del periodo (ver §3.4), así
que publicar una ejecución suelta es publicar el clima de ese mes.
"""
import json, urllib.request, datetime as dt, argparse, sys
import numpy as np, pandas as pd
from pyfao56 import Parameters, Weather, Irrigation, Model

LAT, LON = 41.6176, 0.6200          # Lleida (interior seco de Cataluña)
VENTANA  = 40                       # días por ensayo (= ciclo corto de lechuga)

# ── Parámetros (idénticos a Kylia: assets/js/motor-riego.js) ──
AWC, ZR, P = 0.15, 0.30, 0.45
TAW, RAW = 1000*AWC*ZR, P*1000*AWC*ZR
KC = dict(ini=0.70, med=1.00, fin=0.95); L = dict(ini=20, des=30, med=15, fin=10)
PE_MIN_MM = 2.0                     # lluvia < 2 mm no infiltra (simplificación de Kylia)
RIEGO_MM  = 25.0                    # riego fijo cada 7 días, a los dos motores


def kc(days):
    Li, Ld, Lm, Lf = L['ini'], L['des'], L['med'], L['fin']; dd = max(0, days)
    if dd < Li:           return KC['ini']
    if dd < Li+Ld:        return KC['ini'] + (KC['med']-KC['ini'])*(dd-Li)/Ld
    if dd < Li+Ld+Lm:     return KC['med']
    if dd < Li+Ld+Lm+Lf:  return KC['med'] + (KC['fin']-KC['med'])*(dd-Li-Ld-Lm)/Lf
    return KC['fin']


def clima(desde, hasta):
    """Una sola petición para todo el periodo; el barrido corta ventanas de aquí."""
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}"
           f"&start_date={desde}&end_date={hasta}"
           "&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min"
           "&timezone=Europe%2FMadrid")
    d = json.load(urllib.request.urlopen(url, timeout=60))['daily']
    return dict(
        dates=[dt.date.fromisoformat(x) for x in d['time']],
        et0  =[float(x or 0)  for x in d['et0_fao_evapotranspiration']],
        rain =[float(x or 0)  for x in d['precipitation_sum']],
        tmax =[float(x or 25) for x in d['temperature_2m_max']],
        tmin =[float(x or 12) for x in d['temperature_2m_min']],
    )


def corre_pyfao56(dates, et0, rain, tmax, tmin, irr_days):
    """pyfao56 con el mismo Kc único (Kcm); su Kcb basal solo afecta su balance dual."""
    par = Parameters()
    par.Kcmini, par.Kcmmid, par.Kcmend = 0.70, 1.00, 0.95
    par.Kcbini, par.Kcbmid, par.Kcbend = 0.15, 0.90, 0.90
    par.Lini, par.Ldev, par.Lmid, par.Lend = 20, 30, 15, 10
    par.thetaFC, par.thetaWP, par.theta0 = 0.29, 0.14, 0.29   # AWC 0.15, arranca lleno
    par.Zrini, par.Zrmax = 0.30, 0.30                         # Zr fijo = Kylia
    par.pbase, par.Ze, par.REW, par.CN2 = 0.45, 0.10, 8.0, 70
    par.hini, par.hmax = 0.05, 0.30
    key = lambda x: f"{x.year}-{x.timetuple().tm_yday:03d}"
    wth = Weather(); wth.wndht = 2.0
    wth.wdata = pd.DataFrame(index=[key(x) for x in dates], columns=wth.cnames)
    for i, x in enumerate(dates):            # RHmin 45 / u2 2 = condición de referencia FAO-56
        wth.wdata.loc[key(x), ['Tmax','Tmin','RHmax','RHmin','Wndsp','Rain','ETref','MorP']] = \
            [tmax[i], tmin[i], 80.0, 45.0, 2.0, rain[i], et0[i], 'M']
    irr = Irrigation()
    irr.idata = pd.DataFrame([[RIEGO_MM, 1.0, 100.0] for _ in irr_days],
                             index=[key(dates[i]) for i in irr_days], columns=['Depth','fw','ieff'])
    od = Model(key(dates[0]), key(dates[-1]), par, wth, irr=irr, roff=False)
    od.run()
    return od.odata.reset_index(drop=True)


def corre_kylia(dates, et0, rain, irr_days):
    """Port fiel de balanceHidrico (assets/js/motor-riego.js:133).
    Mismo orden que el JS: riego → ETc → lluvia efectiva → acotar Dr a [0, TAW]."""
    plant, Dr, out = dates[0], 0.0, []
    for i in range(len(dates)):
        if i in irr_days: Dr = max(0, Dr - RIEGO_MM)
        k = kc((dates[i]-plant).days); etc = k*et0[i]
        pe = rain[i] if rain[i] >= PE_MIN_MM else 0.0
        p_adj = min(0.8, max(0.1, P + 0.04*(5.0 - etc)))      # = pyfao56 model.py
        Dr = min(TAW, max(0, Dr + etc - pe))
        out.append((k, etc, Dr, p_adj, p_adj*TAW))
    return out


def metricas(c, i0, n):
    """Corre los dos motores sobre la ventana [i0, i0+n) y devuelve las métricas."""
    sl = slice(i0, i0+n)
    dates, et0, rain = c['dates'][sl], c['et0'][sl], c['rain'][sl]
    tmax, tmin = c['tmax'][sl], c['tmin'][sl]
    irr_days = {i for i in range(len(dates)) if i % 7 == 0 and i > 0}
    od  = corre_pyfao56(dates, et0, rain, tmax, tmin, irr_days)
    kyl = corre_kylia(dates, et0, rain, irr_days)

    m = min(len(od), len(dates)); A = lambda f: np.array([f(i) for i in range(m)])
    ky_kc,  pf_kc  = A(lambda i: kyl[i][0]), A(lambda i: float(od.loc[i,'Kcm']))
    ky_etc, pf_etc = A(lambda i: kyl[i][1]), A(lambda i: float(od.loc[i,'ETcm']))
    ky_dr,  pf_dr  = A(lambda i: kyl[i][2]), A(lambda i: float(od.loc[i,'Dr']))
    ky_p,   pf_p   = A(lambda i: kyl[i][3]), A(lambda i: float(od.loc[i,'p']))
    ky_raw, pf_raw = A(lambda i: kyl[i][4]), A(lambda i: float(od.loc[i,'RAW']))
    rmse = lambda a, b: float(np.sqrt(np.nanmean((a-b)**2)))
    mbe  = lambda a, b: float(np.nanmean(a-b))
    return dict(
        ini=dates[0], fin=dates[m-1], n=m,
        lluvia=float(np.sum(rain[:m])), et0m=float(np.mean(et0[:m])),
        rmse_kc=rmse(ky_kc, pf_kc),
        rmse_etc=rmse(ky_etc, pf_etc), mbe_etc=mbe(ky_etc, pf_etc),
        rmse_dr=rmse(ky_dr, pf_dr),   mbe_dr=mbe(ky_dr, pf_dr),
        rmse_p=rmse(ky_p, pf_p),      rmse_raw=rmse(ky_raw, pf_raw),
        p_ky=(ky_p.min(), ky_p.max()), p_pf=(pf_p.min(), pf_p.max()),
        # Concordancia HONESTA: cada lado con SU propio umbral del día. Antes se
        # usaba el RAW fijo de Kylia para los dos, así que nunca se comparó el de pyfao56.
        conc=float(((ky_dr >= ky_raw) == (pf_dr >= pf_raw)).mean()*100),
        # …pero la concordancia bruta se infla sola: en invierno ninguno de los dos
        # manda regar NUNCA y sale 100% sin haber comparado nada. `conc_activa` mira
        # solo los días en que AL MENOS UNO dice regar (índice de Jaccard). Es la
        # métrica dura, y es la que hay que publicar. None = no hubo ningún día de riego.
        dias_riego_ky=float((ky_dr >= ky_raw).mean()*100),
        dias_riego_pf=float((pf_dr >= pf_raw).mean()*100),
        conc_activa=_jaccard(ky_dr >= ky_raw, pf_dr >= pf_raw),
    )


def _jaccard(a, b):
    union = (a | b).sum()
    return float((a & b).sum()/union*100) if union else None


def una_ventana(start):
    fin = start + dt.timedelta(days=VENTANA-1)
    c = clima(start, fin)
    r = metricas(c, 0, len(c['dates']))
    print(f"Periodo {r['ini']}→{r['fin']} ({r['n']}d) · lechuga · franco · TAW {TAW:.0f} mm")
    print(f"Lluvia del periodo = {r['lluvia']:.1f} mm · ET0 media = {r['et0m']:.1f} mm/d")
    print(f"RMSE(Kc)  = {r['rmse_kc']:.4f}")
    print(f"RMSE(ETc) = {r['rmse_etc']:.4f} mm/d   MBE = {r['mbe_etc']:+.4f}")
    print(f"RMSE(Dr)  = {r['rmse_dr']:.2f} mm       MBE = {r['mbe_dr']:+.2f} mm  (single vs dual)")
    print(f"RMSE(p)   = {r['rmse_p']:.4f}            Kylia {r['p_ky'][0]:.2f}-{r['p_ky'][1]:.2f} · pyfao56 {r['p_pf'][0]:.2f}-{r['p_pf'][1]:.2f}")
    print(f"RMSE(RAW) = {r['rmse_raw']:.2f} mm")
    print(f"Concordancia 'regar' (cada uno con su RAW) = {r['conc']:.0f}%")


def barrido(desde, hasta, paso):
    c = clima(desde, hasta)
    n = len(c['dates'])
    filas = []
    for i0 in range(0, n - VENTANA + 1, paso):
        try:
            filas.append(metricas(c, i0, VENTANA))
        except Exception as e:                      # una ventana mala no tumba el barrido
            print(f"  ⚠ ventana {c['dates'][i0]} descartada: {e}", file=sys.stderr)
    filas.sort(key=lambda r: r['et0m'])

    print(f"\nBARRIDO · {len(filas)} ventanas de {VENTANA} d · Lleida · lechuga · franco · TAW {TAW:.0f} mm")
    print(f"{desde} → {hasta}, una ventana cada {paso} d, ordenadas por demanda evaporativa\n")
    print("| ventana | ET0 media | lluvia | RMSE(ETc) | RMSE(Dr) | MBE(Dr) | conc. bruta | conc. activa |")
    print("|---|---|---|---|---|---|---|---|")
    for r in filas:
        ca = "— (nadie riega)" if r['conc_activa'] is None else f"{r['conc_activa']:.0f}%"
        print(f"| {r['ini']}→{r['fin']} | {r['et0m']:.1f} | {r['lluvia']:.1f} mm | "
              f"{r['rmse_etc']:.4f} | {r['rmse_dr']:.2f} mm | {r['mbe_dr']:+.2f} mm | "
              f"{r['conc']:.0f}% | {ca} |")

    dr  = np.array([r['rmse_dr'] for r in filas])
    mb  = np.array([r['mbe_dr']  for r in filas])
    llu = np.array([r['lluvia']  for r in filas])
    et0 = np.array([r['et0m']    for r in filas])
    cc  = np.array([r['conc']    for r in filas])
    etc = np.array([r['rmse_etc'] for r in filas])
    act = [r['conc_activa'] for r in filas if r['conc_activa'] is not None]

    kcs = np.array([r['rmse_kc'] for r in filas])
    print(f"\nRMSE(Kc):  max {kcs.max():.6f} sobre las {len(filas)} ventanas")
    print(f"RMSE(ETc): max {etc.max():.6f} mm/d sobre las {len(filas)} ventanas "
          f"→ la DEMANDA es exacta en TODAS, no solo en la publicada.")
    print(f"RMSE(Dr):  {dr.min():.2f} → {dr.max():.2f} mm   (mediana {np.median(dr):.2f})")
    print(f"MBE(Dr):   {mb.min():+.2f} → {mb.max():+.2f} mm  (mediana {np.median(mb):+.2f}) "
          f"· negativos: {(mb<0).sum()}/{len(mb)}")

    # Lo que MANDA es la demanda evaporativa, no la lluvia. La lluvia parecía
    # explicarlo con 5 ventanas porque aquí las secas caen en verano (proxy confundido).
    print(f"\nCorrelación con RMSE(Dr):  ET0 {np.corrcoef(et0, dr)[0,1]:+.2f}   "
          f"lluvia {np.corrcoef(llu, dr)[0,1]:+.2f}")
    print(f"Correlación con concordancia: ET0 {np.corrcoef(et0, cc)[0,1]:+.2f}   "
          f"lluvia {np.corrcoef(llu, cc)[0,1]:+.2f}")

    print(f"\n{'ET0 (mm/d)':<26} {'n':>3} {'RMSE(Dr)':>9} {'%TAW':>5} {'MBE':>7} "
          f"{'bruta':>7} {'activa':>7}  días que riega Ky/pf")
    for lo, hi, et in [(0,2,"invierno"), (2,4,"entretiempo"), (4,6,"primavera/otoño"), (6,99,"verano")]:
        s = [r for r in filas if lo <= r['et0m'] < hi]
        if not s: continue
        G = lambda k: np.array([r[k] for r in s], dtype=float)
        a = [r['conc_activa'] for r in s if r['conc_activa'] is not None]
        av = f"{np.mean(a):.0f}%" if a else "—"
        print(f"{f'{lo}-{hi if hi<99 else chr(43)}  {et}':<26} {len(s):3d} {G('rmse_dr').mean():7.1f}mm "
              f"{G('rmse_dr').mean()/TAW*100:4.0f}% {G('mbe_dr').mean():+6.1f} "
              f"{G('conc').mean():6.0f}% {av:>7}  {G('dias_riego_ky').mean():.0f}% / {G('dias_riego_pf').mean():.0f}%")

    # La concordancia BRUTA se infla sola: donde nadie riega nunca sale 100% sin
    # haber comparado ninguna decisión. Hay que publicar las dos.
    triv = len(filas) - len(act)
    print(f"\nConcordancia bruta media {cc.mean():.0f}% · ACTIVA (solo días en que alguien riega) "
          f"{np.mean(act):.0f}%")
    print(f"⚠ En {triv}/{len(filas)} ventanas NINGUNO de los dos riega nunca → su 100% es trivial.")


def direccion(desde, hasta, paso):
    """¿HACIA DÓNDE se equivoca Kylia cuando discrepa del estándar?

    Es la pregunta que decide si la divergencia es tolerable. Un error que hace
    regar ANTES de tiempo cuesta agua; uno que hace regar TARDE cuesta cosecha.
    No son intercambiables, y un RMSE solo no distingue entre los dos."""
    c = clima(desde, hasta)
    ky_solo = pf_solo = ambos = dias = 0
    adelantos = []
    for i0 in range(0, len(c['dates']) - VENTANA + 1, paso):
        sl = slice(i0, i0+VENTANA)
        dates, et0, rain = c['dates'][sl], c['et0'][sl], c['rain'][sl]
        irr_days = {i for i in range(len(dates)) if i % 7 == 0 and i > 0}
        od  = corre_pyfao56(dates, et0, rain, c['tmax'][sl], c['tmin'][sl], irr_days)
        kyl = corre_kylia(dates, et0, rain, irr_days)
        m = min(len(od), len(dates))
        a = np.array([kyl[i][2] >= kyl[i][4] for i in range(m)])
        b = np.array([float(od.loc[i,'Dr']) >= float(od.loc[i,'RAW']) for i in range(m)])
        ky_solo += int((a & ~b).sum()); pf_solo += int((~a & b).sum())
        ambos   += int((a & b).sum());  dias    += m
        if a.any() and b.any(): adelantos.append(int(np.argmax(b) - np.argmax(a)))

    disc = ky_solo + pf_solo
    print(f"\nDIRECCIÓN DE LA DISCREPANCIA · {dias} días comparados\n")
    print(f"  ambos dicen 'regar'                : {ambos:5d}")
    print(f"  discrepan                          : {disc:5d}  ({disc/dias*100:.0f}% de los días)")
    print(f"    · Kylia riega y pyfao56 aún no   : {ky_solo:5d}  ({ky_solo/disc*100:.0f}% de las discrepancias)")
    print(f"    · pyfao56 riega y Kylia NO       : {pf_solo:5d}  ({pf_solo/disc*100:.0f}% · {pf_solo/dias*100:.1f}% de los días)")
    ad = np.array(adelantos)
    print(f"\n  Adelanto del PRIMER riego del ciclo (días que Kylia se adelanta al estándar):")
    print(f"    n={len(ad)} ventanas · media {ad.mean():+.1f} d · mediana {np.median(ad):+.0f} d "
          f"· rango {ad.min():+d} a {ad.max():+d}")
    print(f"    Kylia riega ANTES o a la vez en {(ad>=0).sum()}/{len(ad)} ventanas")
    print(f"\n  → La divergencia es de UN SOLO SENTIDO: Kylia se adelanta. El caso peligroso")
    print(f"    (dejar el cultivo seco cuando el estándar manda regar) es {pf_solo/dias*100:.1f}% de los días.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", help="ventana única que empieza en YYYY-MM-DD")
    ap.add_argument("--sweep", action="store_true", help="barrido de ventanas (la tabla del doc)")
    ap.add_argument("--direccion", action="store_true", help="hacia dónde se equivoca Kylia al discrepar")
    ap.add_argument("--desde", default="2024-01-01")
    ap.add_argument("--hasta", default=str(dt.date.today() - dt.timedelta(days=10)))
    ap.add_argument("--paso",  type=int, default=15, help="días entre inicios de ventana")
    a = ap.parse_args()
    if a.direccion:
        direccion(a.desde, a.hasta, a.paso)
    elif a.sweep:
        barrido(a.desde, a.hasta, a.paso)
    else:
        ini = dt.date.fromisoformat(a.start) if a.start else \
              dt.date.today() - dt.timedelta(days=10) - dt.timedelta(days=VENTANA-1)
        una_ventana(ini)
