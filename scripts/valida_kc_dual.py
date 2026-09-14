#!/usr/bin/env python3
"""Serie diaria de referencia con Kc DUAL, calculada por pyfao56.

La consume scripts/compara-kc-dual.mjs --validar, que compara su propia
implementación del dual contra esta. Sin este contraste, un error en el dual de
Kylia parecería un hallazgo sobre el motor.

Requiere:  pip install pyfao56 pandas
Salida:    JSON por stdout con la serie diaria y los parámetros del ensayo.
"""
import datetime as dt, json, sys, urllib.request

try:
    import pandas as pd
    from pyfao56 import Parameters, Weather, Irrigation, Model
except ImportError as e:      # se dice, no se finge
    print(json.dumps({"error": f"falta una dependencia: {e}. pip install pyfao56 pandas"}))
    sys.exit(2)

# ── Parámetros del ensayo, explícitos para que sea reproducible ──
LAT, LON = 41.62, 0.62            # Lleida, interior seco de Cataluña
START, DIAS = "2026-06-01", 60
RIEGO_MM, CADA = 25.0, 7          # riego FIJO: se compara el balance, no la decisión
CULTIVO, SUELO, METODO = "lechuga", "franco", "aspersion"
FUENTE = "Open-Meteo archive (ERA5), timezone=Europe/Madrid"

url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}"
       f"&start_date={START}&end_date=2026-08-15"
       "&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max,temperature_2m_min"
       "&timezone=Europe%2FMadrid")
d = json.load(urllib.request.urlopen(url, timeout=60))["daily"]
dates = [dt.date.fromisoformat(x) for x in d["time"]][:DIAS]
et0  = [float(x or 0)  for x in d["et0_fao_evapotranspiration"]][:DIAS]
rain = [float(x or 0)  for x in d["precipitation_sum"]][:DIAS]
tmax = [float(x or 25) for x in d["temperature_2m_max"]][:DIAS]
tmin = [float(x or 12) for x in d["temperature_2m_min"]][:DIAS]
irr_days = [i for i in range(DIAS) if i % CADA == 0 and i > 0]

par = Parameters()
par.Kcmini, par.Kcmmid, par.Kcmend = 0.70, 1.00, 0.95     # lechuga, Kc único (Tabla 12)
par.Kcbini, par.Kcbmid, par.Kcbend = 0.15, 0.90, 0.90     # lechuga, Kcb basal (Tabla 17)
par.Lini, par.Ldev, par.Lmid, par.Lend = 20, 30, 15, 10
par.thetaFC, par.thetaWP, par.theta0 = 0.29, 0.14, 0.29   # franco: AWC 0,15, arranca lleno
par.Zrini, par.Zrmax = 0.20, 0.30
par.pbase, par.Ze, par.REW, par.CN2 = 0.30, 0.10, 8.0, 70
par.hini, par.hmax = 0.05, 0.30

key = lambda x: f"{x.year}-{x.timetuple().tm_yday:03d}"
wth = Weather(); wth.wndht = 2.0
wth.wdata = pd.DataFrame(index=[key(x) for x in dates], columns=wth.cnames)
for i, x in enumerate(dates):                              # RHmin 45 / u2 2: condición de referencia FAO-56
    wth.wdata.loc[key(x), ['Tmax','Tmin','RHmax','RHmin','Wndsp','Rain','ETref','MorP']] = \
        [tmax[i], tmin[i], 80.0, 45.0, 2.0, rain[i], et0[i], 'M']
irr = Irrigation()
irr.idata = pd.DataFrame([[RIEGO_MM, 1.0, 100.0] for _ in irr_days],
                         index=[key(dates[i]) for i in irr_days], columns=['Depth','fw','ieff'])
mdl = Model(key(dates[0]), key(dates[-1]), par, wth, irr=irr, roff=False)
mdl.run()
od = mdl.odata.reset_index(drop=True)
cols = {c.lower(): c for c in od.columns}
g = lambda i, k: float(od.loc[i, cols[k]]) if k in cols else None

print(json.dumps({
    "fuente": FUENTE, "lat": LAT, "lon": LON, "cultivo": CULTIVO, "suelo": SUELO,
    "metodo": METODO, "riego_mm": RIEGO_MM, "cada": CADA, "n": len(dates),
    "pyfao56_columnas": list(od.columns),
    "dias": [dict(date=dates[i].isoformat(), et0=et0[i], rain=rain[i],
                  Kcb=g(i,'kcb'), Ke=g(i,'ke'), ETc=g(i,'etc'), ETa=g(i,'eta'),
                  Ks=g(i,'ks'), E=g(i,'e'), T=g(i,'t'), De=g(i,'de'), Dr=g(i,'dr'),
                  TAW=g(i,'taw'), RAW=g(i,'raw'))
             for i in range(min(len(od), len(dates)))],
}))
