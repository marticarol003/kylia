#!/usr/bin/env python3
"""
Validación del motor de riego de Kylia contra pyfao56 (Nivel 2, FAO-56).
Ver docs/tecnico/motor-de-decision.md §3.4.

Compara, con el MISMO clima real y el MISMO Kc único:
  - ETc (demanda)  : Kylia vs pyfao56 ETcm  → debe ser exacto
  - Dr  (balance)  : Kylia (single) vs pyfao56 (dual) → diferencia esperada
  - decisión regar : concordancia Dr≥RAW

Requisitos:  pip install pyfao56 numpy pandas
Uso:         python3 scripts/valida_pyfao56.py
"""
import json, urllib.request, datetime as dt
import numpy as np, pandas as pd
from pyfao56 import Parameters, Weather, Irrigation, Model

LAT, LON = 41.6176, 0.6200                      # Lleida (interior seco de Cataluña)
end   = dt.date.today() - dt.timedelta(days=10)  # el archivo lleva ~5-10 días de retraso
start = end - dt.timedelta(days=39)

# ── Clima real (Open-Meteo Archive) ──
url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}"
       f"&start_date={start}&end_date={end}"
       "&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min"
       "&timezone=Europe%2FMadrid")
d = json.load(urllib.request.urlopen(url, timeout=30))['daily']
dates = [dt.date.fromisoformat(x) for x in d['time']]
et0  = [float(x or 0)  for x in d['et0_fao_evapotranspiration']]
rain = [float(x or 0)  for x in d['precipitation_sum']]
tmax = [float(x or 25) for x in d['temperature_2m_max']]
tmin = [float(x or 12) for x in d['temperature_2m_min']]
PLANT, n = dates[0], len(dates)

# ── Parámetros (idénticos a Kylia: api/_motor-riego.js) ──
AWC, ZR, P = 0.15, 0.30, 0.45
TAW, RAW = 1000*AWC*ZR, P*1000*AWC*ZR
KC = dict(ini=0.70, med=1.00, fin=0.95); L = dict(ini=20, des=30, med=15, fin=10)
def kc(days):
    Li, Ld, Lm, Lf = L['ini'], L['des'], L['med'], L['fin']; dd = max(0, days)
    if dd < Li:           return KC['ini']
    if dd < Li+Ld:        return KC['ini'] + (KC['med']-KC['ini'])*(dd-Li)/Ld
    if dd < Li+Ld+Lm:     return KC['med']
    if dd < Li+Ld+Lm+Lf:  return KC['med'] + (KC['fin']-KC['med'])*(dd-Li-Ld-Lm)/Lf
    return KC['fin']
irr_days = {i for i in range(n) if i % 7 == 0 and i > 0}   # 25 mm netos cada 7 días

# ── pyfao56 (mismo Kc único Kcm; Kcb basal solo afecta su balance dual) ──
par = Parameters()
par.Kcmini, par.Kcmmid, par.Kcmend = 0.70, 1.00, 0.95
par.Kcbini, par.Kcbmid, par.Kcbend = 0.15, 0.90, 0.90
par.Lini, par.Ldev, par.Lmid, par.Lend = 20, 30, 15, 10
par.thetaFC, par.thetaWP, par.theta0 = 0.29, 0.14, 0.29     # AWC 0.15, arranca lleno
par.Zrini, par.Zrmax = 0.30, 0.30                           # Zr fijo = Kylia
par.pbase, par.Ze, par.REW, par.CN2 = 0.45, 0.10, 8.0, 70
par.hini, par.hmax = 0.05, 0.30
key = lambda x: f"{x.year}-{x.timetuple().tm_yday:03d}"
wth = Weather(); wth.wndht = 2.0
wth.wdata = pd.DataFrame(index=[key(x) for x in dates], columns=wth.cnames)
for i, x in enumerate(dates):                                # RHmin 45 / u2 2 = condición ref FAO-56
    wth.wdata.loc[key(x), ['Tmax','Tmin','RHmax','RHmin','Wndsp','Rain','ETref','MorP']] = \
        [tmax[i], tmin[i], 80.0, 45.0, 2.0, rain[i], et0[i], 'M']
irr = Irrigation()
irr.idata = pd.DataFrame([[25.0, 1.0, 100.0] for _ in irr_days],
                         index=[key(dates[i]) for i in irr_days], columns=['Depth','fw','ieff'])
od = Model(key(PLANT), key(dates[-1]), par, wth, irr=irr, roff=False)
od.run(); od = od.odata.reset_index(drop=True)

# ── Kylia (port fiel de calcularBalanceHidrico) ──
Dr, kyl = 0.0, []
for i in range(n):
    if i in irr_days: Dr = max(0, Dr - 25.0)
    k = kc((dates[i]-PLANT).days); etc = k*et0[i]; pe = max(0, rain[i])
    Dr = min(TAW, max(0, Dr + etc - pe)); kyl.append((k, etc, Dr))

# ── Métricas ──
m = min(len(od), n); A = lambda f: np.array([f(i) for i in range(m)])
ky_kc, pf_kc   = A(lambda i: kyl[i][0]), A(lambda i: float(od.loc[i,'Kcm']))
ky_etc, pf_etc = A(lambda i: kyl[i][1]), A(lambda i: float(od.loc[i,'ETcm']))
ky_dr, pf_dr   = A(lambda i: kyl[i][2]), A(lambda i: float(od.loc[i,'Dr']))
rmse = lambda a, b: float(np.sqrt(np.nanmean((a-b)**2)))
mbe  = lambda a, b: float(np.nanmean(a-b))
print(f"Periodo {dates[0]}→{dates[m-1]} ({m}d) · lechuga · franco · TAW {TAW:.0f} / RAW {RAW:.0f} mm")
print(f"RMSE(Kc)  = {rmse(ky_kc,pf_kc):.4f}")
print(f"RMSE(ETc) = {rmse(ky_etc,pf_etc):.4f} mm/d   MBE = {mbe(ky_etc,pf_etc):+.4f}")
print(f"RMSE(Dr)  = {rmse(ky_dr,pf_dr):.2f} mm       MBE = {mbe(ky_dr,pf_dr):+.2f} mm  (single vs dual)")
print(f"Concordancia 'regar' (Dr>=RAW) = {((ky_dr>=RAW)==(pf_dr>=RAW)).mean()*100:.0f}%")
