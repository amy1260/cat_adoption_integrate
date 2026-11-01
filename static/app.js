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
    ? `<img src="${esc(c.photo)}" alt="${esc(titleOf(c))}" loading="lazy" referrerpolicy="no-referrer" data-none="${esc(t("no_photo"))}" onload="this.classList.add('in')" onerror="this.replaceWith(this.dataset.none)">`
    : `<span>${esc(t("no_photo"))}</span>`;

// post titles often carry emoji; the site shows the words
const plain = (s) => String(s ?? "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").trim();
const sourceShort = (s) => (I18N[state.lang]["srcs_" + s] ? t("srcs_" + s) : sourceLabel(s));
const placeOf = (c) => regionLabel(c.region) + (c.district ? " " + c.district : "");

// shelter cats have no name: their coat and breed are what a visitor tells them apart by (the number is in the detail)
const breedShort = (c) => (c.breed === "mixed" ? t("breed_mixed_short") : breedLabel(c));

function titleOf(c) {
  if (c.source === "shelter") return [colorLabel(c.color), breedShort(c)].filter(Boolean).join(" ") || c.shelter_no || "—";
  return plain(c.name || c.title) || "—";
}

function cardHtml(c) {
  // short enough for one line on a phone: the breed only when it is not an ordinary mixed cat
  const facts = [sexLabel(c.sex), ageLabel(c), c.source === "shelter" ? null : colorLabel(c.color),
    c.source !== "shelter" && c.breed && c.breed !== "mixed" ? breedLabel(c) : null].filter(Boolean).join(" · ");
  const health = healthTags(c).slice(0, 2);
  return `
  <button class="card" data-id="${c.id}" type="button">
    <div class="photo">${photoHtml(c)}</div>
    <div class="card-body">
      <h3>${esc(titleOf(c))}</h3>
      <div class="facts">${esc(facts)}</div>
      <div class="tags">${health.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join("")}${state.isAdmin && c.needs_photo ? `<span class="tag warn">${esc(t("ph_tag"))}</span>` : ""}</div>
      <div class="meta">${esc(sourceShort(c.source))} · ${esc(placeOf(c))}</div>
    </div>
  </button>`;
}

function miniHtml(c) {
  const tags = [sexLabel(c.sex), ageLabel(c), breedLabel(c), colorLabel(c.color)].filter(Boolean);
  const contact = [c.contact_name, c.contact_phone, c.contact_line && "LINE " + c.contact_line].filter(Boolean).join(" · ");
  return `
  <div class="mini">
    <div class="photo">${photoHtml(c)}</div>
    <div class="body">
      <strong>${esc(titleOf(c))}</strong>
      <div class="tags">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="meta">${esc(sourceLabel(c.source))} · ${esc(regionLabel(c.region))} · ${esc(fmtDate(c.posted_at) || "")}</div>
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
      <div class="photo">${photoHtml(c)}</div>
      <h2>${esc(titleOf(c))}</h2>
      <div class="dlg-src">${esc(sourceLabel(c.source))} · ${esc(placeOf(c))}</div>
      ${c.source_url ? `<div class="dlg-actions"><a class="btn" href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(t("view_source"))}</a></div>` : ""}
      <dl class="kv">${rows.join("")}</dl>
      ${c.description ? `<div><div class="fieldset-title">${esc(t("description"))}</div><div class="desc">${esc(c.description)}</div></div>` : ""}
      ${(c.also_listed || []).length ? `<div class="meta">${esc(t("also_listed", { n: c.also_listed.length }))}${also.map((a) => ` · <a href="${esc(a.source_url)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel(a.source))}</a>`).join("")}</div>` : ""}
      ${manageHtml(c)}
      <div class="report">
        <button type="button" class="linkbtn" id="reportToggle" aria-expanded="false" aria-controls="reportForm">${esc(t("rp_open"))}</button>
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
  $("#dlgClose").onclick = () => { $("#detail").close(); leaveCatLink(); };
  wireReport(c.id);
  wireManage(c);
  if (!$("#detail").open) $("#detail").showModal();
}

function wireReport(catId) {
  const form = $("#reportForm"), toggle = $("#reportToggle");
  toggle.onclick = () => {
    form.hidden = !form.hidden;
    toggle.setAttribute("aria-expanded", String(!form.hidden));
    toggle.textContent = t(form.hidden ? "rp_open" : "rp_close");
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
// closing a cat opened from a link leaves the list's address, without reloading the list; done on the close button
// and the backdrop as well as on "close", which not every browser fires
const leaveCatLink = () => { if (location.hash.startsWith("#/cat/")) history.replaceState(null, "", "#/"); };
$("#detail").addEventListener("close", leaveCatLink);
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") { e.target.close(); leaveCatLink(); } });

// ---------- browse ----------
const AGE_KEYS = ["kitten", "adult", "senior"];
const SOURCE_KEYS = ["shelter", "fb_aimao"];

function chipGroup(name, keys, labelFn) {
  return `<div class="chips" data-chips="${name}">${keys.map((k) => `<button type="button" class="chip${state.f[name] === k ? " on" : ""}" data-v="${k}">${esc(labelFn(k))}</button>`).join("")}</div>`;
}

async function renderBrowse() {
  state.meta = (await api("/api/meta")).body;
  const m = state.meta;
  const regions = m.regions.filter((r) => m.by_region[r]);
  const breeds = Object.keys(m.breeds).filter((b) => BREED_LABEL[b]);
  $("#app").innerHTML = `
    <div class="layout">
      <aside class="filters" id="filters" aria-label="${esc(t("filters"))}">
        <div class="filters-head"><span>${esc(t("filters"))}</span><button class="linkbtn" id="reset" type="button">${esc(t("reset"))}</button></div>
        <div class="field"><label for="q">${esc(t("search_ph"))}</label><input type="search" id="q" value="${esc(state.f.q)}"></div>
        <div class="field"><label for="region">${esc(t("region"))}</label>
          <select id="region"><option value="">${esc(t("all_regions"))}</option>
          ${regions.map((r) => `<option value="${r}"${state.f.region === r ? " selected" : ""}>${esc(regionLabel(r))} (${m.by_region[r]})</option>`).join("")}</select></div>
        <div class="field"><span class="fieldset-title">${esc(t("sex"))}</span>${chipGroup("sex", ["M", "F"], sexLabel)}</div>
        <div class="field"><span class="fieldset-title">${esc(t("age"))}</span>${chipGroup("age_group", AGE_KEYS, (k) => t("age_" + k))}</div>
        <div class="field"><label for="breed">${esc(t("breed"))}</label>
          <select id="breed"><option value="">${esc(t("all"))}</option>
          ${breeds.map((b) => `<option value="${b}"${state.f.breed === b ? " selected" : ""}>${esc(BREED_LABEL[b][isEn() ? 1 : 0])} (${m.breeds[b]})</option>`).join("")}</select></div>
        <div class="field"><span class="fieldset-title">${esc(t("health"))}</span>
          <label class="check"><input type="checkbox" id="neutered"${state.f.neutered ? " checked" : ""}> ${esc(t("neutered_only"))}</label>
          <label class="check"><input type="checkbox" id="vaccinated"${state.f.vaccinated ? " checked" : ""}> ${esc(t("vaccinated_only"))}</label>
          <label class="check"><input type="checkbox" id="fiv"${state.f.fiv ? " checked" : ""}> ${esc(t("fiv_neg"))}</label></div>
        <button class="btn filters-done" id="filtersDone" type="button">${esc(t("filters_done", { n: "…" }))}</button>
      </aside>
      <section class="sheet" aria-live="polite">
        <div class="hero"><img src="/static/hero-1920.webp" srcset="/static/hero-800.webp 800w, /static/hero-1920.webp 1920w"
          sizes="(max-width: 860px) 100vw, 75vw" width="1920" height="800" alt="${esc(t("hero_alt"))}" fetchpriority="high">
          <div class="hero-text"><h1>${esc(t("screen_title"))}</h1>
            <p>${esc(t("screen_sub"))}${m.updated ? ` · <span class="nowrap">${esc(t("updated", { d: m.updated }))}</span>` : ""}</p></div></div>
        <div class="titlerow">
          <div class="tools">
            <button class="btn ghost filters-toggle" id="filtersToggle" type="button" aria-controls="filters" aria-expanded="false">${esc(t("filters"))}</button>
            <label class="sortlabel">${esc(t("sort"))} <select id="sort">
              ${[["new", "sort_new"], ["age", "sort_age"], ["age_desc", "sort_age_desc"]].map(([v, k]) => `<option value="${v}"${state.f.sort === v ? " selected" : ""}>${esc(t(k))}</option>`).join("")}
            </select></label>
          </div>
        </div>
        <div class="counts" id="counts" role="group" aria-label="${esc(t("source"))}"></div>
        <div class="grid" id="grid"></div>
        <div class="pager" id="pager"></div>
      </section>
    </div>`;
  wireFilters();
  return loadCats();
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
  $("#counts").onclick = (e) => { const b = e.target.closest(".count"); if (b) { state.f.source = b.dataset.v; refresh(); } };
  // phone: the filters open above the list and scroll into view; 確定 folds them away and goes to the results
  const motion = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  $("#filtersToggle").onclick = (e) => {
    const open = $("#filters").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    if (open) $("#filters").scrollIntoView({ behavior: motion(), block: "start" });
  };
  $("#filtersDone").onclick = () => {
    $("#filters").classList.remove("open");
    $("#filtersToggle").setAttribute("aria-expanded", "false");
    $("#counts").scrollIntoView({ behavior: motion(), block: "start" });
  };
}

async function loadCats() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.f)) if (v !== "" && v != null) p.set(k, v);
  p.set("per_page", 24);
  const { body } = await api("/api/cats?" + p);
  if (!body) return;
  // the source counts follow every other filter, so each card says how many it would show
  const bs = body.by_source || {};
  const counts = [["", t("src_all"), Object.values(bs).reduce((a, b) => a + b, 0)], ...SOURCE_KEYS.map((k) => [k, sourceLabel(k), bs[k] || 0])];
  $("#counts").innerHTML = counts.map(([v, label, n]) =>
    `<button type="button" class="count${state.f.source === v ? " on" : ""}" data-v="${v}" aria-pressed="${state.f.source === v}"><span>${esc(label)}</span><b>${n.toLocaleString()}</b></button>`).join("");
  $("#grid").innerHTML = body.items.length ? body.items.map(cardHtml).join("") : `<p class="empty" style="grid-column:1/-1">${esc(t("no_results"))}</p>`;
  $("#filtersDone").textContent = t("filters_done", { n: body.total.toLocaleString() });
  const pages = Math.max(1, Math.ceil(body.total / body.per_page));
  const first = (body.page - 1) * body.per_page + 1, last = Math.min(body.total, body.page * body.per_page);
  $("#pager").innerHTML = pages > 1
    ? `<button class="btn ghost" id="prev" type="button"${body.page <= 1 ? " disabled" : ""}>${esc(t("prev"))}</button>
       <span class="num">${esc(t("range", { a: first.toLocaleString(), b: last.toLocaleString(), n: body.total.toLocaleString() }))}</span>
       <button class="btn ghost" id="next" type="button"${body.page >= pages ? " disabled" : ""}>${esc(t("next"))}</button>` : "";
  if (pages > 1) {
    $("#prev").onclick = () => { state.f.page--; loadCats(); window.scrollTo({ top: 0 }); };
    $("#next").onclick = () => { state.f.page++; loadCats(); window.scrollTo({ top: 0 }); };
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
  state.isAdmin = r.ok && !state.visitorPreview;  // preview shows the site as a visitor sees it
  state.pendingReview = r.ok ? r.body.pending : 0;
  state.openReports = rp.ok ? rp.body.open : 0;
  renderNav();
}

// the page's close: where the cats come from, and how to reach every public shelter
const SOURCES = [
  ["foot_src_pet", "https://www.pet.gov.tw/AnimalApp/AnnounceMent.aspx?PageType=Adopt"],
  ["foot_src_fb", "https://www.facebook.com/groups/1612153615732604"],
];
const telHref = (p) => "tel:" + p.split(/分機|轉|#|ext/i)[0].replace(/[^\d+]/g, "");
function footHtml() {
  const shelters = (state.meta && state.meta.shelters) || [];
  const byRegion = [];
  for (const s of shelters) {
    const last = byRegion[byRegion.length - 1];
    if (last && last.region === s.region) last.list.push(s); else byRegion.push({ region: s.region, list: [s] });
  }
  const shelter = (s) => `<li>
      <button class="linkbtn" type="button" data-shelter="${esc(s.name)}">${esc(s.name)}</button>
      <span class="meta">${esc(s.cats ? t("foot_cats", { n: s.cats }) : t("foot_no_cats"))}</span>
      <div class="sh-contact">${s.phone ? `<a href="${esc(telHref(s.phone))}">${esc(s.phone)}</a>` : ""}${s.phone && s.address ? " · " : ""}${s.address
        ? `<a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(s.address)}" target="_blank" rel="noopener noreferrer">${esc(s.address)}</a>` : ""}</div>
    </li>`;
  return `<div class="foot-name">${esc(t("brand"))}</div>
    <div class="foot-cols">
      <div class="foot-col">
        <h2 class="foot-h">${esc(t("foot_sources"))}</h2>
        <ul class="foot-links">${SOURCES.map(([k, href]) => `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${esc(t(k))} ↗</a></li>`).join("")}</ul>
        <p>${esc(t("foot"))}</p>
      </div>
      ${shelters.length ? `<div class="foot-col">
        <h2 class="foot-h">${esc(t("foot_shelters"))}</h2>
        <details class="shelters"><summary>${esc(t("foot_shelters_open", { n: shelters.length }))}</summary>
          ${byRegion.map((g) => `<div class="sh-region"><h3>${esc(regionLabel(g.region))}</h3><ul>${g.list.map(shelter).join("")}</ul></div>`).join("")}
        </details>
      </div>` : ""}
    </div>`;
}

// a shelter's name in the footer shows that shelter's cats
async function showShelter(name) {
  Object.assign(state.f, { q: name, region: "", sex: "", age_group: "", source: "", breed: "", neutered: "", vaccinated: "", fiv: "", page: 1 });
  if ($("#detail").open) $("#detail").close();
  if (location.hash && location.hash !== "#/") history.replaceState(null, "", "#/");
  $("#app").onclick = null;
  renderNav();
  await renderBrowse();
  $("#counts").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function renderNav() {
  const route = location.hash.replace(/^#/, "") || "/";
  const items = [["/", "nav_browse", 0]];
  if (state.isAdmin) items.push(["/review", "nav_review", state.pendingReview], ["/reports", "nav_reports", state.openReports], ["/photos", "nav_photos", state.missingPhotos], ["/edits", "nav_edits", 0]);
  $("#nav").innerHTML = items.length < 2 ? "" : items.map(([href, key, n]) =>
    `<a href="#${href}" class="${route === href ? "active" : ""}">${esc(t(key))}${n ? `<span class="badge">${n}</span>` : ""}</a>`).join("");
  $("#brandText").textContent = t("brand");
  $("#foot").innerHTML = footHtml();
  $("#foot").onclick = (e) => { const b = e.target.closest("[data-shelter]"); if (b) showShelter(b.dataset.shelter); };
  if (state.isAdminReal) {  // the admin can look at the site as a visitor sees it
    const b = document.createElement("button");
    b.className = "linkbtn"; b.style.marginInlineStart = "12px"; b.textContent = t(state.visitorPreview ? "preview_off" : "preview_on");
    b.onclick = () => { state.visitorPreview = !state.visitorPreview; sessionStorage.setItem("preview", state.visitorPreview ? "1" : "0"); location.hash = "#/"; refreshAdmin().then(route); };
    $("#foot").appendChild(b);
    const pub = document.createElement("div");
    pub.id = "pubState"; pub.className = "pub-state";
    $("#foot").appendChild(pub);
    showPublish();
  }
  $("#toTop").title = t("to_top");
  $("#toTop").setAttribute("aria-label", t("to_top"));
  document.documentElement.lang = isEn() ? "en" : "zh-Hant";
  document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
}

// admin only: whether the public site (Netlify) is up to date; it is republished by itself after a change
let pubTimer;
async function showPublish() {
  clearTimeout(pubTimer);
  const r = await api("/api/publish");
  const box = $("#pubState");
  if (!r.ok || !box) return;
  const s = r.body;
  const text = !s.token ? t("pub_no_token")
    : s.state === "waiting" ? t("pub_waiting", { n: s.in })
      : s.state === "deploying" ? t("pub_deploying")
        : s.state === "done" ? t("pub_done", { t: s.at.slice(11, 16) })
          : s.state === "failed" ? t("pub_failed", { e: s.error }) : t("pub_idle");
  box.innerHTML = `<span class="${s.state === "failed" || !s.token ? "warn" : ""}">${esc(text)}</span>`
    + (s.token && s.state !== "deploying" ? ` <button class="linkbtn" id="pubNow" type="button">${esc(t("pub_now"))}</button>` : "");
  const now = $("#pubNow");
  if (now) now.onclick = async () => { now.disabled = true; await api("/api/publish", { method: "POST" }); setTimeout(showPublish, 800); };
  pubTimer = setTimeout(showPublish, s.state === "waiting" || s.state === "deploying" ? 3000 : 20000);
}

async function route() {
  const r = location.hash.replace(/^#/, "") || "/";
  if (!state.meta) state.meta = (await api("/api/meta")).body;
  renderNav();
  if ($("#detail").open && !r.startsWith("/cat/")) $("#detail").close();
  $("#app").onclick = null;
  if (r.startsWith("/cat/")) {   // a link straight to one cat (#/cat/123): the list, with that cat open over it
    if (!$("#grid")) await renderBrowse();
    await openDetail(r.slice(5));
  } else if (r.startsWith("/edit/")) renderEdit(r.slice(6));
  else if (r === "/edits" && state.isAdmin) renderEdits();
  else if (r === "/review" && state.isAdmin) renderReview();
  else if (r === "/reports" && state.isAdmin) renderReports();
  else if (r === "/photos" && state.isAdmin) renderPhotos();
  else await renderBrowse();
}

// The loading screen stays until the cats are listed and the photos on the first screen have arrived (or failed),
// so the page shows up whole instead of filling in; never longer than 6 seconds. On a fast phone with everything cached
// that can take a split second, so it stays at least 0.8 s from the start and does not just flash.
async function hideLoader() {
  const shown = [...document.querySelectorAll(".hero img, .grid img")].filter((img) => img.getBoundingClientRect().top < innerHeight);
  const arrived = shown.map((img) => (img.complete ? null : new Promise((ok) => { img.addEventListener("load", ok); img.addEventListener("error", ok); })));
  const minimum = new Promise((ok) => setTimeout(ok, Math.max(0, 800 - performance.now())));
  await Promise.race([Promise.all([...arrived, minimum]), new Promise((ok) => setTimeout(ok, 6000))]);
  $("#loader").classList.add("done");
}

// ---------- visitor reports (local admin only) ----------
// reports sent from the public site live in Netlify Forms; opening this page (or 更新) brings the new ones in first
async function pullReports() {
  const r = await api("/api/reports/pull", { method: "POST" });
  const b = r.body || {};
  if (!r.ok || b.error) return { cls: "warn", text: t(b.error === "no_token" ? "rp_pull_no_token" : b.error === "token_rejected" ? "rp_pull_bad_token" : "rp_pull_failed") };
  const said = [b.new ? t("rp_pull_new", { n: b.new }) : "", b.removed ? t("rp_pull_removed", { n: b.removed }) : ""].filter(Boolean);
  return { cls: "good", text: said.length ? said.join(" ") : t("rp_pull_none") };
}

async function renderReports(pulled) {
  pulled ??= await pullReports();
  await refreshAdmin();
  const [open, done] = await Promise.all([api("/api/reports?status=open"), api("/api/reports?status=done")]);
  if (!open.ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const item = (r, handled) => `
    <div class="review-item" data-report="${r.id}">
      <div class="meta"><strong>${esc(t("rp_kind_" + r.kind))}</strong> · ${esc(r.created_at.replace("T", " "))}
        · <span class="tag">${esc(t(r.netlify_id ? "rp_via_site" : "rp_via_local"))}</span>
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
    <div class="notice ${pulled.cls}" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span>${esc(pulled.text)}</span><button class="btn ghost" data-pull type="button">${esc(t("rp_pull"))}</button></div>
    ${open.body.items.length ? open.body.items.map((r) => item(r, false)).join("") : `<p class="empty">${esc(t("rp_empty"))}</p>`}
    ${done.body.items.length ? `<h2>${esc(t("rp_history"))}</h2>` + done.body.items.map((r) => item(r, true)).join("") : ""}
  </section>`;
  $("#app").onclick = async (e) => {
    if (e.target.closest("[data-pull]")) { e.target.closest("[data-pull]").disabled = true; renderReports(); return; }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    await api("/api/reports/" + b.closest("[data-report]").dataset.report, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.act }),
    });
    renderReports(pulled);
  };
}

// ---------- listings without a photo (local admin only): add one by hand ----------
async function renderPhotos() {
  const { ok, body } = await api("/api/photos/missing");
  if (!ok) { $("#app").innerHTML = `<section class="panel"><p>403</p></section>`; return; }
  const item = (c) => `
    <div class="review-item" data-cat="${c.id}">
      <div class="meta"><strong>${esc(titleOf(c))}</strong> · ${esc(sourceLabel(c.source))} · ${esc(regionLabel(c.region))}${c.contact_name ? " · " + esc(c.contact_name) : ""}
        ${c.posted_at || c.created_at ? ` · ${esc(t("ph_posted", { d: fmtDate(c.posted_at || c.created_at) }))}` : ""}
        ${c.photo_unfound ? ` · <span class="tag warn">${esc(t("ph_unfound_on", { d: fmtDate(c.photo_unfound) }))}</span>` : ""}</div>
      <div class="snip" style="white-space:pre-line;color:var(--muted)">${esc((c.description || "").slice(0, 160))}</div>
      <div>${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(t("ph_open_post"))} ↗</a>` : `<span class="meta">${esc(t("ph_no_url"))}</span>`}</div>
      <div class="dropzone" tabindex="0" data-paste>${esc(t("ph_paste"))}</div>
      <div class="row">
        <div class="field"><label>${esc(t("ph_file"))}</label><input type="file" accept="image/*" data-file></div>
        <div class="field"><label>${esc(t("ph_url"))}</label><input type="url" placeholder="https://" data-url></div>
      </div>
      <div data-res></div>
      <div class="actions"><button class="btn good" data-save type="button">${esc(t("ph_save"))}</button>
        <button class="btn ghost" data-unfound="${c.photo_unfound ? "0" : "1"}" type="button">${esc(t(c.photo_unfound ? "ph_unfound_undo" : "ph_unfound"))}</button></div>
    </div>`;
  $("#app").innerHTML = `
  <section class="panel">
    <h1>${esc(t("ph_title"))}</h1>
    <p class="meta">${esc(t("ph_intro"))}</p>
    ${body.items.length ? body.items.map(item).join("") : `<p class="empty">${esc(t(body.unfound.length ? "ph_empty_rest" : "ph_empty"))}</p>`}
    ${body.unfound.length ? `<details class="ph-unfound"><summary>${esc(t("ph_unfound_list", { n: body.unfound.length }))}</summary>
      <p class="meta">${esc(t("ph_unfound_intro"))}</p>${body.unfound.map(item).join("")}</details>` : ""}
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
  $("#app").onclick = async (e) => {
    const b = e.target.closest("[data-save]");
    if (b) return send(b.closest("[data-cat]"));
    const u = e.target.closest("[data-unfound]");   // set aside: no photo to be found for now (or take it back)
    if (!u) return;
    u.disabled = true;
    await api(`/api/cats/${u.closest("[data-cat]").dataset.cat}/photo_unfound`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unfound: u.dataset.unfound === "1" }),
    });
    const open = $(".ph-unfound")?.open;
    await refreshAdmin(); await renderPhotos();
    if (open && $(".ph-unfound")) $(".ph-unfound").open = true;
  };
  $("#app").onpaste = (e) => {
    const zone = e.target.closest && e.target.closest("[data-paste]");
    const file = zone && [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); send(zone.closest("[data-cat]"), file); }
  };
}

// what the admin can do with one listing
function manageHtml(c) {
  const notes = [];
  if (c.review === "pending") notes.push(`<span class="tag warn">${esc(t("mine_pending"))}</span>`);
  if (c.status === "closed") notes.push(`<span class="tag warn">${esc(t("mine_closed"))}</span>`);
  let buttons = "";
  if (state.isAdmin) {
    buttons = `<button class="btn small" data-act="edit" type="button">${esc(t("act_edit"))}</button>
      <button class="btn ghost small" data-act="history" type="button">${esc(t("act_history"))}</button>
      <button class="btn ghost small" data-act="${c.status === "closed" ? "relist" : "unlist"}" type="button">${esc(t(c.status === "closed" ? "act_relist" : "act_unlist"))}</button>`;
  }
  if (!notes.length && !buttons) return "";
  return `<div class="manage">${notes.join(" ")}<div class="actions">${buttons}</div><div id="histbox"></div></div>`;
}
function wireManage(c) {
  const d = $("#detail");
  d.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.dataset.act;
      if (act === "edit") { d.close(); location.hash = "#/edit/" + c.id; }
      else if (act === "history") showHistory(c.id);
      else if (act === "unlist") {
        if (!confirm(t("unlist_confirm"))) return;
        await api("/api/cats/" + c.id, { method: "DELETE" });
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

// ---------- edit form (admin only) ----------
async function renderEdit(id) {
  const admin = state.isAdmin;
  const { ok, body: c } = await api("/api/cats/" + id);
  if (!ok || !admin) { $("#app").innerHTML = `<section class="panel"><div class="notice bad">${esc(t("no_perm"))}</div></section>`; return; }
  const m = state.meta || { regions: Object.keys(REGION_EN) };
  const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(l)}</option>`;
  const tri = (k) => `<select id="e_${k}">${o("", t("unknown"), c[k] == null)}${o("1", t("yes"), c[k] === true)}${o("0", t("no"), c[k] === false)}</select>`;
  const txt = (k, label, type = "text") => `<div class="field"><label for="e_${k}">${esc(label)}</label><input type="${type}" id="e_${k}" value="${esc(c[k] ?? "")}"></div>`;
  $("#app").innerHTML = `<section class="panel"><h1>${esc(t(admin ? "edit_admin_title" : "edit_title"))}</h1>
    <p class="meta">${esc(titleOf(c))}${admin ? " · " + esc(t("hist_intro")) : ""}</p>
    ${c.source === "shelter" ? `<div class="notice warn">${esc(t("edit_shelter_note"))}</div>` : ""}
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
      <div class="actions"><button class="btn" id="esave" type="submit">${esc(t("save"))}</button><a class="btn ghost" href="#/" style="text-decoration:none">${esc(t("close"))}</a></div>
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
    const r = await api("/api/cats/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let photoFailed = false;
    const file = $("#e_photo").files[0];
    if (r.ok && file) {
      const fd = new FormData(); fd.append("photo", file);
      photoFailed = !(await api(`/api/cats/${id}/photo`, { method: "POST", body: fd })).ok;
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
// back to top: shown once the visitor is a screen or more down the page
const toTop = () => $("#toTop").classList.toggle("show", window.scrollY > window.innerHeight);
window.addEventListener("scroll", toTop, { passive: true });
$("#toTop").onclick = () => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
window.addEventListener("hashchange", route);
$("#loaderText").textContent = t("loading");
refreshAdmin().then(route).finally(hideLoader);
