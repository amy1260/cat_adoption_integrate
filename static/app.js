"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const state = {
  lang: localStorage.getItem("lang") || "zh",
  meta: null,
  isAdmin: false,
  isAdminReal: false,
  visitorPreview: sessionStorage.getItem("preview") === "1",
  pendingReview: 0,
  f: { q: "", region: "", sex: "", age_group: "", source: "", breed: "", neutered: "", vaccinated: "", fiv: "", sort: "new", page: 1 },
};

const t = (key, vars = {}) =>
  (I18N[state.lang][key] ?? I18N.zh[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isEn = () => state.lang === "en";

async function api(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (_) { /* empty body */ }
  return { ok: res.ok, status: res.status, body };
}

// ---------- labels ----------
const regionLabel = (r) => (r ? (isEn() ? REGION_EN[r] || r : r) : t("unknown"));
const breedLabel = (c) => {
  if (c.breed && BREED_LABEL[c.breed]) return BREED_LABEL[c.breed][isEn() ? 1 : 0];
  return c.breed_text || null;
};
const colorLabel = (c) => {
  if (!c) return null;
  if (!isEn()) return c;
  const hit = COLOR_EN.find(([zh]) => c.includes(zh));
  return hit ? hit[1] : c;
};
const sexLabel = (s) => t("sex_" + (s || "U"));
const sourceLabel = (s) => t("src_" + s);
const monthsLabel = (m) => (m < 12 ? t("months", { n: m }) : t("years", { n: Math.round((m / 12) * 10) / 10 }));
function ageLabel(c) {
  if (c.age_months != null) return monthsLabel(c.age_months);
  return t("age_" + (c.age_group || "unknown"));
}
function fmtDate(iso) {
  if (!iso) return null;
  return iso.slice(0, 10);
}
function healthTags(c) {
  const tags = [];
  if (c.neutered === true) tags.push([t("neutered_yes"), "good"]);
  if (c.neutered === false) tags.push([t("neutered_no"), "warn"]);
  if (c.vaccinated === true) tags.push([t("vaccinated_yes"), "good"]);
  if (c.vaccinated === false) tags.push([t("vaccinated_no"), "warn"]);
  if (c.fiv_felv === "neg") tags.push([t("fiv_felv") + " " + t("neg"), "good"]);
  if (c.fiv_felv === "pos") tags.push([t("fiv_felv") + " " + t("pos"), "warn"]);
  for (const k of c.health_tags || []) {
    if (k === "fiv_pos" && c.fiv_felv === "pos") continue;
    const l = HEALTH_LABEL[k];
    if (l) tags.push([l[isEn() ? 1 : 0], ["healthy", "dewormed"].includes(k) ? "good" : "warn"]);
  }
  return tags;
}

// ---------- shared card pieces ----------
const photoHtml = (c) =>
  c.photo
    ? `<img src="${esc(c.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('🐱'))">`
    : "🐱";

function titleOf(c) {
  if (c.source === "shelter") return [breedLabel(c) || "", colorLabel(c.color) || "", c.shelter_no || ""].filter(Boolean).join(" · ");
  return c.name || c.title || "—";
}

function cardHtml(c) {
  const tags = [sexLabel(c.sex), ageLabel(c), breedLabel(c), colorLabel(c.color)].filter(Boolean);
  const health = healthTags(c).slice(0, 3);
  return `
  <button class="card" data-id="${c.id}" type="button">
    <div class="photo">${photoHtml(c)}<span class="src">${esc(sourceLabel(c.source))}</span></div>
    <div class="card-body">
      <h3>${esc(titleOf(c))}</h3>
      <div class="tags">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="tags">${health.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join("")}${state.isAdmin && c.needs_photo ? `<span class="tag warn">📷 ${esc(t("ph_tag"))}</span>` : ""}</div>
      <div class="meta">📍 ${esc(regionLabel(c.region))}${c.district ? " " + esc(c.district) : ""}${c.posted_at ? " · " + esc(fmtDate(c.posted_at)) : ""}</div>
      ${c.also_listed ? `<div class="meta">🔗 ${esc(t("also_listed", { n: c.also_listed }))}</div>` : ""}
    </div>
  </button>`;
}

function miniHtml(c) {
  const tags = [sexLabel(c.sex), ageLabel(c), breedLabel(c), colorLabel(c.color)].filter(Boolean);
  const contact = [c.contact_name, c.contact_phone, c.contact_line && "LINE " + c.contact_line].filter(Boolean).join(" · ");
  return `
  <div class="mini">
    <div class="photo">${photoHtml(c)}<span class="src">${esc(sourceLabel(c.source))}</span></div>
    <div class="body">
      <strong>${esc(titleOf(c))}</strong>
      <div class="tags">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="meta">📍 ${esc(regionLabel(c.region))} · ${esc(fmtDate(c.posted_at) || "")}</div>
      <div class="meta">${esc(contact)}</div>
      <div class="snip">${esc((c.description || "").slice(0, 400))}</div>
      ${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(t("view_source"))}</a>` : ""}
    </div>
  </div>`;
}

// ---------- detail dialog ----------
async function openDetail(id) {
  const mineRec = mineGet(id);
  const { ok, body: c } = await api("/api/cats/" + id, { headers: tokenHeader(mineRec) });
  if (!ok) return;
  const rows = [];
  const add = (k, v) => v && rows.push(`<dt>${esc(t(k))}</dt><dd>${v}</dd>`);
  add("sex", esc(sexLabel(c.sex)));
  add("age", esc(ageLabel(c)));
  // a post's age is its age on the day it was posted; the figure above is already brought up to today
  if (c.age_months_post != null && c.age_months_post !== c.age_months && c.posted_at) {
    add("age_at_post", esc(`${monthsLabel(c.age_months_post)} (${fmtDate(c.posted_at)})`));
  }
  add("breed", esc(breedLabel(c) || t("unknown")));
  add("f_color", esc(colorLabel(c.color) || ""));
  add("location", esc(regionLabel(c.region) + (c.district ? " " + c.district : "")));
  add("found_at", esc(c.location_text || ""));
  add("shelter_no", esc(c.shelter_no || ""));
  add("available_from", esc(c.available_from || ""));
  add("posted", esc(fmtDate(c.posted_at) || ""));
  const health = healthTags(c);
  add("health_status", health.length ? health.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join(" ") + (c.health_note ? `<div class="meta">${esc(c.health_note)}</div>` : "") : esc(t("unknown")));
  const contact = [];
  if (c.contact_name) contact.push(esc(c.contact_name));
  if (c.contact_phone) contact.push(`${esc(t("phone"))}: <a href="tel:${esc(c.contact_phone.replace(/[^\d+]/g, ""))}">${esc(c.contact_phone)}</a>`);
  if (c.contact_line) contact.push(`LINE: <a href="https://line.me/ti/p/~${encodeURIComponent(c.contact_line.replace(/^@/, ""))}" target="_blank" rel="noopener noreferrer">${esc(c.contact_line)}</a>`);
  if (c.contact_other) contact.push(esc(isEn() ? c.contact_other.replace("Facebook 私訊", "Facebook message").replace("Facebook 留言", "Facebook comment") : c.contact_other));
  add("contact", contact.join("<br>"));
  const also = (c.also_listed || []).filter((a) => a.source_url);
  $("#detail").innerHTML = `
    <div class="dlg-head"><button class="btn ghost" id="dlgClose" type="button">${esc(t("close"))}</button></div>
    <div class="dlg-body">
      <div class="photo">${photoHtml(c)}<span class="src">${esc(sourceLabel(c.source))}</span></div>
      <h2 style="margin:0">${esc(titleOf(c))}</h2>
      <dl class="kv">${rows.join("")}</dl>
      ${c.description ? `<div><div class="fieldset-title">${esc(t("description"))}</div><div class="desc">${esc(c.description)}</div></div>` : ""}
      ${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(t("view_source"))} ↗</a>` : ""}
      ${(c.also_listed || []).length ? `<div class="meta">🔗 ${esc(t("also_listed", { n: c.also_listed.length }))}${also.map((a) => ` · <a href="${esc(a.source_url)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel(a.source))}</a>`).join("")}</div>` : ""}
      ${manageHtml(c, mineRec)}
      <div class="report">
        <button type="button" class="linkbtn" id="reportToggle" aria-expanded="false" aria-controls="reportForm">⚑ ${esc(t("rp_open"))}</button>
        <form id="reportForm" class="form" hidden novalidate>
          <p class="meta" style="margin:0">${esc(t("rp_intro"))}</p>
          <div class="field"><label for="rp_kind">${esc(t("rp_kind"))}</label>
            <select id="rp_kind" name="kind"><option value="">—</option>
              ${["wrong_info", "adopted", "duplicate", "inappropriate", "suggestion", "other"].map((k) => `<option value="${k}">${esc(t("rp_kind_" + k))}</option>`).join("")}
            </select><div class="err" data-rp-err="kind"></div></div>
          <div class="field"><label for="rp_message">${esc(t("rp_message"))}</label>
            <textarea id="rp_message" name="message" maxlength="1000" placeholder="${esc(t("rp_message_ph"))}"></textarea><div class="err" data-rp-err="message"></div></div>
          <div class="field"><label for="rp_contact">${esc(t("rp_contact"))}</label>
            <input type="text" id="rp_contact" name="contact" maxlength="120" placeholder="${esc(t("rp_contact_ph"))}"></div>
          <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
          <div id="rp_result"></div>
          <div><button class="btn" type="submit">${esc(t("rp_submit"))}</button></div>
        </form>
      </div>
    </div>`;
  $("#dlgClose").onclick = () => $("#detail").close();
  wireReport(c.id);
  wireManage(c, mineRec);
  if (!$("#detail").open) $("#detail").showModal();
}

function wireReport(catId) {
  const form = $("#reportForm"), toggle = $("#reportToggle");
  toggle.onclick = () => {
    form.hidden = !form.hidden;
    toggle.setAttribute("aria-expanded", String(!form.hidden));
    toggle.textContent = "⚑ " + t(form.hidden ? "rp_open" : "rp_close");
    if (!form.hidden) form.scrollIntoView({ block: "nearest" });
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    document.querySelectorAll("[data-rp-err]").forEach((x) => (x.textContent = ""));
    const fd = Object.fromEntries(new FormData(form));
    const out = $("#rp_result"), btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const { status, body } = await api(`/api/cats/${catId}/report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fd),
    });
    btn.disabled = false;
    if (status === 201 || status === 200) {
      form.reset();
      out.innerHTML = `<div class="notice good">${esc(t("rp_thanks"))}</div>`;
    } else if (status === 400 && body?.fields) {
      if (body.fields.kind) $('[data-rp-err="kind"]').textContent = t("rp_err_kind");
      if (body.fields.message) $('[data-rp-err="message"]').textContent = t("rp_err_short");
      out.innerHTML = "";
    } else if (status === 429) {
      out.innerHTML = `<div class="notice warn">${esc(t("rp_limited"))}</div>`;
    } else {
      out.innerHTML = `<div class="notice bad">${esc(t("err_generic"))}</div>`;
    }
  };
}
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });

// ---------- browse ----------
const AGE_KEYS = ["kitten", "adult", "senior"];
const SOURCE_KEYS = ["shelter", "fb_catparadise", "user"];

function chipGroup(name, keys, labelFn) {
  return `<div class="chips" data-chips="${name}">${keys.map((k) => `<button type="button" class="chip${state.f[name] === k ? " on" : ""}" data-v="${k}">${esc(labelFn(k))}</button>`).join("")}</div>`;
}

async function renderBrowse() {
  state.meta = (await api("/api/meta")).body;
  const m = state.meta;
  const total = Object.values(m.by_source).reduce((a, b) => a + b, 0);
  const fb = m.by_source.fb_catparadise || 0;
  const regions = m.regions.filter((r) => m.by_region[r]);
  const breeds = Object.keys(m.breeds).filter((b) => BREED_LABEL[b]);
  $("#app").innerHTML = `
    <section class="hero">
      <h1>${esc(t("brand"))}</h1>
      <p>${esc(t("tagline"))}</p>
      <div class="stats">
        <div class="stat"><b>${total}</b><span>${esc(t("stat_total"))}</span></div>
        <div class="stat"><b>${m.by_source.shelter || 0}</b><span>${esc(t("stat_shelter"))}</span></div>
        <div class="stat"><b>${fb}</b><span>${esc(t("stat_fb"))}</span></div>
        <div class="stat"><b>${m.by_source.user || 0}</b><span>${esc(t("stat_user"))}</span></div>
      </div>
    </section>
    <div class="layout">
      <aside class="filters" aria-label="Filters">
        <div class="field"><label for="q">${esc(t("search_ph"))}</label><input type="search" id="q" value="${esc(state.f.q)}"></div>
        <div class="field"><label for="region">${esc(t("region"))}</label>
          <select id="region"><option value="">${esc(t("all_regions"))}</option>
          ${regions.map((r) => `<option value="${r}"${state.f.region === r ? " selected" : ""}>${esc(regionLabel(r))} (${m.by_region[r]})</option>`).join("")}</select></div>
        <div class="field"><span class="fieldset-title">${esc(t("sex"))}</span>${chipGroup("sex", ["M", "F"], sexLabel)}</div>
        <div class="field"><span class="fieldset-title">${esc(t("age"))}</span>${chipGroup("age_group", AGE_KEYS, (k) => t("age_" + k))}</div>
        <div class="field"><label for="breed">${esc(t("breed"))}</label>
          <select id="breed"><option value="">${esc(t("all"))}</option>
          ${breeds.map((b) => `<option value="${b}"${state.f.breed === b ? " selected" : ""}>${esc(BREED_LABEL[b][isEn() ? 1 : 0])} (${m.breeds[b]})</option>`).join("")}</select></div>
        <div class="field"><span class="fieldset-title">${esc(t("source"))}</span>${chipGroup("source", SOURCE_KEYS, sourceLabel)}</div>
        <div class="field"><span class="fieldset-title">${esc(t("health"))}</span>
          <label class="check"><input type="checkbox" id="neutered"${state.f.neutered ? " checked" : ""}> ${esc(t("neutered_only"))}</label>
          <label class="check"><input type="checkbox" id="vaccinated"${state.f.vaccinated ? " checked" : ""}> ${esc(t("vaccinated_only"))}</label>
          <label class="check"><input type="checkbox" id="fiv"${state.f.fiv ? " checked" : ""}> ${esc(t("fiv_neg"))}</label></div>
        <button class="btn ghost" id="reset" type="button">${esc(t("reset"))}</button>
      </aside>
      <section aria-live="polite">
        <div class="resultbar"><strong id="count"></strong>
          <label>${esc(t("sort"))} <select id="sort">
            ${[["new", "sort_new"], ["region", "sort_region"], ["age", "sort_age"]].map(([v, k]) => `<option value="${v}"${state.f.sort === v ? " selected" : ""}>${esc(t(k))}</option>`).join("")}
          </select></label></div>
        <div class="grid" id="grid"></div>
        <div class="pager" id="pager"></div>
      </section>
    </div>`;
  wireFilters();
  loadCats();
}

function wireFilters() {
  let timer;
  const refresh = () => { state.f.page = 1; loadCats(); };
  $("#q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { state.f.q = e.target.value.trim(); refresh(); }, 300); });
  $("#region").onchange = (e) => { state.f.region = e.target.value; refresh(); };
  $("#breed").onchange = (e) => { state.f.breed = e.target.value; refresh(); };
  $("#sort").onchange = (e) => { state.f.sort = e.target.value; refresh(); };
  $("#neutered").onchange = (e) => { state.f.neutered = e.target.checked ? "1" : ""; refresh(); };
  $("#vaccinated").onchange = (e) => { state.f.vaccinated = e.target.checked ? "1" : ""; refresh(); };
  $("#fiv").onchange = (e) => { state.f.fiv = e.target.checked ? "neg" : ""; refresh(); };
  document.querySelectorAll("[data-chips]").forEach((box) => {
    box.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const name = box.dataset.chips;
      state.f[name] = state.f[name] === b.dataset.v ? "" : b.dataset.v;
      box.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.v === state.f[name]));
      refresh();
    };
  });
  $("#reset").onclick = () => { Object.assign(state.f, { q: "", region: "", sex: "", age_group: "", source: "", breed: "", neutered: "", vaccinated: "", fiv: "", sort: "new", page: 1 }); renderBrowse(); };
  $("#grid").onclick = (e) => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); };
}

async function loadCats() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.f)) if (v !== "" && v != null) p.set(k, v);
  p.set("per_page", 24);
  const { body } = await api("/api/cats?" + p);
  if (!body) return;
  $("#count").textContent = t("results", { n: body.total });
  $("#grid").innerHTML = body.items.length ? body.items.map(cardHtml).join("") : `<p class="empty" style="grid-column:1/-1">${esc(t("no_results"))}</p>`;
  const pages = Math.max(1, Math.ceil(body.total / body.per_page));
  $("#pager").innerHTML = pages > 1
    ? `<button class="btn ghost" id="prev" type="button"${body.page <= 1 ? " disabled" : ""}>${esc(t("prev"))}</button>
       <span>${esc(t("page", { p: body.page, t: pages }))}</span>
       <button class="btn ghost" id="next" type="button"${body.page >= pages ? " disabled" : ""}>${esc(t("next"))}</button>` : "";
  if (pages > 1) {
    $("#prev").onclick = () => { state.f.page--; loadCats(); window.scrollTo({ top: 0 }); };
    $("#next").onclick = () => { state.f.page++; loadCats(); window.scrollTo({ top: 0 }); };
  }
}

// ---------- upload ----------
function renderUpload() {
  const m = state.meta || { regions: Object.keys(REGION_EN) };
  const opt = (v, l) => `<option value="${v}">${esc(l)}</option>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("up_title"))}</h1>
    <p class="meta">${esc(t("up_intro"))}</p>
    <form class="form" id="upForm" novalidate>
      <div class="field"><label for="paste">${esc(t("up_paste"))}</label>
        <textarea id="paste" placeholder="${esc(t("up_paste_ph"))}"></textarea>
        <button class="btn ghost" id="detect" type="button" style="margin-top:8px">${esc(t("up_detect"))}</button>
        <span class="meta" id="detected"></span></div>
      <div class="row">
        <div class="field"><label for="name">${esc(t("f_name"))}</label><input type="text" id="name" name="name" maxlength="40"></div>
        <div class="field"><label for="region_f">${esc(t("region"))} *</label>
          <select id="region_f" name="region"><option value="">—</option>${m.regions.map((r) => opt(r, regionLabel(r))).join("")}</select><div class="err" data-err="region"></div></div>
        <div class="field"><label for="district">${esc(t("f_district"))}</label><input type="text" id="district" name="district"></div>
      </div>
      <div class="row">
        <div class="field"><label for="sex_f">${esc(t("sex"))}</label>
          <select id="sex_f" name="sex">${opt("U", t("sex_U"))}${opt("M", t("sex_M"))}${opt("F", t("sex_F"))}</select></div>
        <div class="field"><label for="age_months">${esc(t("f_age_months"))}</label><input type="number" id="age_months" name="age_months" min="0" max="300"></div>
        <div class="field"><label for="age_group_f">${esc(t("f_age_group"))}</label>
          <select id="age_group_f" name="age_group">${opt("", t("age_unknown"))}${AGE_KEYS.map((k) => opt(k, t("age_" + k))).join("")}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="breed_f">${esc(t("breed"))}</label>
          <select id="breed_f" name="breed">${opt("", t("unknown"))}${Object.keys(BREED_LABEL).map((b) => opt(b, BREED_LABEL[b][isEn() ? 1 : 0])).join("")}</select></div>
        <div class="field"><label for="color">${esc(t("f_color"))}</label><input type="text" id="color" name="color"></div>
        <div class="field"><label for="chip">${esc(t("f_chip"))}</label><input type="text" id="chip" name="chip" inputmode="numeric"></div>
      </div>
      <div class="row">
        <div class="field"><label for="neutered_f">${esc(t("neutered"))}</label>
          <select id="neutered_f" name="neutered">${opt("", t("unknown"))}${opt("1", t("yes"))}${opt("0", t("no"))}</select></div>
        <div class="field"><label for="vaccinated_f">${esc(t("vaccinated"))}</label>
          <select id="vaccinated_f" name="vaccinated">${opt("", t("unknown"))}${opt("1", t("yes"))}${opt("0", t("no"))}</select></div>
        <div class="field"><label for="fiv_f">${esc(t("fiv_felv"))}</label>
          <select id="fiv_f" name="fiv_felv">${opt("", t("unknown"))}${opt("neg", t("neg"))}${opt("pos", t("pos"))}</select></div>
      </div>
      <div class="field"><label for="health_note">${esc(t("f_health_note"))}</label><input type="text" id="health_note" name="health_note"></div>
      <div class="field"><label for="description">${esc(t("f_desc"))} *</label><textarea id="description" name="description"></textarea><div class="err" data-err="description"></div></div>
      <div class="field"><label for="photo">${esc(t("f_photo"))}</label><input type="file" id="photo" name="photo" accept="image/*"><img class="preview-img" id="pv" alt="" hidden><div class="err" data-err="photo"></div></div>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px">
        <legend>${esc(t("contact"))} *</legend>
        <div class="row">
          <div class="field"><label for="contact_name">${esc(t("f_name_contact"))} *</label><input type="text" id="contact_name" name="contact_name"><div class="err" data-err="contact_name"></div></div>
          <div class="field"><label for="contact_phone">${esc(t("f_phone"))}</label><input type="tel" id="contact_phone" name="contact_phone"><div class="err" data-err="contact_phone"></div></div>
          <div class="field"><label for="contact_line">${esc(t("f_line"))}</label><input type="text" id="contact_line" name="contact_line"></div>
          <div class="field"><label for="contact_other">${esc(t("f_other"))}</label><input type="text" id="contact_other" name="contact_other"></div>
        </div>
        <div class="meta">${esc(t("contact_hint"))}</div><div class="err" data-err="contact"></div>
      </fieldset>
      <div id="result"></div>
      <div><button class="btn" id="submit" type="submit">${esc(t("submit"))}</button></div>
    </form>
  </section>`;

  const setVal = (id, v) => { if (v != null && v !== "") $("#" + id).value = v; };
  $("#detect").onclick = async () => {
    const text = $("#paste").value;
    if (!text.trim()) return;
    const { body: d } = await api("/api/cats/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!d) return;
    setVal("description", $("#description").value || text);
    setVal("region_f", d.region); setVal("district", d.district); setVal("breed_f", d.breed); setVal("color", d.color);
    setVal("age_months", d.age_months); setVal("age_group_f", d.age_group !== "unknown" ? d.age_group : "");
    setVal("contact_phone", d.contact.phone); setVal("contact_line", d.contact.line); setVal("contact_other", d.contact.other);
    if (d.neutered != null) $("#neutered_f").value = d.neutered ? "1" : "0";
    if (d.vaccinated != null) $("#vaccinated_f").value = d.vaccinated ? "1" : "0";
    if (d.fiv_felv) $("#fiv_f").value = d.fiv_felv;
    $("#detected").textContent = " " + t("up_detected");
  };
  $("#photo").onchange = (e) => {
    const f = e.target.files[0];
    $("#pv").hidden = !f;
    if (f) $("#pv").src = URL.createObjectURL(f);
  };
  $("#upForm").onsubmit = submitUpload;
}

async function submitUpload(e) {
  e.preventDefault();
  document.querySelectorAll("[data-err]").forEach((x) => (x.textContent = ""));
  const btn = $("#submit");
  btn.disabled = true; btn.textContent = t("submitting");
  const fd = new FormData($("#upForm"));
  const { status, body } = await api("/api/cats", { method: "POST", body: fd });
  btn.disabled = false; btn.textContent = t("submit");
  const out = $("#result");
  if (status === 201 || status === 202) {
    const rec = { id: body.id, token: body.edit_token, title: (fd.get("name") || fd.get("description") || "").toString().slice(0, 40) };
    mineAdd(rec.id, rec.token, rec.title);
    const link = manageUrl(rec);
    out.innerHTML = `<div class="notice ${status === 201 ? "good" : "warn"}"><strong>${esc(t(status === 201 ? "ok_posted" : "pending_review"))}</strong>
      <p><a href="#/mine">${esc(t("nav_mine"))}</a></p>
      <div class="meta"><strong>${esc(t("manage_title"))}</strong><br>${esc(t("manage_hint"))}</div>
      <div class="actions" style="margin-top:8px"><input type="text" readonly value="${esc(link)}" id="mlink" style="flex:1;min-width:200px"><button class="btn small" id="mcopy" type="button">${esc(t("act_copy"))}</button></div></div>`;
    $("#mcopy").onclick = (e) => copyText(link, e.target);
    $("#upForm").reset(); $("#pv").hidden = true;
  } else if (status === 409) {
    out.innerHTML = `<div class="notice bad"><strong>${esc(t("dup_blocked"))}</strong>
      <div class="meta">${esc(t("dup_reason"))}: ${esc(t("r_" + body.reason))}</div>
      <div style="margin-top:10px;max-width:340px">${miniHtml(body.existing)}</div></div>`;
  } else if (status === 400 && body?.fields) {
    for (const [k, v] of Object.entries(body.fields)) {
      const el = document.querySelector(`[data-err="${k}"]`);
      if (el) el.textContent = t("err_" + v);
    }
    out.innerHTML = "";
    const first = document.querySelector("[data-err]:not(:empty)");
    if (first) first.scrollIntoView({ block: "center" });
  } else {
    out.innerHTML = `<div class="notice bad">${esc(t("err_generic"))}</div>`;
  }
}

// ---------- duplicate review (local admin only): choose which listing stays ----------
async function renderReview() {
  const { ok, body } = await api("/api/review");
  if (!ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const kept = (d) => (d.kept === "new" ? t("rv_kept_new") : d.decision === "different" ? t("rv_decided_diff") : t("rv_kept_existing"));
  const pair = (it, withKeep) => `
    <div class="pair">
      <div class="pair-col"><h4>${esc(t("rv_new"))}</h4>${miniHtml(it.new)}${withKeep ? `<button class="btn good" data-decide="keep_new" type="button" style="margin-top:8px">${esc(t("rv_keep_new"))}</button>` : ""}</div>
      <div class="pair-col"><h4>${esc(t("rv_existing"))}</h4>${miniHtml(it.existing)}${withKeep ? `<button class="btn good" data-decide="keep_existing" type="button" style="margin-top:8px">${esc(t("rv_keep_existing"))}</button>` : ""}</div>
    </div>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("rv_title"))}</h1>
    <p class="meta">${esc(t("rv_intro"))}</p>
    ${body.pending.length ? body.pending.map((it) => `
      <div class="review-item" data-cand="${it.cand_id}">
        <div class="meta">${esc(t("rv_reason"))}: <strong>${esc(t("r_" + it.reason))}</strong></div>
        ${pair(it, true)}
        <label class="check"><input type="checkbox" data-fill checked> ${esc(t("rv_fill"))}</label>
        <div class="actions"><button class="btn ghost" data-decide="different" type="button">${esc(t("rv_diff"))}</button></div>
      </div>`).join("") : `<p class="empty">${esc(t("rv_empty"))}</p>`}
    ${body.decided.length ? `<h2>${esc(t("rv_history"))}</h2>` + body.decided.map((it) => `
      <div class="review-item" data-cand="${it.cand_id}">
        <div class="meta"><strong>${esc(kept(it))}</strong> · ${esc(t("r_" + it.reason))}
          <button class="linkbtn" data-decide="undo" type="button">${esc(t("rv_undo"))}</button></div>
        ${pair(it, false)}
      </div>`).join("") : ""}
  </section>`;
  $("#app").onclick = async (e) => {
    const b = e.target.closest("[data-decide]");
    if (!b) return;
    const box = b.closest("[data-cand]");
    const fill = box.querySelector("[data-fill]");
    await api("/api/review/" + box.dataset.cand, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: b.dataset.decide, fill: fill ? fill.checked : true }) });
    await refreshAdmin();
    renderReview();
  };
}

// ---------- shell ----------
async function refreshAdmin() {
  const [r, rp, ph] = await Promise.all([api("/api/review/count"), api("/api/reports/count"), api("/api/photos/count")]);
  state.missingPhotos = ph.ok ? ph.body.missing : 0;
  state.isAdminReal = r.ok;
  state.isAdmin = r.ok && !state.visitorPreview;  // preview shows the site as a poster or visitor sees it
  state.pendingReview = r.ok ? r.body.pending : 0;
  state.openReports = rp.ok ? rp.body.open : 0;
  renderNav();
}

function renderNav() {
  const route = location.hash.replace(/^#/, "") || "/";
  const items = [["/", "nav_browse", 0], ["/upload", "nav_upload", 0], ["/mine", "nav_mine", 0]];
  if (state.isAdmin) items.push(["/review", "nav_review", state.pendingReview], ["/reports", "nav_reports", state.openReports], ["/photos", "nav_photos", state.missingPhotos], ["/edits", "nav_edits", 0]);
  $("#nav").innerHTML = items.map(([href, key, n]) =>
    `<a href="#${href}" class="${route === href ? "active" : ""}">${esc(t(key))}${n ? `<span class="badge">${n}</span>` : ""}</a>`).join("");
  $("#brandText").textContent = t("brand");
  $("#foot").textContent = t("foot");
  if (state.isAdminReal) {  // the admin can look at the site as a visitor sees it
    const b = document.createElement("button");
    b.className = "linkbtn"; b.style.marginInlineStart = "12px"; b.textContent = t(state.visitorPreview ? "preview_off" : "preview_on");
    b.onclick = () => { state.visitorPreview = !state.visitorPreview; sessionStorage.setItem("preview", state.visitorPreview ? "1" : "0"); location.hash = "#/"; refreshAdmin().then(route); };
    $("#foot").appendChild(b);
  }
  document.documentElement.lang = isEn() ? "en" : "zh-Hant";
  document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
}

async function route() {
  const r = location.hash.replace(/^#/, "") || "/";
  if (!state.meta) state.meta = (await api("/api/meta")).body;
  renderNav();
  if ($("#detail").open) $("#detail").close();
  $("#app").onclick = null;
  if (r === "/upload") renderUpload();
  else if (r === "/mine") renderMine();
  else if (r.startsWith("/edit/")) renderEdit(r.slice(6));
  else if (r.startsWith("/manage/")) manageLink(r);
  else if (r === "/edits" && state.isAdmin) renderEdits();
  else if (r === "/review" && state.isAdmin) renderReview();
  else if (r === "/reports" && state.isAdmin) renderReports();
  else if (r === "/photos" && state.isAdmin) renderPhotos();
  else renderBrowse();
}

// ---------- visitor reports (local admin only) ----------
async function renderReports() {
  const [open, done] = await Promise.all([api("/api/reports?status=open"), api("/api/reports?status=done")]);
  if (!open.ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const item = (r, handled) => `
    <div class="review-item" data-report="${r.id}">
      <div class="meta"><strong>${esc(t("rp_kind_" + r.kind))}</strong> · ${esc(r.created_at.replace("T", " "))}
        ${handled ? ` · ${esc(t(r.status === "dismissed" ? "rp_dismissed" : "rp_resolved"))}` : ""}
        ${r.contact ? ` · ${esc(t("rp_from"))}: ${esc(r.contact)}` : ""}</div>
      ${r.message ? `<div class="desc">${esc(r.message)}</div>` : ""}
      <div style="max-width:360px">${r.cat ? miniHtml(r.cat) : esc(t("rp_no_cat"))}</div>
      <div class="actions">
        ${handled
          ? `<button class="btn ghost" data-act="reopen" type="button">${esc(t("rp_reopen"))}</button>`
          : `<button class="btn good" data-act="resolve" type="button">${esc(t("rp_resolve"))}</button>
             <button class="btn ghost" data-act="dismiss" type="button">${esc(t("rp_dismiss"))}</button>
             ${r.cat ? `<button class="btn ghost" data-act="close_cat" type="button">${esc(t("rp_close_cat"))}</button>` : ""}`}
      </div>
    </div>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("rp_title"))}</h1>
    <p class="meta">${esc(t("rp_intro_admin"))}</p>
    ${open.body.items.length ? open.body.items.map((r) => item(r, false)).join("") : `<p class="empty">${esc(t("rp_empty"))}</p>`}
    ${done.body.items.length ? `<h2>${esc(t("rp_history"))}</h2>` + done.body.items.map((r) => item(r, true)).join("") : ""}
  </section>`;
  $("#app").onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    await api("/api/reports/" + b.closest("[data-report]").dataset.report, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.act }),
    });
    await refreshAdmin();
    renderReports();
  };
}

// ---------- listings without a photo (local admin only): add one by hand ----------
async function renderPhotos() {
  const { ok, body } = await api("/api/photos/missing");
  if (!ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const item = (c) => `
    <div class="review-item" data-cat="${c.id}">
      <div class="meta"><strong>${esc(titleOf(c))}</strong> · ${esc(sourceLabel(c.source))} · ${esc(regionLabel(c.region))}${c.contact_name ? " · " + esc(c.contact_name) : ""}</div>
      <div class="snip" style="white-space:pre-line;color:var(--muted)">${esc((c.description || "").slice(0, 160))}</div>
      <div>${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(t("ph_open_post"))} ↗</a>` : `<span class="meta">${esc(t("ph_no_url"))}</span>`}</div>
      <div class="dropzone" tabindex="0" data-paste>${esc(t("ph_paste"))}</div>
      <div class="row">
        <div class="field"><label>${esc(t("ph_file"))}</label><input type="file" accept="image/*" data-file></div>
        <div class="field"><label>${esc(t("ph_url"))}</label><input type="url" placeholder="https://" data-url></div>
      </div>
      <div data-res></div>
      <div class="actions"><button class="btn good" data-save type="button">${esc(t("ph_save"))}</button></div>
    </div>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("ph_title"))}</h1>
    <p class="meta">${esc(t("ph_intro"))}</p>
    ${body.items.length ? body.items.map(item).join("") : `<p class="empty">${esc(t("ph_empty"))}</p>`}
  </section>`;
  const send = async (box, blob) => {
    const res = box.querySelector("[data-res]"), fd = new FormData();
    if (blob) fd.append("photo", blob, "photo.png");
    else if (box.querySelector("[data-file]").files[0]) fd.append("photo", box.querySelector("[data-file]").files[0]);
    else if (box.querySelector("[data-url]").value.trim()) fd.append("url", box.querySelector("[data-url]").value.trim());
    else { res.innerHTML = `<div class="notice warn">${esc(t("ph_choose"))}</div>`; return; }
    res.innerHTML = `<div class="notice">${esc(t("saving") || "…")}</div>`;
    const r = await api(`/api/cats/${box.dataset.cat}/photo`, { method: "POST", body: fd });
    if (r.ok) { await refreshAdmin(); renderPhotos(); } else res.innerHTML = `<div class="notice bad">${esc(t("ph_failed"))}</div>`;
  };
  $("#app").onclick = (e) => { const b = e.target.closest("[data-save]"); if (b) send(b.closest("[data-cat]")); };
  $("#app").onpaste = (e) => {
    const zone = e.target.closest && e.target.closest("[data-paste]");
    const file = zone && [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); send(zone.closest("[data-cat]"), file); }
  };
}

// ---------- posters: their listings are remembered in this browser; the server checks the secret ----------
const MINE_KEY = "catadopt-mine";
const mineList = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || "[]"); } catch (_) { return []; } };
const mineSave = (list) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 100))); } catch (_) { /* storage full or off */ } };
const mineGet = (id) => mineList().find((m) => String(m.id) === String(id));
function mineAdd(id, token, title) { mineSave([{ id, token, title, at: Date.now() }, ...mineList().filter((m) => String(m.id) !== String(id))]); }
const manageUrl = (m) => `${location.origin}${location.pathname}#/manage/${m.id}/${m.token}`;
const tokenHeader = (m) => (m ? { "X-Edit-Token": m.token } : {});
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (_) { prompt("", text); }
  if (btn) { const o = btn.textContent; btn.textContent = t("copied"); setTimeout(() => { btn.textContent = o; }, 1500); }
}
async function manageLink(route) {  // #/manage/<id>/<secret>: restore a listing on another device
  const [, , id, token] = route.split("/");
  const { body } = await api("/api/mine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ id, token }] }) });
  if (body && body.items && body.items.length) mineAdd(id, token, body.items[0].title);
  location.hash = "#/mine";
}

// what the admin or the poster can do with one listing
function manageHtml(c, rec) {
  const notes = [];
  if (c.review === "pending") notes.push(`<span class="tag warn">${esc(t("mine_pending"))}</span>`);
  if (c.status === "closed") notes.push(`<span class="tag warn">${esc(t("mine_closed"))}</span>`);
  let buttons = "";
  if (c.source === "shelter") buttons = "";
  else if (state.isAdmin) {
    buttons = `<button class="btn small" data-act="edit" type="button">${esc(t("act_edit"))}</button>
      <button class="btn ghost small" data-act="history" type="button">${esc(t("act_history"))}</button>
      <button class="btn ghost small" data-act="${c.status === "closed" ? "relist" : "unlist"}" type="button">${esc(t(c.status === "closed" ? "act_relist" : "act_unlist"))}</button>`;
  } else if (rec && c.source === "user") {
    buttons = `<button class="btn small" data-act="edit" type="button">${esc(t("act_edit"))}</button>
      ${c.status === "closed" ? "" : `<button class="btn ghost small" data-act="unlist" type="button">${esc(t("act_unlist"))}</button>`}
      <button class="btn ghost small" data-act="copy" type="button">${esc(t("act_copy"))}</button>`;
  }
  if (!notes.length && !buttons) return "";
  return `<div class="manage">${notes.join(" ")}<div class="actions">${buttons}</div><div id="histbox"></div></div>`;
}
function wireManage(c, rec) {
  const d = $("#detail");
  d.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.dataset.act, hdr = state.isAdmin ? {} : tokenHeader(rec);
      if (act === "edit") { d.close(); location.hash = "#/edit/" + c.id; }
      else if (act === "copy") copyText(manageUrl(rec), btn);
      else if (act === "history") showHistory(c.id);
      else if (act === "unlist") {
        if (!confirm(t("unlist_confirm"))) return;
        await api("/api/cats/" + c.id, { method: "DELETE", headers: hdr });
        d.close(); await refreshAdmin(); route();
      } else if (act === "relist") {
        await api("/api/cats/" + c.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "open" }) });
        await refreshAdmin(); openDetail(c.id);
      }
    };
  });
}

// ---------- edit history (admin only): every change with before / after, and a way back ----------
const fldLabel = (k) => { const v = t("fld_" + k); return v === "fld_" + k ? k : v; };
function fmtVal(k, v) {
  if (v === null || v === undefined || v === "") return t("hist_empty_val");
  if (k === "health_tags") { try { return JSON.parse(v).map((x) => (HEALTH_LABEL[x] ? HEALTH_LABEL[x][isEn() ? 1 : 0] : x)).join("、") || t("hist_empty_val"); } catch (_) { return String(v); } }
  if (k === "neutered" || k === "vaccinated") return v ? t("yes") : t("no");
  if (k === "sex") return sexLabel(v);
  if (k === "status") return t(v === "closed" ? "st_closed" : "st_open");
  if (k === "photo_hash" || k === "age_months_post") return String(v);
  const x = String(v); return x.length > 90 ? x.slice(0, 90) + "…" : x;
}
function editRow(e, showCat) {
  const who = t(e.actor === "owner" ? "hist_by_owner" : "hist_by_admin");
  const keys = Object.keys(e.after).filter((k) => k !== "photo_hash" && k !== "age_months_post");
  return `<div class="edit-row" data-edit="${e.id}">
    <div class="meta">${esc(e.created_at.replace("T", " "))} · <strong>${esc(who)}</strong>${e.note ? " · " + esc(e.note) : ""}${showCat ? ` · <a href="#" data-opencat="${e.cat_id}">${esc(e.cat_name || e.cat_title || "#" + e.cat_id)}</a>` : ""}</div>
    <ul class="diff">${keys.map((k) => `<li><b>${esc(fldLabel(k))}</b>：${esc(fmtVal(k, e.before[k]))} → ${esc(fmtVal(k, e.after[k]))}</li>`).join("")}</ul>
    ${e.reverted_by ? `<span class="tag">${esc(t("hist_reverted"))}</span>` : `<button class="btn ghost small" data-revert="${e.id}" type="button">${esc(t("hist_revert"))}</button>${e.is_current ? "" : ` <span class="meta">${esc(t("hist_later"))}</span>`}`}
  </div>`;
}
async function showHistory(catId) {
  const box = $("#histbox");
  const { body } = await api("/api/admin/edits?cat_id=" + catId);
  box.innerHTML = `<div class="meta">${esc(t("hist_intro"))}</div>` + (body.items.length ? body.items.map((e) => editRow(e, false)).join("") : `<p class="meta">${esc(t("hist_empty"))}</p>`);
  box.onclick = async (ev) => {
    const b = ev.target.closest("[data-revert]");
    if (!b) return;
    await api("/api/admin/edits/" + b.dataset.revert + "/revert", { method: "POST" });
    await refreshAdmin(); openDetail(catId);
  };
}
async function renderEdits() {
  const { ok, body } = await api("/api/admin/edits?limit=200");
  if (!ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  $("#app").innerHTML = `<section class="panel"><h1>${esc(t("hist_title"))}</h1><p class="meta">${esc(t("hist_intro"))}</p>
    ${body.items.length ? body.items.map((e) => editRow(e, true)).join("") : `<p class="empty">${esc(t("hist_empty"))}</p>`}</section>`;
  $("#app").onclick = async (ev) => {
    const r = ev.target.closest("[data-revert]"), o = ev.target.closest("[data-opencat]");
    if (o) { ev.preventDefault(); openDetail(o.dataset.opencat); }
    if (r) { await api("/api/admin/edits/" + r.dataset.revert + "/revert", { method: "POST" }); await refreshAdmin(); renderEdits(); }
  };
}

// ---------- my listings (this browser) ----------
async function renderMine() {
  const recs = mineList();
  $("#app").innerHTML = `<section class="panel"><h1>${esc(t("mine_title"))}</h1><p class="meta">${esc(t("mine_intro"))}</p><div id="minebox"><p class="meta">…</p></div></section>`;
  const { body } = recs.length ? await api("/api/mine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: recs.map(({ id, token }) => ({ id, token })) }) }) : { body: { items: [] } };
  const items = (body && body.items) || [];
  $("#minebox").innerHTML = items.length ? items.map((c) => `
    <div class="review-item" data-id="${c.id}">
      <div style="max-width:380px">${miniHtml(c)}</div>
      <div>${c.pending ? `<span class="tag warn">${esc(t("mine_pending"))}</span>` : ""}${c.closed ? `<span class="tag warn">${esc(t("mine_closed"))}</span>` : ""}</div>
      <div class="actions"><button class="btn small" data-m="edit" type="button">${esc(t("act_edit"))}</button>
        ${c.closed ? "" : `<button class="btn ghost small" data-m="unlist" type="button">${esc(t("act_unlist"))}</button>`}
        <button class="btn ghost small" data-m="copy" type="button">${esc(t("act_copy"))}</button></div>
    </div>`).join("") : `<p class="empty">${esc(t("mine_empty"))}</p>`;
  $("#minebox").onclick = async (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id, rec = mineGet(id);
    if (b.dataset.m === "edit") location.hash = "#/edit/" + id;
    else if (b.dataset.m === "copy") copyText(manageUrl(rec), b);
    else if (b.dataset.m === "unlist" && confirm(t("unlist_confirm"))) { await api("/api/cats/" + id, { method: "DELETE", headers: tokenHeader(rec) }); renderMine(); }
  };
}

// ---------- edit form: the admin sees every field, a poster only their own ----------
async function renderEdit(id) {
  const rec = mineGet(id), admin = state.isAdmin;
  const { ok, body: c } = await api("/api/cats/" + id, { headers: admin ? {} : tokenHeader(rec) });
  if (!ok || c.source === "shelter" || (!admin && !(rec && c.source === "user"))) { $("#app").innerHTML = `<section class="panel"><div class="notice bad">${esc(t("no_perm"))}</div></section>`; return; }
  const m = state.meta || { regions: Object.keys(REGION_EN) };
  const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(l)}</option>`;
  const tri = (k) => `<select id="e_${k}">${o("", t("unknown"), c[k] == null)}${o("1", t("yes"), c[k] === true)}${o("0", t("no"), c[k] === false)}</select>`;
  const txt = (k, label, type = "text") => `<div class="field"><label for="e_${k}">${esc(label)}</label><input type="${type}" id="e_${k}" value="${esc(c[k] ?? "")}"></div>`;
  $("#app").innerHTML = `<section class="panel"><h1>${esc(t(admin ? "edit_admin_title" : "edit_title"))}</h1>
    <p class="meta">${esc(titleOf(c))}${admin ? " · " + esc(t("hist_intro")) : ""}</p>
    <form class="form" id="eform" novalidate>
      <div class="row">${txt("name", t("f_name"))}
        <div class="field"><label for="e_region">${esc(t("region"))}</label><select id="e_region"><option value="">—</option>${m.regions.map((r) => o(r, regionLabel(r), c.region === r)).join("")}</select><div class="err" data-err="region"></div></div>
        ${txt("district", t("f_district"))}</div>
      <div class="row"><div class="field"><label for="e_sex">${esc(t("sex"))}</label><select id="e_sex">${["U", "M", "F"].map((k) => o(k, sexLabel(k), c.sex === k)).join("")}</select></div>
        <div class="field"><label for="e_age_now">${esc(t("f_age_now"))}</label><input type="number" id="e_age_now" min="0" max="300" value="${c.age_months ?? ""}"></div>
        <div class="field"><label for="e_breed">${esc(t("breed"))}</label><select id="e_breed">${o("", t("unknown"), !c.breed)}${Object.keys(BREED_LABEL).map((b) => o(b, BREED_LABEL[b][isEn() ? 1 : 0], c.breed === b)).join("")}</select></div>
        ${txt("color", t("f_color"))}</div>
      <div class="row"><div class="field"><label for="e_neutered">${esc(t("neutered"))}</label>${tri("neutered")}</div>
        <div class="field"><label for="e_vaccinated">${esc(t("vaccinated"))}</label>${tri("vaccinated")}</div>
        <div class="field"><label for="e_fiv_felv">${esc(t("fiv_felv"))}</label><select id="e_fiv_felv">${o("", t("unknown"), !c.fiv_felv)}${o("neg", t("neg"), c.fiv_felv === "neg")}${o("pos", t("pos"), c.fiv_felv === "pos")}</select></div></div>
      ${txt("health_note", t("f_health_note"))}
      <div class="field"><label for="e_description">${esc(t("f_desc"))}</label><textarea id="e_description">${esc(c.description || "")}</textarea><div class="err" data-err="description"></div></div>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px"><legend>${esc(t("contact"))}</legend>
        <div class="row">${txt("contact_name", t("f_name_contact"))}${txt("contact_phone", t("f_phone"), "tel")}${txt("contact_line", t("f_line"))}${txt("contact_other", t("f_other"))}</div>
        <div class="err" data-err="contact_name"></div><div class="err" data-err="contact"></div></fieldset>
      <div class="field"><label for="e_photo">${esc(t("edit_photo"))}</label><input type="file" id="e_photo" accept="image/*"></div>
      ${admin ? `<fieldset style="border:1px dashed var(--line);border-radius:12px;padding:12px"><legend>${esc(t("edit_admin_only"))}</legend>
        <div class="row">${txt("title", t("f_title"))}${txt("breed_text", t("f_breed_text"))}${txt("age_text", t("f_age_text"))}${txt("location_text", t("f_location_text"))}${txt("available_from", t("f_available_from"))}
          <div class="field"><label for="e_status">${esc(t("f_status"))}</label><select id="e_status">${o("open", t("st_open"), c.status !== "closed")}${o("closed", t("st_closed"), c.status === "closed")}</select></div></div>
        ${txt("source_url", t("f_source_url"), "url")}
        <div class="field"><span class="fieldset-title">${esc(t("f_tags"))}</span><div class="chips" id="e_tags">${Object.keys(HEALTH_LABEL).map((k) => `<label class="check"><input type="checkbox" value="${k}"${(c.health_tags || []).includes(k) ? " checked" : ""}> ${esc(HEALTH_LABEL[k][isEn() ? 1 : 0])}</label>`).join("")}</div></div></fieldset>` : ""}
      <div id="eres"></div>
      <div class="actions"><button class="btn" id="esave" type="submit">${esc(t("save"))}</button><a class="btn ghost" href="#/${admin ? "" : "mine"}" style="text-decoration:none">${esc(t("close"))}</a></div>
    </form></section>`;
  $("#eform").onsubmit = async (ev) => {
    ev.preventDefault();
    document.querySelectorAll("[data-err]").forEach((x) => { x.textContent = ""; });
    const v = (k) => $("#e_" + k).value.trim();
    const body = { name: v("name"), region: v("region"), district: v("district"), sex: v("sex"), age_now: v("age_now") === "" ? null : Number(v("age_now")),
      breed: v("breed"), color: v("color"), neutered: v("neutered"), vaccinated: v("vaccinated"), fiv_felv: v("fiv_felv"), health_note: v("health_note"),
      description: v("description"), contact_name: v("contact_name"), contact_phone: v("contact_phone"), contact_line: v("contact_line"), contact_other: v("contact_other") };
    if (admin) Object.assign(body, { title: v("title"), breed_text: v("breed_text"), age_text: v("age_text"), location_text: v("location_text"), available_from: v("available_from"),
      source_url: v("source_url"), status: v("status"), health_tags: [...document.querySelectorAll("#e_tags input:checked")].map((x) => x.value) });
    const btn = $("#esave"); btn.disabled = true;
    const hdr = { "Content-Type": "application/json", ...(admin ? {} : tokenHeader(rec)) };
    const r = await api("/api/cats/" + id, { method: "PUT", headers: hdr, body: JSON.stringify(body) });
    let photoFailed = false;
    const file = $("#e_photo").files[0];
    if (r.ok && file) {
      const fd = new FormData(); fd.append("photo", file);
      photoFailed = !(await api(`/api/cats/${id}/photo`, { method: "POST", headers: admin ? {} : tokenHeader(rec), body: fd })).ok;
    }
    btn.disabled = false;
    if (r.ok) { await refreshAdmin(); $("#eres").innerHTML = `<div class="notice ${photoFailed ? "warn" : "good"}">${esc(t(photoFailed ? "ph_failed" : "saved"))}</div>`; }
    else if (r.status === 400 && r.body && r.body.fields) {
      Object.entries(r.body.fields).forEach(([k, code]) => { const el = document.querySelector(`[data-err="${k}"]`) || $("#eres"); el.textContent = t("err_" + code) === "err_" + code ? `${fldLabel(k)}: ${code}` : t("err_" + code); });
    } else $("#eres").innerHTML = `<div class="notice bad">${esc(t(r.status === 403 ? "no_perm" : "err_generic"))}</div>`;
  };
}

document.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => {
  state.lang = b.dataset.lang;
  localStorage.setItem("lang", state.lang);
  route();
}));
window.addEventListener("hashchange", route);
refreshAdmin().then(route);
