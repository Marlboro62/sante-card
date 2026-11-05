/*
 * Carte Santé : activité, fréquence cardiaque et sommeil du Mi Band 7 (intégration ha-miband),
 * complétés par les mesures Health Connect du téléphone choisi (application Home Assistant).
 *
 *   custom:sante-card
 */

(() => {
const CARD_VERSION = "0.1.0";

/* ------------------------------------------------------------- utilitaires */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BAD = new Set(["unknown", "unavailable", "none", "None", ""]);

/** Nombre lu dans un état, ou null. « 1:05:00 » donne des minutes. */
const num = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (BAD.has(s)) return null;
  const hms = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3] || 0) / 60;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const fmt = (n, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Minutes en « 1 h 05 » ou « 25 min ». */
const hm = (min) => {
  if (min === null) return "—";
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};

/** Minutes en « 01:05:00 ». */
const hms = (min) => {
  if (min === null) return "—";
  const s = Math.max(0, Math.round(min * 60));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":");
};

const relTime = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = (t - Date.now()) / 1000;
  const a = Math.abs(s);
  const txt = a < 90 ? "moins d'une minute" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} j`;
  return s >= 0 ? `dans ${txt}` : `il y a ${txt}`;
};

/** États traduits en français, par domaine puis généraux. */
const STATE_FR = {
  cover: { open: "Ouvert", closed: "Fermé", opening: "Ouverture…", closing: "Fermeture…", stopped: "Arrêté" },
  alarm_control_panel: {
    disarmed: "désarmée", armed_away: "mode absent", armed_home: "mode présence", armed_night: "mode nuit",
    armed_vacation: "mode vacances", armed_custom_bypass: "mode personnalisé", arming: "armement…",
    pending: "en attente…", triggered: "déclenchée !", disarming: "désarmement…",
  },
  vacuum: { cleaning: "Nettoyage", docked: "Sur la base", returning: "Retour à la base", idle: "Inactif", paused: "En pause", error: "Erreur" },
  lock: { locked: "Verrouillé", unlocked: "Déverrouillé", locking: "Verrouillage…", unlocking: "Déverrouillage…", jammed: "Bloqué", open: "Ouvert" },
  media_player: { playing: "Lecture", paused: "Pause", idle: "Inactif", off: "Éteint", on: "Allumé", standby: "Veille", buffering: "Chargement" },
  "": { on: "On", off: "Off", home: "Présent", not_home: "Absent", unavailable: "Indisponible", unknown: "Inconnu", open: "Ouvert", closed: "Fermé" },
};
const stateFr = (s, domain = "") => {
  if (s === null || s === undefined) return "—";
  const k = String(s);
  return STATE_FR[domain]?.[k] ?? STATE_FR[""][k] ?? k;
};

const domainOf = (id) => String(id || "").split(".")[0];
const friendly = (o) => o?.attributes?.friendly_name || o?.entity_id || "";

/* ------------------------------------------------- modèles de texte {…} */

/**
 * Remplace les {…} d'un texte :
 *   {state} {unit} {name} {attr:nom}            l'entité de l'élément
 *   {sensor.x} {sensor.x:attribut}             une autre entité
 * suivis de filtres séparés par | :
 *   0 1 2 (décimales), k (÷ 1000), hm (minutes → 1 h 05), hms (→ 01:05:00),
 *   date, time, rel (il y a…), fr (état traduit), upper, lower, int
 */
const TPL_RE = /\{([a-z_]+\.[a-z0-9_]+(?::[a-z0-9_]+)?|state|unit|name|attr:[a-zA-Z0-9_]+)((?:\|[a-z0-9_]+)*)\}/g;

function applyFilters(v, filters, domain) {
  let out = v;
  for (const f of filters) {
    if (f === "k") out = num(out) === null ? out : num(out) / 1000;
    else if (/^\d$/.test(f)) out = num(out) === null ? out : fmt(num(out), Number(f));
    else if (f === "int") out = num(out) === null ? out : Math.round(num(out));
    else if (f === "hm") out = hm(num(out));
    else if (f === "hms") out = hms(num(out));
    else if (f === "date") out = Number.isFinite(new Date(out).getTime()) ? new Date(out).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : out;
    else if (f === "time") out = Number.isFinite(new Date(out).getTime()) ? new Date(out).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : out;
    else if (f === "rel") out = relTime(out) ?? out;
    else if (f === "fr") out = stateFr(out, domain);
    else if (f === "upper") out = String(out ?? "").toUpperCase();
    else if (f === "lower") out = String(out ?? "").toLowerCase();
  }
  if (out === null || out === undefined || BAD.has(String(out))) return "—";
  if (typeof out === "number") return Number.isInteger(out) ? String(out) : fmt(out, 1);
  return String(out);
}

/** Texte brut, {…} remplacés. */
function tplText(str, hass, eid) {
  if (str === null || str === undefined) return "";
  return String(str).replace(TPL_RE, (m, key, filt) => {
    const filters = filt ? filt.slice(1).split("|") : [];
    const so = eid ? hass?.states?.[eid] : null;
    if (key === "unit") return so?.attributes?.unit_of_measurement || "";
    if (key === "name") return friendly(so);
    if (key === "state") return applyFilters(so?.state, filters, domainOf(eid));
    if (key.startsWith("attr:")) return applyFilters(so?.attributes?.[key.slice(5)], filters, domainOf(eid));
    const [id, at] = key.split(":");
    const o = hass?.states?.[id];
    if (!o) return "—";
    return applyFilters(at ? o.attributes?.[at] : o.state, filters, domainOf(id));
  });
}

/** Texte prêt pour le HTML : échappé, retours à la ligne conservés. */
const tpl = (str, hass, eid) => esc(tplText(str, hass, eid)).replace(/\n/g, "<br>");

/** Texte choisi selon des conditions : une chaîne, ou une liste de { if, text }. */
function pickText(spec, hass, eid) {
  if (spec === null || spec === undefined) return null;
  if (!Array.isArray(spec)) return tpl(spec, hass, eid);
  for (const it of spec) {
    if (typeof it === "string") return tpl(it, hass, eid);
    if (cond(it.if, hass, eid)) return tpl(it.text, hass, eid);
  }
  return null;
}

/* --------------------------------------------------------------- conditions */

const hhmm = (s) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(s)); return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null; };

/**
 * Condition d'affichage ou de couleur :
 *   { state: on }  { state: [a, b] }  { state_not: off }  { above: 0 }  { below: 30 }
 *   { entity: autre.entite, … }  { attribute: nom, … }  { after: "16:00" }  { before: "8:00" }
 *   { weekday: [mon, tue] }  { or: [ … ] }  { and: [ … ] }  { not: { … } }
 * Une liste vaut un « et ». Sans entité précisée, c'est celle de l'élément.
 */
function cond(c, hass, eid) {
  if (c === null || c === undefined) return true;
  if (Array.isArray(c)) return c.every((x) => cond(x, hass, eid));
  if (typeof c !== "object") return String(hass?.states?.[eid]?.state) === String(c);
  if (c.or) return [].concat(c.or).some((x) => cond(x, hass, eid));
  if (c.and && !cond(c.and, hass, eid)) return false;
  if (c.not && cond(c.not, hass, eid)) return false;
  const id = c.entity || eid;
  const o = id ? hass?.states?.[id] : null;
  const s = c.attribute ? o?.attributes?.[c.attribute] : o?.state;
  if ("state" in c && ![].concat(c.state).map(String).includes(String(s))) return false;
  if ("state_not" in c && [].concat(c.state_not).map(String).includes(String(s))) return false;
  if ("above" in c && !(num(s) !== null && num(s) > Number(c.above))) return false;
  if ("below" in c && !(num(s) !== null && num(s) < Number(c.below))) return false;
  if ("after" in c || "before" in c) {
    const d = new Date();
    const now = d.getHours() * 60 + d.getMinutes();
    if ("after" in c && !(now >= hhmm(c.after))) return false;
    if ("before" in c && !(now < hhmm(c.before))) return false;
  }
  if (c.weekday) {
    const wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
    if (![].concat(c.weekday).includes(wd)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ couleurs */

const COLORS = {
  green: "var(--m-green)", vert: "var(--m-green)",
  orange: "var(--m-orange)",
  red: "var(--m-red)", rouge: "var(--m-red)",
  yellow: "var(--m-yellow)", jaune: "var(--m-yellow)",
  blue: "var(--m-blue)", bleu: "var(--m-blue)",
  "blue-dark": "var(--m-blue-dark)", "bleu-fonce": "var(--m-blue-dark)",
  purple: "var(--m-purple)", violet: "var(--m-purple)",
  brown: "var(--m-brown)", marron: "var(--m-brown)",
  pop: "var(--m-pop)", accent: "var(--m-pop)",
  grey: "var(--m-chip)", gray: "var(--m-chip)", gris: "var(--m-chip)",
  white: "var(--m-card)", blanc: "var(--m-card)",
  black: "var(--m-text)", noir: "var(--m-text)",
  none: "transparent",
};
/** Couleur nommée, ou valeur CSS simple (#hex, rgb(), var()). */
const color = (c) => {
  if (c === null || c === undefined || c === "") return null;
  const k = String(c).trim();
  if (COLORS[k]) return COLORS[k];
  return /^[#\w(),.%\s-]+$/.test(k) ? k : null;
};
/** Première couleur dont la condition est vraie : [{ above: 60, color: green }, { color: red }]. */
const levelColor = (levels, hass, eid) => {
  for (const l of [].concat(levels || [])) if (cond(l, hass, eid)) return color(l.color);
  return null;
};
/** Couleur de texte lisible sur une couleur de fond « pastel » ou foncée. */
const onColor = (c) => (/blue-dark|bleu-fonce|m-text|m-blue-dark/.test(String(c)) ? "var(--m-card)" : "var(--m-on-pop)");

/* ------------------------------------------------------- pièces et étages */

const regOf = (hass, eid) => hass?.entities?.[eid];
const areaOf = (hass, eid) => {
  const e = regOf(hass, eid);
  if (!e) return null;
  return e.area_id || hass.devices?.[e.device_id]?.area_id || null;
};
/** Entité « visible » : ni masquée, ni de configuration / diagnostic. */
const shown = (hass, eid) => {
  const e = regOf(hass, eid);
  return !e || (!e.hidden && !e.hidden_by && !e.entity_category);
};
const floorsOf = (hass) => Object.values(hass?.floors || {}).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
const areasOf = (hass) => Object.values(hass?.areas || {});
/** Icône d'étage selon le niveau. */
const floorIcon = (f) => f?.icon || (f?.level < 0 ? "mdi:home-floor-negative-1" : f?.level > 0 ? `mdi:home-floor-${Math.min(3, f.level)}` : "mdi:home-floor-0");

const entitiesIn = (hass, areaId, domain, test) =>
  Object.keys(hass?.states || {}).filter((id) => domainOf(id) === domain && areaOf(hass, id) === areaId && shown(hass, id) && (!test || test(hass.states[id])));

/* ----------------------------------------------------- historique partagé */

const BUS = new EventTarget();
const HIST = new Map(); // entity_id → { at, pts, busy }

/** Points [t, v] des dernières `hours` heures. Chargés une fois pour toutes les cartes, renouvelés toutes les 10 min. */
function historyOf(hass, id, hours = 24) {
  if (!id || !hass?.callApi) return null;
  const key = `${id}|${hours}`;
  const c = HIST.get(key);
  if (c && (c.busy || Date.now() - c.at < 10 * 60e3)) return c.pts;
  HIST.set(key, { at: Date.now(), pts: c?.pts || null, busy: true });
  const end = Date.now();
  const start = end - hours * 3600e3;
  const path = `history/period/${encodeURIComponent(new Date(start).toISOString())}?filter_entity_id=${encodeURIComponent(id)}` +
    `&end_time=${encodeURIComponent(new Date(end).toISOString())}&minimal_response&no_attributes`;
  hass.callApi("GET", path).then((rows) => {
    const pts = (Array.isArray(rows?.[0]) ? rows[0] : [])
      .map((r) => [new Date(r.last_changed || r.last_updated).getTime(), num(r.state)])
      .filter((p) => Number.isFinite(p[0]) && p[1] !== null);
    HIST.set(key, { at: Date.now(), pts, busy: false });
  }).catch(() => {
    HIST.set(key, { at: Date.now(), pts: c?.pts || [], busy: false });
  }).finally(() => BUS.dispatchEvent(new CustomEvent("hist", { detail: id })));
  return c?.pts || null;
}

/** Courbe SVG (ligne et aire) des points, dans une boîte w × h. */
function spark(pts, w = 300, h = 60, hours = 24, span = 1) {
  if (!pts || pts.length < 2) return "";
  const end = Date.now();
  const start = end - hours * 3600e3;
  const vs = pts.map((p) => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < span) { lo -= span / 2; hi += span / 2; }
  const x = (t) => ((Math.max(t, start) - start) / (end - start)) * w;
  const y = (v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
  let d = "";
  pts.forEach((p, i) => { d += `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)} `; });
  d += `L${w},${y(pts[pts.length - 1][1]).toFixed(1)}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
    `<path class="spark-a" d="${d} L${w},${h} L${x(pts[0][0]).toFixed(1)},${h} Z"/><path class="spark-l" d="${d}"/></svg>`;
}

/* ---------------------------------------------------------------- actions */

const fire = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

function navigate(path) {
  if (!path) return;
  const url = path.startsWith("#") ? `${location.pathname}${location.search}${path}` : path;
  history.pushState(null, "", url);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/* ------------------------------------------------------------------ thèmes */

/** maison : fond, texte et pastilles suivent le thème Home Assistant de l'utilisateur (--card-background-color,
 *  --primary-text-color…), avec les touches de couleur pastel ; --gray000 / --gray800 / --active-pop… restent prioritaires ;
 *  v2 : style MyElectricalData bleu nuit ; auto : MyElectricalData clair ou sombre ; ha : couleurs du thème Home Assistant. */
const themeClass = (theme, hass) => {
  const dark = hass?.themes?.darkMode === true;
  if (theme === "v2") return "th-v2";
  if (theme === "auto") return dark ? "th-v2" : "th-v2 light";
  if (theme === "ha") return "th-ha";
  if (theme === "obd") return "th-obd";
  return dark ? "th-maison dark" : "th-maison";
};

const BASE_STYLE = `<style>
:host { display: block; font-family: var(--ha-font-family-body, inherit); font-synthesis-weight: var(--maison-font-synthesis, auto); }
ha-card {
  --m-radius: 22px;
  background: var(--m-card); color: var(--m-text); border: none; box-shadow: var(--maison-shadow, none);
  border-radius: var(--m-radius); overflow: hidden; position: relative; height: 100%; box-sizing: border-box;
  font-variant-numeric: tabular-nums; container-type: inline-size; -webkit-tap-highlight-color: transparent;
}
ha-card.th-maison {
  --m-card: var(--gray000, var(--ha-card-background, var(--card-background-color, #f4f3f1)));
  --m-text: var(--gray800, var(--primary-text-color, #2b2c2f));
  --m-chip: var(--gray200, color-mix(in srgb, var(--m-text) 9%, var(--m-card)));
  --m-faint: var(--gray400, var(--disabled-text-color, #b4b2ad)); --m-pop: var(--active-pop, #f6b38b); --m-on-pop: var(--active-on-pop, var(--gray800, #2b2c2f));
  --m-green: var(--active-green, #94d3a2); --m-orange: var(--active-orange, #f5c27a); --m-red: var(--active-red, #f08c84);
  --m-yellow: var(--active-yellow, #f3dc76); --m-blue: var(--active-blue, #8eb5f5); --m-blue-dark: var(--active-blue-dark, #3f5d8f);
  --m-purple: var(--active-purple, #c4a8f4); --m-brown: var(--active-brown, #b98a63); --m-acc: var(--pop, #d2703a);
}
ha-card.th-maison.dark {
  --m-card: var(--gray000, var(--ha-card-background, var(--card-background-color, #24272c)));
  --m-text: var(--gray800, var(--primary-text-color, #eceef1));
  --m-chip: var(--gray200, color-mix(in srgb, var(--m-text) 12%, var(--m-card)));
  --m-faint: var(--gray400, var(--disabled-text-color, #6d737c)); --m-pop: var(--active-pop, #f0a274); --m-on-pop: var(--active-on-pop, #1f2124);
  --m-green: var(--active-green, #6fbf83); --m-orange: var(--active-orange, #e9ad5b); --m-red: var(--active-red, #e5776e);
  --m-yellow: var(--active-yellow, #e2c95a); --m-blue: var(--active-blue, #6f9de8); --m-blue-dark: var(--active-blue-dark, #4a6fae);
  --m-purple: var(--active-purple, #a98be6); --m-brown: var(--active-brown, #a77a55); --m-acc: var(--pop, #f0a274);
}
ha-card.th-v2 {
  --m-card: #1a2434; --m-chip: #212d40; --m-text: #e7edf5; --m-faint: #5d6e88; --m-pop: #1d93e3; --m-on-pop: #ffffff;
  --m-green: #5fcf8a; --m-orange: #f0a33a; --m-red: #ee4a4a; --m-yellow: #f7c948; --m-blue: #1d93e3; --m-blue-dark: #2b56a8;
  --m-purple: #8c6be0; --m-brown: #a77a55; --m-acc: #1d93e3; --m-lime: #96d21f;
  border: 1px solid #2f3d55; --m-radius: 18px;
}
ha-card.th-v2.light {
  --m-card: #ffffff; --m-chip: #eef2f7; --m-text: #1a2434; --m-faint: #a3afc0; --m-pop: #1673b8; --m-on-pop: #ffffff;
  --m-green: #1d8a4b; --m-orange: #b0640a; --m-red: #c62f2f; --m-yellow: #8a6500; --m-blue: #1673b8; --m-blue-dark: #24508f; --m-acc: #1673b8; --m-lime: #4c8a0b;
  border-color: #dbe2ec; box-shadow: 0 1px 3px rgba(26, 36, 52, .08);
}
ha-card.th-ha {
  --m-card: var(--ha-card-background, var(--card-background-color, #fff));
  --m-chip: color-mix(in srgb, var(--primary-text-color, #000) 8%, transparent);
  --m-text: var(--primary-text-color, #1f2937); --m-faint: var(--disabled-text-color, #9aa0a6);
  --m-pop: var(--accent-color, #ff9800); --m-on-pop: var(--text-accent-color, #fff);
  --m-green: var(--success-color, #43a047); --m-orange: var(--warning-color, #ffa600); --m-red: var(--error-color, #db4437);
  --m-yellow: var(--state-sensor-battery-medium-color, #f3c623); --m-blue: var(--info-color, #039be5);
  --m-blue-dark: var(--primary-color, #03a9f4); --m-purple: #9c6ade; --m-brown: #a77a55; --m-acc: var(--accent-color, #ff9800);
  --m-radius: var(--ha-card-border-radius, 12px);
  border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
}
/* obd : tableau de bord d'application OBD, cadrans noirs à lunette chromée, arc rouge, chiffres bleu cyan */
ha-card.th-obd {
  --m-card: #050608; --m-chip: #0b0e12; --m-text: #cfe8ff; --m-faint: #3b4a5c; --m-pop: #35b5ff; --m-on-pop: #02121f;
  --m-green: #27d36c; --m-orange: #ff9a1f; --m-red: #ff2414; --m-yellow: #ffd23a; --m-blue: #35b5ff; --m-blue-dark: #1b6fb0;
  --m-purple: #8c6be0; --m-brown: #a77a55; --m-acc: #35b5ff; --m-lime: #35b5ff; --m-lcd: #4cc3ff;
  border: 1px solid #1a2028; --m-radius: 16px;
  background: radial-gradient(120% 90% at 50% 0%, #11161c 0%, #050608 60%);
}
ha-card { --m-muted: color-mix(in srgb, var(--m-text) 62%, transparent); --m-line: color-mix(in srgb, var(--m-text) 12%, transparent); }
ha-icon { --mdc-icon-size: 24px; display: inline-flex; }
[data-a], [data-h] { cursor: pointer; }
[data-a]:focus-visible, [data-h]:focus-visible, button:focus-visible { outline: 2px solid var(--m-pop); outline-offset: 2px; }
button { font: inherit; color: inherit; }
.ls { letter-spacing: .3em; }
.muted { color: var(--m-muted); }
/* barre de boutons ronds dans une pilule */
.rbar { display: flex; gap: 4px; padding: 5px; border-radius: 50px; background: var(--m-chip); }
.rbar.col { flex-direction: column; }
.rb { all: unset; box-sizing: border-box; width: 44px; height: 44px; flex: 1 1 44px; max-width: 64px; min-width: 38px; border-radius: 50px; display: grid; place-items: center;
  cursor: pointer; color: var(--m-text); transition: background .2s; }
.rbar.col .rb { flex: none; width: 44px; }
.rb ha-icon { --mdc-icon-size: 24px; }
.rb.on { background: var(--m-pop); color: var(--m-on-pop); }
.rb.warn { background: var(--m-red); color: var(--m-on-pop); }
.rb:focus-visible { outline: 2px solid var(--m-pop); outline-offset: 1px; }
.spark { width: 100%; height: 100%; display: block; }
.spark-l { fill: none; stroke: var(--m-pop); stroke-width: 2; vector-effect: non-scaling-stroke; }
.spark-a { fill: var(--m-pop); opacity: .12; stroke: none; }
.bar-p { height: 8px; border-radius: 8px; background: var(--m-line); overflow: hidden; }
.bar-p i { display: block; height: 100%; border-radius: 8px; background: var(--m-pop); }
.empty { padding: 16px; font-size: .9rem; color: var(--m-muted); }
.empty b { color: var(--m-text); display: block; margin-bottom: 4px; }
@keyframes m-flash { 0%, 100% { opacity: .85; } 50% { opacity: .15; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>`;

/* -------------------------------------------------------------- carte de base */

class MaisonCard extends HTMLElement {
  static get DEFAULTS() { return { theme: "maison" }; }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Configuration invalide");
    this._config = { ...this.constructor.DEFAULTS, ...config };
    this._check?.(this._config);
    this._ui = this._ui || {};
    this._sig = null;
    this._res = null;
    if (!this.shadowRoot) this._setup();
    if (this._hass) this._update(true);
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first || this._regKey !== this._registryKey()) this._res = null;
    this._update(false);
  }

  get hass() { return this._hass; }

  set editMode(v) { this._editMode = v; this._update(true); }

  get editMode() { return this._editMode; }

  set preview(v) { this._preview = v; this._update(true); }

  get preview() { return this._preview; }

  connectedCallback() {
    if (!this._onHist) {
      this._onHist = (ev) => { if (this._histIds?.includes(ev.detail)) this._update(true); };
    }
    BUS.addEventListener("hist", this._onHist);
    this._timer = setInterval(() => this._tick?.(), 60e3);
    if (this._hass && this._config) this._update(true);
  }

  disconnectedCallback() {
    BUS.removeEventListener("hist", this._onHist);
    clearInterval(this._timer);
  }

  getCardSize() { return 3; }

  /** Clé du registre : la détection automatique est refaite quand les entités ou pièces changent. */
  _registryKey() {
    const h = this._hass;
    return `${Object.keys(h?.states || {}).length}|${Object.keys(h?.entities || {}).length}|${Object.keys(h?.areas || {}).length}`;
  }

  /** Résultat de la détection automatique, gardé en cache. */
  _resolved() {
    if (!this._res) {
      this._regKey = this._registryKey();
      this._res = this._resolve ? this._resolve(this._config, this._hass) : {};
    }
    return this._res;
  }

  /** Entités dont un changement redessine la carte. */
  _ids() { return []; }

  _update(force) {
    if (!this._config || !this._hass || !this.shadowRoot) return;
    if (this._busy && !force) return;
    let sig = `${this._hass.themes?.darkMode ? "d" : "l"}|${JSON.stringify(this._ui)}`;
    for (const id of this._ids()) {
      const o = this._hass.states[id];
      sig += `|${id}=${o ? `${o.state}@${o.last_updated || o.last_changed || ""}` : "-"}`;
    }
    if (!force && sig === this._sig) return;
    this._sig = sig;
    this._draw();
  }

  _tick() { this._update(true); }

  _draw() {
    this._acts = [];
    this._histIds = [];
    let body;
    try {
      body = this._render(this._config, this._hass);
    } catch (err) {
      console.error(`[${this.localName}]`, err);
      body = `<div class="empty"><b>Erreur d'affichage</b>${esc(err?.message || err)}</div>`;
    }
    const cls = `${themeClass(this._config.theme, this._hass)} ${this._cardClass ? this._cardClass() : ""}`;
    const style = this.constructor.STYLE || "";
    this.shadowRoot.innerHTML = `${BASE_STYLE}${style}<ha-card class="${cls}">${body}</ha-card>`;
    this._after?.();
  }

  /** Historique d'une entité (courbe), la carte se redessine quand il arrive. */
  _hist(id, hours = 24) {
    if (!id) return null;
    this._histIds.push(id);
    return historyOf(this._hass, id, hours);
  }

  /** Enregistre une action et renvoie son numéro, pour data-a="…" (clic) ou data-h="…" (appui long). */
  _a(act) {
    if (!act || act.action === "none") return "";
    this._acts.push(act);
    return String(this._acts.length - 1);
  }

  /** Attributs d'un élément cliquable : clic, appui long, accessibilité. */
  _click(tap, hold, label) {
    const t = this._a(tap);
    const h = this._a(hold);
    let s = "";
    if (t !== "") s += ` data-a="${t}"`;
    if (h !== "") s += ` data-h="${h}"`;
    if (s) s += ` role="button" tabindex="0"`;
    if (label) s += ` aria-label="${esc(label)}"`;
    return s;
  }

  /** Action de la configuration (tap_action…), ou action par défaut. */
  _cfgAct(cfg, def, entity) {
    if (cfg === undefined || cfg === null) return def ? { entity, ...def } : null;
    if (typeof cfg === "string") return { action: cfg, entity };
    return { entity, ...cfg };
  }

  _setup() {
    this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    let timer = null;
    let held = false;
    let start = null;
    root.addEventListener("pointerdown", (ev) => {
      held = false;
      if (ev.target.closest?.("input[type=range]")) this._busy = true;
      const el = ev.target.closest?.("[data-h]");
      if (!el) return;
      start = [ev.clientX, ev.clientY];
      clearTimeout(timer);
      timer = setTimeout(() => {
        held = true;
        this._run(Number(el.dataset.h), el);
      }, 500);
    });
    root.addEventListener("pointermove", (ev) => {
      if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 12) clearTimeout(timer);
    });
    const end = () => {
      clearTimeout(timer);
      start = null;
      if (this._busy) {
        this._busy = false;
        setTimeout(() => this._update(true), 50);
      }
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    root.addEventListener("click", (ev) => {
      if (held) { held = false; ev.stopPropagation(); return; }
      const el = ev.target.closest?.("[data-a]");
      if (!el) return;
      ev.stopPropagation();
      this._run(Number(el.dataset.a), el);
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target.closest?.("[data-chg]");
      if (el) this._run(Number(el.dataset.chg), el, el.value);
    });
    root.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches?.("[role=button]")) {
        ev.preventDefault();
        ev.target.click();
      }
    });
    root.addEventListener("contextmenu", (ev) => { if (ev.target.closest?.("[data-h]")) ev.preventDefault(); });
  }

  _run(i, el, value) {
    const act = this._acts?.[i];
    if (!act) return;
    if (act.confirm) {
      const key = `${i}:${act.entity || act.perform_action || act.service || ""}`;
      if (this._ui.confirm !== key) {
        this._ui = { ...this._ui, confirm: key };
        this._update(true);
        clearTimeout(this._confirmTimer);
        this._confirmTimer = setTimeout(() => { this._ui = { ...this._ui, confirm: null }; this._update(true); }, 3000);
        return;
      }
      this._ui = { ...this._ui, confirm: null };
    }
    this._exec(act, value);
  }

  _exec(act, value) {
    const h = this._hass;
    const e = act.entity;
    switch (act.action) {
      case "fn":
        act.fn(value);
        break;
      case "ui":
        this._ui = { ...this._ui, ...act.set };
        this._update(true);
        break;
      case "toggle": {
        const d = domainOf(e);
        if (d === "lock") h.callService("lock", h.states[e]?.state === "locked" ? "unlock" : "lock", { entity_id: e });
        else if (d === "button" || d === "input_button") h.callService(d, "press", { entity_id: e });
        else if (d === "scene" || d === "script") h.callService(d, "turn_on", { entity_id: e });
        else h.callService("homeassistant", "toggle", { entity_id: e });
        break;
      }
      case "more-info":
        if (e) fire(this, "hass-more-info", { entityId: e });
        break;
      case "navigate":
        navigate(act.navigation_path || act.path);
        break;
      case "url":
        window.open(act.url_path || act.url, "_blank", "noopener");
        break;
      case "call-service":
      case "perform-action": {
        const svc = act.perform_action || act.service;
        if (!svc || !svc.includes(".")) break;
        const [d, s] = svc.split(".");
        const data = { ...(act.data || act.service_data || {}) };
        if (value !== undefined && act.value_key) data[act.value_key] = act.value_num ? Number(value) : value;
        h.callService(d, s, data, act.target);
        break;
      }
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------ éditeur visuel */

const THEME_SELECT = {
  name: "theme",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "maison", label: "Pastel : suit votre thème Home Assistant, avec des touches pastel" },
        { value: "v2", label: "Style MyElectricalData (bleu nuit)" },
        { value: "auto", label: "Style MyElectricalData, clair ou sombre selon Home Assistant" },
        { value: "ha", label: "Thème Home Assistant" },
      ],
    },
  },
};

/** Éditeur : formulaire Home Assistant. Les options absentes du formulaire (listes en YAML) sont conservées. */
function makeEditor(schema, labels, defaults, helper, hooks = {}) {
  return class extends HTMLElement {
    setConfig(config) {
      this._config = { ...config };
      this._draw();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
      else this._draw();
    }

    _draw() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        if (helper) {
          const p = document.createElement("p");
          p.style.cssText = "margin:0 0 12px;font-size:.88rem;color:var(--secondary-text-color)";
          p.textContent = helper;
          this.appendChild(p);
        }
        this._form = document.createElement("ha-form");
        this._form.computeLabel = (s) => s.label || labels[s.name] || s.name;
        this._form.addEventListener("value-changed", (ev) => {
          let v = { ...this._config, ...ev.detail.value };
          if (hooks.fromForm) v = hooks.fromForm(v, this._config, this._hass);
          for (const k of Object.keys(v)) {
            if (v[k] === "" || v[k] === undefined || (k in defaults && v[k] === defaults[k] && !(k in this._config))) delete v[k];
          }
          this._config = v;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
        });
        this.appendChild(this._form);
      }
      this._form.hass = this._hass;
      this._form.schema = typeof schema === "function" ? schema(this._config, this._hass) : schema;
      this._form.data = { ...defaults, ...this._config, ...(hooks.toForm ? hooks.toForm(this._config, this._hass) : {}) };
    }
  };
}

/* ================================================================ carte Santé */

/** Rôles des capteurs du Mi Band (intégration miband), par clé de traduction ou classe d'appareil. */
const MB_KEYS = ["steps", "calories", "heart_rate", "heart_rate_min", "heart_rate_max", "heart_rate_avg",
  "sleep_total", "sleep_deep", "sleep_light", "sleep_rem", "sleep_awake", "sleep_start", "sleep_end", "last_sync", "asleep", "worn"];

/** Capteurs Health Connect de l'application Home Assistant (mobile_app), reconnus par la fin de leur entity_id. */
const HC_KEYS = {
  daily_steps: "steps", daily_distance: "distance", active_calories_burned: "calories", total_calories_burned: "calories_total",
  heart_rate: "heart_rate", resting_heart_rate: "resting_hr", heart_rate_variability: "hrv", oxygen_saturation: "spo2",
  respiratory_rate: "respiratory", sleep_duration: "sleep_total", weight: "weight", body_fat: "body_fat",
  systolic_blood_pressure: "bp_sys", diastolic_blood_pressure: "bp_dia", blood_glucose: "glucose", body_temperature: "body_temp",
  vo2_max: "vo2", daily_floors: "floors", daily_hydration: "hydration",
};

/** Mesures du téléphone affichées en tuiles (quand elles ont une valeur). */
const EXTRA_TILES = [
  ["resting_hr", "FC au repos", "mdi:heart-outline", 0],
  ["spo2", "SpO₂", "mdi:water-percent", 0],
  ["hrv", "Variabilité FC", "mdi:heart-flash", 0],
  ["respiratory", "Respiration", "mdi:lungs", 0],
  ["bp", "Tension", "mdi:heart-box-outline", 0],
  ["weight", "Poids", "mdi:scale-bathroom", 1],
  ["body_fat", "Masse grasse", "mdi:percent-outline", 1],
  ["glucose", "Glycémie", "mdi:diabetes", 1],
  ["body_temp", "Température", "mdi:thermometer", 1],
  ["vo2", "VO₂ max", "mdi:run-fast", 1],
  ["floors", "Étages", "mdi:stairs-up", 0],
  ["hydration", "Hydratation", "mdi:cup-water", 0],
];

/** Valeur en minutes d'une durée, selon son unité. */
const minutesOf = (o) => {
  const v = num(o?.state);
  if (v === null) return null;
  const u = String(o?.attributes?.unit_of_measurement || "min").toLowerCase();
  if (u === "h") return v * 60;
  if (u === "s") return v / 60;
  if (u === "ms") return v / 60000;
  if (u === "d") return v * 1440;
  return v;
};

/** Distance en mètres, selon son unité. */
const metersOf = (o) => {
  const v = num(o?.state);
  if (v === null) return null;
  const u = String(o?.attributes?.unit_of_measurement || "m").toLowerCase();
  return u === "km" ? v * 1000 : u === "mi" ? v * 1609.34 : u === "ft" ? v * 0.3048 : v;
};

const timeOf = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
};

class SanteCard extends MaisonCard {
  static get DEFAULTS() {
    return { theme: "maison", step_goal: 8000, distance_goal: 5, calorie_goal: 400, sleep_goal: 8, show_activity: true, show_heart: true, show_sleep: true, show_phone: true };
  }

  getCardSize() { return 7; }

  _resolve(c, hass) {
    const reg = hass.entities || {}, devs = hass.devices || {};
    const r = {};
    let band = null;
    // Mi Band : appareil choisi, sinon le premier trouvé
    for (const [id, e] of Object.entries(reg)) {
      if (e.platform !== "miband" || !hass.states[id]) continue;
      if (c.device && e.device_id !== c.device) continue;
      if (band && e.device_id !== band) continue;
      band = e.device_id;
      const a = hass.states[id].attributes || {}, dom = domainOf(id);
      const k = dom === "sensor" && a.device_class === "battery" ? "battery"
        : dom === "sensor" && a.device_class === "distance" ? "distance"
        : dom === "binary_sensor" && a.device_class === "battery_charging" ? "charging"
        : MB_KEYS.includes(e.translation_key) ? e.translation_key : null;
      if (k && !r[k]) r[k] = id;
    }
    // Téléphone : seulement celui choisi (jamais deviné, pour ne pas afficher la santé d'un autre membre du foyer)
    const ph = {};
    if (c.phone) {
      for (const [id, e] of Object.entries(reg)) {
        if (e.device_id !== c.phone || domainOf(id) !== "sensor" || !hass.states[id]) continue;
        const key = Object.keys(HC_KEYS).sort((a, b) => b.length - a.length).find((s) => id.endsWith(`_${s}`));
        if (key && !ph[HC_KEYS[key]]) ph[HC_KEYS[key]] = id;
      }
    }
    for (const [k, v] of Object.entries(c.entities && typeof c.entities === "object" ? c.entities : {})) if (hass.states[v]) r[k] = v;
    const dev = band ? devs[band] : null;
    return { r, ph, name: dev?.name_by_user || dev?.name || "Mi Band", band };
  }

  _ids() {
    const { r, ph } = this._resolved();
    return [...Object.values(r), ...Object.values(ph)];
  }

  _render(c, hass) {
    const { r, ph, name, band } = this._resolved();
    if (!band && !Object.keys(ph).length) {
      return `<div class="empty"><b>Aucun bracelet trouvé</b>Installez l'intégration Mi Band 7 (ha-miband), ou choisissez un téléphone avec Health Connect dans l'éditeur de la carte.</div>`;
    }
    const st = hass.states;
    const v = (id) => num(st[id]?.state);
    const ok = (id) => id && v(id) !== null;
    // Mi Band d'abord ; le téléphone complète ce qui manque
    const pick = (k) => (ok(r[k]) ? r[k] : ok(ph[k]) ? ph[k] : r[k] || ph[k] || null);
    const more = (id, label) => (id ? this._click({ action: "more-info", entity: id }, null, label) : "");

    /* en-tête */
    const sync = st[r.last_sync]?.state;
    const sub = [band ? esc(name) : "Téléphone", sync && !BAD.has(sync) ? `synchronisé ${esc(relTime(sync) || "")}` : ""].filter(Boolean).join(" · ");
    const bat = v(r.battery), charging = st[r.charging]?.state === "on";
    const chips = [];
    if (bat !== null) {
      const ic = charging ? "mdi:battery-charging" : `mdi:battery${bat >= 95 ? "" : `-${Math.max(10, Math.round(bat / 10) * 10)}`}`;
      chips.push(`<span class="sa-chip${bat <= 15 && !charging ? " warn" : ""}"${more(r.battery, "Batterie")}><ha-icon icon="${ic}"></ha-icon>${fmt(bat)} %</span>`);
    }
    if (st[r.asleep]?.state === "on") chips.push(`<span class="sa-chip on"><ha-icon icon="mdi:sleep"></ha-icon>Endormi</span>`);
    if (st[r.worn]?.state === "off") chips.push(`<span class="sa-chip"><ha-icon icon="mdi:watch-off"></ha-icon>Non porté</span>`);
    let html = `<div class="sa-hd"><div class="sa-ic"><ha-icon icon="${esc(c.icon || "mdi:heart-pulse")}"></ha-icon></div>` +
      `<div class="sa-t"><b>${esc(c.title || "Santé")}</b><small>${sub}</small></div><div class="sa-chips">${chips.join("")}</div></div><div class="sa-body">`;

    /* activité : trois anneaux */
    if (c.show_activity !== false) {
      const sId = pick("steps"), dId = pick("distance"), kId = pick("calories");
      const steps = v(sId), dist = metersOf(st[dId]), kcal = v(kId);
      const goals = [num(c.step_goal) || 8000, (num(c.distance_goal) || 5) * 1000, num(c.calorie_goal) || 400];
      const rows = [
        ["Pas", steps, goals[0], "var(--m-green)", sId, steps === null ? "—" : fmt(steps), `/ ${fmt(goals[0])}`],
        ["Distance", dist, goals[1], "var(--m-blue)", dId, dist === null ? "—" : dist >= 1000 ? `${fmt(dist / 1000, 2)} km` : `${fmt(dist)} m`, `/ ${fmt(goals[1] / 1000, goals[1] % 1000 ? 1 : 0)} km`],
        ["Calories", kcal, goals[2], "var(--m-orange)", kId, kcal === null ? "—" : `${fmt(kcal)} kcal`, `/ ${fmt(goals[2])}`],
      ];
      const ring = (i, val, goal, col) => {
        const rr = 44 - i * 11, cl = 2 * Math.PI * rr, f0 = val === null ? 0 : Math.max(0, Math.min(1, val / goal)), f = f0 > 0 && f0 < 0.02 ? 0.02 : f0;
        return `<circle class="sa-rt" cx="50" cy="50" r="${rr}" style="stroke:${col}"/>` +
          (f > 0 ? `<circle class="sa-rv" cx="50" cy="50" r="${rr}" style="stroke:${col};stroke-dasharray:${(f * cl).toFixed(2)} ${cl.toFixed(2)}"/>` : "");
      };
      html += `<section class="sa-sec sa-act"><svg class="sa-rings" viewBox="0 0 100 100" aria-hidden="true">${rows.map((x, i) => ring(i, x[1], x[2], x[3])).join("")}</svg>` +
        `<div class="sa-leg">${rows.map(([lab, val, goal, col, id, shown, of]) => {
          const pct = val === null ? null : Math.round((val / goal) * 100);
          return `<div class="sa-li"${more(id, lab)}><i style="background:${col}"></i><span>${lab}</span><b>${shown}</b><small>${of}${pct !== null ? ` · ${pct >= 100 ? "✓ " : ""}${pct} %` : ""}</small></div>`;
        }).join("")}</div></section>`;
    }

    /* cœur */
    if (c.show_heart !== false) {
      const hrId = pick("heart_rate"), hr = v(hrId);
      const lo = v(r.heart_rate_min), hi = v(r.heart_rate_max), avg = v(r.heart_rate_avg);
      const rest = v(ph.resting_hr);
      if (hr !== null || lo !== null || hi !== null) {
        const top = Math.max(160, (hi || 0) + 10), bot = 40;
        const pos = (x) => `${(((Math.max(bot, Math.min(top, x)) - bot) / (top - bot)) * 100).toFixed(1)}%`;
        const pts = this._hist(r.heart_rate || hrId, 24);
        const when = st[hrId]?.last_changed ? relTime(st[hrId].last_changed) : null;
        html += `<section class="sa-sec sa-heart"${more(hrId, "Fréquence cardiaque")}>` +
          `<div class="sa-hr"><ha-icon class="sa-beat" icon="mdi:heart"></ha-icon><b>${hr !== null ? fmt(hr) : "—"}</b><span>bpm</span>` +
          `<small>${when ? `mesurée ${esc(when)}` : "Fréquence cardiaque"}${rest !== null ? ` · repos ${fmt(rest)} bpm` : ""}</small></div>` +
          (lo !== null && hi !== null ? `<div class="sa-range" aria-label="Plage du jour ${fmt(lo)} à ${fmt(hi)} bpm"><div class="sa-rb" style="left:${pos(lo)};right:calc(100% - ${pos(hi)})"></div>` +
            (avg !== null ? `<i class="sa-avg" style="left:${pos(avg)}"></i>` : "") + (hr !== null ? `<i class="sa-now" style="left:${pos(hr)}"></i>` : "") + `</div>` +
            `<div class="sa-rl"><span>min <b>${fmt(lo)}</b></span><span>moy <b>${avg !== null ? fmt(avg) : "—"}</b></span><span>max <b>${fmt(hi)}</b></span></div>` : "") +
          (pts && pts.length > 1 ? `<div class="sa-spark">${spark(pts, 300, 46, 24, 10)}</div>` : "") +
          `</section>`;
      }
    }

    /* sommeil */
    if (c.show_sleep !== false) {
      const tId = pick("sleep_total"), total = minutesOf(st[tId]);
      if (total !== null) {
        const ph4 = [["Profond", r.sleep_deep, "var(--m-blue-dark)"], ["Léger", r.sleep_light, "var(--m-blue)"], ["Paradoxal", r.sleep_rem, "var(--m-purple)"], ["Éveil", r.sleep_awake, "var(--m-orange)"]]
          .map(([lab, id, col]) => [lab, id, col, minutesOf(st[id])]).filter((x) => x[3] !== null);
        const sum = ph4.reduce((a, x) => a + x[3], 0) || 1;
        const goal = (num(c.sleep_goal) || 8) * 60;
        const s0 = st[r.sleep_start]?.state, s1 = st[r.sleep_end]?.state;
        html += `<section class="sa-sec sa-sleep"${more(tId, "Sommeil")}>` +
          `<div class="sa-sh"><ha-icon icon="mdi:sleep"></ha-icon><b>${hm(total)}</b><small>${Math.round((total / goal) * 100)} % de ${fmt(goal / 60, goal % 60 ? 1 : 0)} h</small>` +
          (s0 && s1 && !BAD.has(s0) && !BAD.has(s1) ? `<span class="sa-times">${timeOf(s0)} → ${timeOf(s1)}</span>` : "") + `</div>` +
          (ph4.length ? `<div class="sa-bar">${ph4.map(([lab, , col, m]) => `<i style="flex:${m};background:${col}" title="${lab}"></i>`).join("")}</div>` +
            `<div class="sa-pl">${ph4.map(([lab, id, col, m]) => `<span${more(id, lab)}><i style="background:${col}"></i>${lab} <b>${hm(m)}</b> <small>${Math.round((m / sum) * 100)} %</small></span>`).join("")}</div>` : "") +
          `</section>`;
      }
    }

    /* mesures du téléphone */
    if (c.show_phone !== false && Object.keys(ph).length) {
      const tiles = [];
      for (const [k, lab, icon, dec] of EXTRA_TILES) {
        if (k === "bp") {
          const s = v(ph.bp_sys), d = v(ph.bp_dia);
          if (s !== null && d !== null) tiles.push(`<div class="sa-k"${more(ph.bp_sys, lab)}><small><ha-icon icon="${icon}"></ha-icon>${lab}</small><b>${fmt(s)}/${fmt(d)}<span>mmHg</span></b></div>`);
          continue;
        }
        const id = ph[k], x = v(id);
        if (x === null) continue;
        const u = esc(st[id]?.attributes?.unit_of_measurement || "");
        tiles.push(`<div class="sa-k"${more(id, lab)}><small><ha-icon icon="${icon}"></ha-icon>${lab}</small><b>${fmt(x, x % 1 ? dec : 0)}${u ? `<span>${u}</span>` : ""}</b></div>`);
      }
      if (tiles.length) html += `<section class="sa-sec"><div class="sa-tiles">${tiles.join("")}</div></section>`;
    }
    return `<div class="sa">${html}</div></div>`;
  }
}

SanteCard.STYLE = `<style>
.sa { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.sa-hd { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sa-ic { width: 40px; height: 40px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--m-chip); color: var(--m-red); }
.sa-t { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.sa-t b { font-size: 1.05rem; font-weight: 600; }
.sa-t small { color: var(--m-muted); font-size: .78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sa-chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.sa-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 99px; background: var(--m-chip); font-size: .78rem; font-weight: 600; white-space: nowrap; }
.sa-chip ha-icon { --mdc-icon-size: 16px; }
.sa-chip.warn { color: var(--m-red); }
.sa-chip.on { background: var(--m-purple); color: var(--m-on-pop); }
.sa-body { display: flex; flex-direction: column; gap: 10px; }
@container (min-width: 640px) { .sa-body { display: grid; grid-template-columns: 1fr 1fr; align-items: start; } }
.sa-sec { background: var(--m-chip); border-radius: calc(var(--m-radius) - 6px); padding: 12px; }
.sa-act { display: grid; grid-template-columns: minmax(96px, 128px) 1fr; gap: 14px; align-items: center; }
.sa-rings { width: 100%; transform: rotate(-90deg); }
.sa-rt { fill: none; stroke-width: 8.5; opacity: .18; }
.sa-rv { fill: none; stroke-width: 8.5; stroke-linecap: round; transition: stroke-dasharray .6s ease; }
.sa-leg { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sa-li { display: grid; grid-template-columns: 10px auto 1fr; column-gap: 8px; align-items: baseline; }
.sa-li i { width: 10px; height: 10px; border-radius: 50%; align-self: center; }
.sa-li span { color: var(--m-muted); font-size: .8rem; }
.sa-li b { justify-self: end; font-size: 1.05rem; }
.sa-li small { grid-column: 2 / -1; color: var(--m-muted); font-size: .72rem; text-align: right; }
.sa-hr { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.sa-hr b { font-size: 2.1rem; line-height: 1; font-weight: 700; }
.sa-hr span { color: var(--m-muted); font-weight: 600; }
.sa-hr small { flex-basis: 100%; color: var(--m-muted); font-size: .76rem; }
.sa-beat { color: var(--m-red); --mdc-icon-size: 26px; align-self: center; animation: sa-beat 1.1s ease-in-out infinite; }
@keyframes sa-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.18); } 30% { transform: scale(1); } 45% { transform: scale(1.1); } }
.sa-range { position: relative; height: 10px; border-radius: 10px; background: var(--m-line); margin: 12px 4px 4px; }
.sa-rb { position: absolute; top: 0; bottom: 0; border-radius: 10px; background: linear-gradient(90deg, var(--m-green), var(--m-orange), var(--m-red)); opacity: .85; }
.sa-range i { position: absolute; top: 50%; width: 4px; height: 18px; border-radius: 4px; transform: translate(-50%, -50%); }
.sa-avg { background: var(--m-text); opacity: .55; }
.sa-now { background: var(--m-text); box-shadow: 0 0 0 2px var(--m-chip); }
.sa-rl { display: flex; justify-content: space-between; font-size: .74rem; color: var(--m-muted); margin: 6px 2px 0; }
.sa-rl b { color: var(--m-text); }
.sa-spark { height: 46px; margin-top: 8px; }
.sa-heart .spark-l { stroke: var(--m-red); }
.sa-heart .spark-a { fill: var(--m-red); }
.sa-sh { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.sa-sh ha-icon { color: var(--m-purple); align-self: center; }
.sa-sh b { font-size: 1.6rem; font-weight: 700; line-height: 1; }
.sa-sh small { color: var(--m-muted); font-size: .76rem; }
.sa-times { margin-left: auto; font-size: .8rem; font-weight: 600; color: var(--m-muted); }
.sa-bar { display: flex; gap: 2px; height: 12px; border-radius: 12px; overflow: hidden; margin: 10px 0 8px; }
.sa-bar i { display: block; min-width: 3px; }
.sa-pl { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: .78rem; color: var(--m-muted); }
.sa-pl span { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.sa-pl i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.sa-pl b { color: var(--m-text); }
.sa-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.sa-k { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 12px; background: var(--m-card); }
.sa-k small { display: flex; align-items: center; gap: 4px; color: var(--m-muted); font-size: .72rem; }
.sa-k small ha-icon { --mdc-icon-size: 14px; }
.sa-k b { font-size: 1.05rem; }
.sa-k b span { font-size: .72rem; color: var(--m-muted); margin-left: 3px; font-weight: 600; }
.sa-sec[data-a]:hover, .sa-li[data-a]:hover, .sa-k[data-a]:hover { filter: brightness(1.04); }
@container (max-width: 300px) { .sa-act { grid-template-columns: 1fr; } .sa-rings { max-width: 140px; margin: 0 auto; } }
</style>`;

/* ============================================================ enregistrement */

const T = (name) => ({ name, selector: { text: {} } });
const B = (name) => ({ name, selector: { boolean: {} } });
const N = (name, min, max, step = 1) => ({ name, selector: { number: { min, max, step, mode: "box" } } });
const I = (name) => ({ name, selector: { icon: {} } });

const LABELS = {
  title: "Titre", icon: "Icône", device: "Bracelet Mi Band (vide : le premier trouvé)", phone: "Téléphone (données Health Connect, facultatif)",
  step_goal: "Objectif de pas", distance_goal: "Objectif de distance (km)", calorie_goal: "Objectif de calories (kcal)", sleep_goal: "Objectif de sommeil (h)",
  show_activity: "Activité (anneaux)", show_heart: "Fréquence cardiaque", show_sleep: "Sommeil", show_phone: "Mesures du téléphone", theme: "Thème",
};

const EDITORS = {
  "sante-card": [() => [T("title"), I("icon"),
    { name: "device", selector: { device: { integration: "miband" } } },
    { name: "phone", selector: { device: { integration: "mobile_app" } } },
    N("step_goal", 1000, 50000, 500), N("distance_goal", 1, 50, 0.5), N("calorie_goal", 50, 3000, 50), N("sleep_goal", 4, 12, 0.5),
    B("show_activity"), B("show_heart"), B("show_sleep"), B("show_phone"), THEME_SELECT],
  "Le Mi Band est trouvé seul. Le téléphone n'est jamais deviné : choisissez le vôtre pour ajouter ses mesures Health Connect (oxygène, FC au repos, poids…)."],
};

const CARDS = [
  ["sante-card", SanteCard, "Santé · Mi Band et Health Connect", "Pas, distance, calories, fréquence cardiaque et sommeil du Mi Band, complétés par les mesures Health Connect du téléphone.", () => ({})],
];

if (typeof customElements !== "undefined") {
  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
  window.customCards = window.customCards || [];
  for (const [type, cls, name, description, stub] of CARDS) {
    const [schemaFn, helper, hooks] = EDITORS[type];
    const Ed = makeEditor(schemaFn, LABELS, cls.DEFAULTS || {}, helper, hooks);
    cls.getConfigElement = () => document.createElement(`${type}-editor`);
    cls.getStubConfig = (hass) => stub(hass);
    define(type, cls);
    define(`${type}-editor`, Ed);
    if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview: true });
  }
  console.info(`%c SANTE-CARD %c ${CARD_VERSION} `, "background:#e5776e;color:#1f0b09;font-weight:700", "background:#2b2c2f;color:#fff");
}
})();
