/* Faux Home Assistant de la démo : un Mi Band 7 et un téléphone avec Health Connect (valeurs fictives). */
(() => {
  const M = 60e3, H = 3600e3;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const at = (dayOffset, h, m) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };

  window.makeHass = (o = {}) => {
    const st = {}, ent = {};
    const s = (id, state, attrs = {}, reg = {}) => {
      st[id] = { entity_id: id, state: String(state), attributes: attrs, last_changed: reg.lc || iso(-4 * M), last_updated: reg.lc || iso(-4 * M) };
      ent[id] = { entity_id: id, platform: reg.p, translation_key: reg.k || null, device_id: reg.dev, area_id: null, entity_category: reg.cat || null };
    };
    const band = (id, state, attrs, k) => s(`${id}`, state, attrs, { p: "miband", dev: "band", k });
    const day = o.day || "soir";
    const steps = day === "matin" ? 1840 : day === "objectif" ? 10230 : 6420;
    band("sensor.mi_band_7_batterie", o.battery ?? 64, { unit_of_measurement: "%", device_class: "battery", friendly_name: "Mi Band 7 Batterie" });
    band("binary_sensor.mi_band_7_en_charge", "off", { device_class: "battery_charging" });
    band("sensor.mi_band_7_pas", steps, { unit_of_measurement: "pas", state_class: "total_increasing" }, "steps");
    band("sensor.mi_band_7_distance", Math.round(steps * 0.72), { unit_of_measurement: "m", device_class: "distance" });
    band("sensor.mi_band_7_calories", Math.round(steps * 0.045), { unit_of_measurement: "kcal" }, "calories");
    band("sensor.mi_band_7_frequence_cardiaque", 74, { unit_of_measurement: "bpm" }, "heart_rate");
    band("sensor.mi_band_7_fc_minimum_du_jour", 54, { unit_of_measurement: "bpm" }, "heart_rate_min");
    band("sensor.mi_band_7_fc_maximum_du_jour", day === "objectif" ? 148 : 118, { unit_of_measurement: "bpm" }, "heart_rate_max");
    band("sensor.mi_band_7_fc_moyenne_du_jour", 71, { unit_of_measurement: "bpm" }, "heart_rate_avg");
    band("sensor.mi_band_7_sommeil_total", 442, { unit_of_measurement: "min", device_class: "duration" }, "sleep_total");
    band("sensor.mi_band_7_sommeil_profond", 96, { unit_of_measurement: "min", device_class: "duration" }, "sleep_deep");
    band("sensor.mi_band_7_sommeil_leger", 251, { unit_of_measurement: "min", device_class: "duration" }, "sleep_light");
    band("sensor.mi_band_7_sommeil_paradoxal", 79, { unit_of_measurement: "min", device_class: "duration" }, "sleep_rem");
    band("sensor.mi_band_7_eveil_nocturne", 16, { unit_of_measurement: "min", device_class: "duration" }, "sleep_awake");
    band("sensor.mi_band_7_endormissement", at(-1, 23, 18), { device_class: "timestamp" }, "sleep_start");
    band("sensor.mi_band_7_reveil", at(0, 6, 54), { device_class: "timestamp" }, "sleep_end");
    band("sensor.mi_band_7_derniere_synchronisation", iso(-3 * M), { device_class: "timestamp" }, "last_sync");
    band("binary_sensor.mi_band_7_endormi", o.asleep ? "on" : "off", {}, "asleep");
    band("binary_sensor.mi_band_7_porte", "on", {}, "worn");
    // téléphone (application Home Assistant, Health Connect)
    const phone = (k, state, attrs = {}) => s(`sensor.telephone_demo_${k}`, state, attrs, { p: "mobile_app", dev: "phone" });
    phone("daily_steps", 25, { unit_of_measurement: "steps" });
    phone("heart_rate", 80, { unit_of_measurement: "bpm" });
    phone("resting_heart_rate", 62, { unit_of_measurement: "bpm" });
    phone("oxygen_saturation", 96, { unit_of_measurement: "%" });
    phone("heart_rate_variability", "unknown", { unit_of_measurement: "ms" });
    phone("sleep_duration", 7, { unit_of_measurement: "h" });
    phone("weight", 78.4, { unit_of_measurement: "kg" });
    phone("systolic_blood_pressure", 124, { unit_of_measurement: "mmHg" });
    phone("diastolic_blood_pressure", 79, { unit_of_measurement: "mmHg" });
    phone("battery_level", 85, { unit_of_measurement: "%", device_class: "battery" });

    const devices = {
      band: { id: "band", name: "Mi Band 7", manufacturer: "Xiaomi", model: "Smart Band 7" },
      phone: { id: "phone", name: "Téléphone démo", manufacturer: "Démo", model: "Android" },
    };
    // historique de la fréquence cardiaque : 24 h, une mesure toutes les 10 min
    const hist = (id) => {
      if (!/frequence_cardiaque|heart_rate$/.test(id)) return [[]];
      const rows = [];
      for (let t = Date.now() - 24 * H; t <= Date.now(); t += 10 * M) {
        const h = new Date(t).getHours();
        const base = h < 7 ? 56 : h < 9 ? 78 : h > 22 ? 62 : 72;
        const v = Math.round(base + 9 * Math.sin(t / 2.3e6) + 6 * Math.sin(t / 7.1e5) + (h === 18 ? 35 : 0));
        rows.push({ state: String(v), last_changed: new Date(t).toISOString() });
      }
      return [rows];
    };
    return {
      states: st, entities: ent, devices, areas: {}, floors: {},
      themes: { darkMode: !!o.dark }, language: "fr", user: { name: "Démo" },
      callService: () => Promise.resolve(),
      callApi: (m, path) => Promise.resolve(hist(decodeURIComponent((/filter_entity_id=([^&]+)/.exec(path) || [])[1] || ""))),
      callWS: () => Promise.resolve({}),
    };
  };
})();
