-- ─────────────────────────────────────────────────────────────────
-- Cultivo anterior + incorporación de restos (pilar fertilizantes)
-- ─────────────────────────────────────────────────────────────────
-- Cierra el último término gratis del balance de N de MAPA: el crédito por los
-- residuos de la cosecha ANTERIOR. MAPA (Parte II, pág. 186) lo condiciona a que
-- los restos se INCORPOREN al suelo; por eso guardamos las dos cosas.
--
--   cultivo_anterior     : id de cultivo previo (mismas claves que el onboarding:
--                          lechuga, espinaca, brassica, tomate, pimiento,
--                          berenjena, calabacin, cebolla). NULL = desconocido.
--   restos_incorporados  : true si el agricultor enterró los restos. Sin esto,
--                          el crédito es 0 (MAPA no lo acredita si se retiran).
--
-- El motor (api/_motor-nutricion.js → creditoResiduosN) traduce el cultivo a los
-- kg N/ha de la Tabla 23.3.1 de MAPA × 60% (fracción disponible en 2-3 meses).
-- api/campo.js (vista cuaderno) los lee vía select=*.

alter table usuarios add column if not exists cultivo_anterior    text;
alter table usuarios add column if not exists restos_incorporados boolean;

comment on column usuarios.cultivo_anterior is
  'Cultivo plantado ANTES en la parcela (id del onboarding). Activa el crédito de N por residuos de MAPA. NULL = desconocido.';
comment on column usuarios.restos_incorporados is
  'true si se incorporaron los restos de la cosecha anterior al suelo. Requisito de MAPA para acreditar el N de residuos.';
