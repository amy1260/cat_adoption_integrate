"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const state = {
  lang: localStorage.getItem("lang") || "zh",
  meta: null,
  isAdmin: false,
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
function ageLabel(c) {
  if (c.age_months != null) return c.age_months < 12 ? t("months", { n: c.age_months }) : t("years", { n: Math.round((c.age_months / 12) * 10) / 10 });
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
      <div class="tags">${health.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join("")}</div>
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
  const { ok, body: c } = await api("/api/cats/" + id);
  if (!ok) return;
  const rows = [];
  const add = (k, v) => v && rows.push(`<dt>${esc(t(k))}</dt><dd>${v}</dd>`);
  add("sex", esc(sexLabel(c.sex)));
  add("age", esc(ageLabel(c)));
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
    </div>`;
  $("#dlgClose").onclick = () => $("#detail").close();
  if (!$("#detail").open) $("#detail").showModal();
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
  if (status === 201) {
    out.innerHTML = `<div class="notice good"><strong>${esc(t("ok_posted"))}</strong> <a href="#/" id="gohome">${esc(t("ok_view"))}</a></div>`;
    $("#upForm").reset(); $("#pv").hidden = true;
  } else if (status === 202) {
    out.innerHTML = `<div class="notice warn">${esc(t("pending_review"))}</div>`;
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

// ---------- duplicate review (local admin only) ----------
async function renderReview() {
  const { ok, body } = await api("/api/review");
  if (!ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const pair = (it) => `
    <div class="pair">
      <div class="pair-col"><h4>${esc(t("rv_new"))}</h4>${miniHtml(it.new)}</div>
      <div class="pair-col"><h4>${esc(t("rv_existing"))}</h4>${miniHtml(it.existing)}</div>
    </div>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("rv_title"))}</h1>
    <p class="meta">${esc(t("rv_intro"))}</p>
    ${body.pending.length ? body.pending.map((it) => `
      <div class="review-item" data-cand="${it.cand_id}">
        <div class="meta">${esc(t("rv_reason"))}: <strong>${esc(t("r_" + it.reason))}</strong></div>
        ${pair(it)}
        <div class="actions">
          <button class="btn good" data-decide="same" type="button">${esc(t("rv_same"))}</button>
          <button class="btn ghost" data-decide="different" type="button">${esc(t("rv_diff"))}</button>
        </div>
      </div>`).join("") : `<p class="empty">${esc(t("rv_empty"))}</p>`}
    ${body.decided.length ? `<h2>${esc(t("rv_history"))}</h2>` + body.decided.map((it) => `
      <div class="review-item" data-cand="${it.cand_id}">
        <div class="meta">${esc(it.decision === "same" ? t("rv_decided_same") : t("rv_decided_diff"))} · ${esc(t("r_" + it.reason))}
          <button class="linkbtn" data-decide="undo" type="button">${esc(t("rv_undo"))}</button></div>
        ${pair(it)}
      </div>`).join("") : ""}
  </section>`;
  $("#app").onclick = async (e) => {
    const b = e.target.closest("[data-decide]");
    if (!b) return;
    const id = b.closest("[data-cand]").dataset.cand;
    await api("/api/review/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: b.dataset.decide }) });
    await refreshAdmin();
    renderReview();
  };
}

// ---------- shell ----------
async function refreshAdmin() {
  const r = await api("/api/review/count");
  state.isAdmin = r.ok;
  state.pendingReview = r.ok ? r.body.pending : 0;
  renderNav();
}

function renderNav() {
  const route = location.hash.replace(/^#/, "") || "/";
  const items = [["/", "nav_browse"], ["/upload", "nav_upload"]];
  if (state.isAdmin) items.push(["/review", "nav_review"]);
  $("#nav").innerHTML = items.map(([href, key]) =>
    `<a href="#${href}" class="${route === href ? "active" : ""}">${esc(t(key))}${href === "/review" && state.pendingReview ? `<span class="badge">${state.pendingReview}</span>` : ""}</a>`).join("");
  $("#brandText").textContent = t("brand");
  $("#foot").textContent = t("foot");
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
  else if (r === "/review" && state.isAdmin) renderReview();
  else renderBrowse();
}

document.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => {
  state.lang = b.dataset.lang;
  localStorage.setItem("lang", state.lang);
  route();
}));
window.addEventListener("hashchange", route);
refreshAdmin().then(route);
