// La migración de `reservas_alta`, leída como SQL EJECUTABLE.
//   node tests/test-reserva-alta-migracion.mjs
//
// ⚠️ ESTO ES ANÁLISIS ESTÁTICO, Y NO DEMUESTRA QUE EL SQL CORRA. No hay
// PostgreSQL en esta máquina —ni `psql`, ni Docker, ni `DATABASE_URL`—, así que
// nada de lo que hay aquí prueba que la migración se ejecute sin errores de
// sintaxis ni que Postgres se comporte como esperamos. Lo que sí comprueba es
// que el fichero DICE lo que tiene que decir, y lo dice en SQL y no en un
// comentario. Es una red, no una garantía. La garantía es ejecutarla.
//
// POR QUÉ EXISTE. La primera versión era `create table if not exists` y poco
// más, y `if not exists` NO VALIDA LA FORMA: con una tabla homónima de otras
// columnas no lanza, y la migración parece correcta mientras el código falla en
// producción. Además se ejecutó sin revocar permisos sobre una tabla cuyo
// contenido son solo correos.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let fallos = 0;
const ok = (c, m) => { if (c) console.log("  ✓", m); else { console.log("  ✗", m); fallos++; } };

const BRUTO = readFileSync(join(RAIZ, "db", "reserva-alta-2026-09-18.sql"), "utf8");

// ⚠️ FUERA LOS COMENTARIOS, Y LO PRIMERO DE TODO. Un `-- revoke all ...` no
// revoca nada, y una comprobación que lo acepte es peor que no tenerla: da luz
// verde a un fichero que no hace nada.
const SQL = BRUTO
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
const plano = SQL.toLowerCase().replace(/\s+/g, " ");

console.log("── el fichero ejecutable, sin comentarios ──");
ok(SQL.trim().length > 0, "queda SQL después de quitar los comentarios");
ok(!/--/.test(SQL), "y no queda ningún comentario de línea dentro");

console.log("\n── esquema explícito: nada depende del search_path ──");
{
  // ⚠️ SE BUSCAN IDENTIFICADORES, NO CADENAS. El nombre aparece también entre
  // comillas en las consultas de catálogo —`relname = 'reservas_alta'`— y ahí
  // no se cualifica: el esquema se fija con `nspname = 'public'`, que se
  // comprueba aparte. Sin quitar los literales, esta comprobación acusaría a un
  // SQL correcto.
  //
  // Los nombres de constraint (`reservas_alta_pkey`, `..._normalizado_ck`) no
  // hacen falta excluirlos: `\b` no corta antes de un guion bajo.
  const sinLiterales = SQL.replace(/'(?:[^']|'')*'/g, "''");
  const sinCualificar = [...sinLiterales.matchAll(/(?<!public\.)\breservas_alta\b/g)];
  ok(sinCualificar.length === 0,
     `todas las referencias a la tabla van con public. (${sinCualificar.length} sin cualificar)`);
  ok(/create table public\.reservas_alta/i.test(SQL), "el CREATE TABLE va cualificado");
  ok(/alter table public\.reservas_alta enable row level security/i.test(SQL), "el ALTER, también");
  ok(/on table public\.reservas_alta from/i.test(SQL), "los REVOKE");
  ok(/on table public\.reservas_alta to service_role/i.test(SQL), "el GRANT");
  ok(/comment on table public\.reservas_alta/i.test(SQL), "y el COMMENT");
  // Las consultas de catálogo tienen que filtrar por esquema.
  const cuantasColumnas = (SQL.match(/information_schema\.columns/g) || []).length;
  const cuantosFiltros  = (SQL.match(/table_schema\s*=\s*'public'/g) || []).length;
  ok(cuantasColumnas > 0 && cuantosFiltros >= cuantasColumnas,
     `cada consulta a information_schema filtra table_schema='public' (${cuantosFiltros}/${cuantasColumnas})`);
  ok(/nspname\s*=\s*'public'/.test(SQL),
     "y la búsqueda de la tabla en el catálogo también fija el esquema");
}

console.log("\n── transacción ──");
ok(/^\s*begin\s*;/im.test(SQL), "abre transacción");
ok(/^\s*commit\s*;/im.test(SQL), "y la cierra");
ok(SQL.indexOf("begin;") < SQL.indexOf("commit;"), "en ese orden");
ok(SQL.lastIndexOf("notify pgrst") > SQL.indexOf("commit;"),
   "y la recarga de PostgREST va DESPUÉS del commit");

console.log("\n── contrato de la tabla ──");
ok(/email\s+text\s+not null/i.test(SQL), "email text NOT NULL");
ok(/propietario_id\s+uuid\s+not null/i.test(SQL), "propietario_id uuid NOT NULL");
ok(/creado\s+timestamptz\s+not null\s+default\s+now\(\)/i.test(SQL),
   "creado timestamptz NOT NULL DEFAULT now()");
ok(/primary key\s*\(\s*email\s*\)/i.test(SQL), "PRIMARY KEY solo sobre email");
ok(/constraint\s+reservas_alta_email_normalizado_ck/i.test(SQL),
   "el check de normalización, con nombre estable");
ok(/check\s*\(\s*email\s*=\s*lower\(btrim\(email\)\)\s*\)/i.test(SQL),
   "y con la expresión email = lower(btrim(email))");

console.log("\n── idempotencia ESTRUCTURAL, no `if not exists` ──");
{
  ok(!/create table if not exists/i.test(SQL),
     "no se apoya en `create table if not exists`, que no valida la forma");
  ok(/do\s+\$/i.test(SQL), "hay un bloque DO que puede comprobar y abortar");
  // Validación de cada columna.
  for (const col of ["email", "propietario_id", "creado"]) {
    ok(new RegExp(`column_name\\s*=\\s*'${col}'`).test(SQL),
       `comprueba la columna ${col}`);
  }
  ok(/data_type/.test(SQL) && /<>\s*'text'/.test(SQL) && /<>\s*'uuid'/.test(SQL)
     && /'timestamp with time zone'/.test(SQL),
     "valida los TIPOS de las tres columnas");
  ok((SQL.match(/is_nullable/g) || []).length >= 3 && /<>\s*'no'/i.test(SQL),
     "valida que ninguna admita NULL");
  ok(/column_default/.test(SQL) && /now\(\)/.test(SQL), "y el default de creado");
  ok(/indisprimary/.test(SQL), "comprueba que hay PRIMARY KEY");
  ok(/array\['email'\]/i.test(SQL), "y que es EXCLUSIVAMENTE sobre email");
  ok(/pg_get_constraintdef/.test(SQL),
     "lee la DEFINICIÓN del check, no solo su nombre");
  const excepciones = (SQL.match(/raise exception/gi) || []).length;
  ok(excepciones >= 8,
     `cada incompatibilidad aborta con su mensaje (${excepciones} excepciones)`);
}

console.log("\n── el check se añade sin tocar datos ──");
{
  ok(/is distinct from lower\(btrim\(email\)\)/i.test(SQL),
     "antes de añadirlo, cuenta las filas que NO cumplen");
  const i = SQL.search(/is distinct from lower\(btrim\(email\)\)/i);
  const j = SQL.search(/add constraint\s+reservas_alta_email_normalizado_ck/i);
  ok(i > -1 && j > -1 && i < j, "y esa comprobación va ANTES del ALTER que lo añade");
  ok(/raise\s+exception[\s\S]{0,200}sin normalizar/i.test(SQL),
     "si alguna no cumple, aborta con un mensaje claro");
}

console.log("\n── nada destructivo ──");
{
  ok(!/drop\s+table/i.test(SQL), "sin DROP TABLE");
  ok(!/\bdelete\s+from\b/i.test(SQL), "sin DELETE");
  ok(!/\bupdate\s+public\.reservas_alta\b/i.test(SQL) && !/\bupdate\s+reservas_alta\b/i.test(SQL),
     "sin UPDATE de reservas");
  ok(!/insert\s+into/i.test(SQL), "sin INSERT de datos de reparación");
  ok(!/alter\s+table[^;]*rename/i.test(SQL), "sin renombrados");
  // Y que no toque las tablas del sistema que ya existían.
  for (const t of ["usuarios", "accesos", "config_app", "config_version"]) {
    ok(!new RegExp(`\\b(alter|drop|update|delete|insert)\\b[^;]*\\b${t}\\b`, "i").test(SQL),
       `no toca ${t}`);
  }
}

console.log("\n── RLS y grants ──");
{
  ok(/enable row level security/i.test(SQL), "RLS activada");
  ok(!/create policy/i.test(SQL), "y sin ninguna policy: nadie entra por ahí");
  for (const rol of ["public", "anon", "authenticated"]) {
    ok(new RegExp(`revoke all privileges on table public\\.reservas_alta from ${rol}\\s*;`, "i").test(SQL),
       `revocado ${rol.toUpperCase()}`);
  }
  ok(/grant\s+select\s*,\s*insert\s+on table public\.reservas_alta\s+to\s+service_role/i.test(SQL),
     "y service_role recibe SELECT e INSERT explícitamente");
  ok(!/grant[^;]*\b(update|delete|truncate)\b/i.test(SQL),
     "solo eso: ni UPDATE, ni DELETE, ni TRUNCATE");
  ok(!/grant[^;]*\b(anon|authenticated)\b/i.test(SQL),
     "y nada para anon ni authenticated");
}

console.log("\n── lo que el código necesita y la migración concede ──");
{
  // Los dos privilegios que pide api/_acceso.js, ni uno más.
  const acceso = readFileSync(join(RAIZ, "api", "_acceso.js"), "utf8");
  const reserva = acceso.slice(acceso.indexOf("async function reservarPropietario"),
                               acceso.indexOf("async function pedir"));
  ok(/supabaseInsert\("reservas_alta"/.test(reserva), "el código INSERTA en la tabla");
  ok(/supabaseSelect\("reservas_alta"/.test(reserva), "y SELECCIONA de ella");
  ok(!/supabaseUpdate\("reservas_alta"|supabaseDelete\("reservas_alta"/.test(acceso),
     "y no la actualiza ni borra: por eso el grant es solo SELECT e INSERT");
}

console.log("\n⚠️  NO SE HA EJECUTADO ESTE SQL. No hay PostgreSQL en esta máquina");
console.log("    (psql, docker, initdb: ninguno; DATABASE_URL vacío), así que nada");
console.log("    de lo anterior prueba que corra. Es análisis estático del fichero.");

console.log(fallos ? `\n${fallos} test(s) FALLARON` : "\n✅ TODOS LOS TESTS VERDES");
process.exit(fallos ? 1 : 0);
