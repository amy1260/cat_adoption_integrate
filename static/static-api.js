"use strict";
// Public copy of the site (built by publish.py, hosted as plain files): there is no server, so the few API calls a
// visitor makes are answered here from data/cats.json. Every admin call answers 404, so the admin pages never show.
// Problem reports go to Netlify Forms (form "report" in index.html).
(() => {
  const realFetch = window.fetch.bind(window);
  let data = null;
  const load = () => (data ??= Promise.all([
    realFetch("/data/cats.json").then((r) => r.json()),
    realFetch("/data/meta.json").then((r) => r.json()),
  ]).then(([cats, meta]) => ({ cats, meta, byId: new Map(cats.map((c) => [c.id, c])) })));

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const REPORT_KINDS = ["wrong_info", "adopted", "duplicate", "inappropriate", "suggestion", "other"];
  const MESSAGE_REQUIRED = ["wrong_info", "suggestion", "other"];
  const Q_FIELDS = ["title", "description", "color", "breed_text", "contact_name", "shelter_no", "chip", "name"];

  // Same ordering as SQLite in app.py: NULL first ascending, text compared as is.
  const cmp = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);

  function listCats({ cats }, p) {
    let out = cats;
    for (const col of ["region", "sex", "age_group", "breed"]) {
      const vals = p.getAll(col).filter(Boolean);
      if (vals.length) out = out.filter((c) => vals.includes(c[col]));
    }
    for (const col of ["neutered", "vaccinated"]) {
      const v = p.get(col);
      if (v === "0" || v === "1") out = out.filter((c) => c[col] === (v === "1"));
    }
    const fiv = p.get("fiv");
    if (fiv === "neg" || fiv === "pos") out = out.filter((c) => c.fiv_felv === fiv);
    const q = (p.get("q") || "").toLowerCase();
    if (q) out = out.filter((c) => Q_FIELDS.some((f) => String(c[f] ?? "").toLowerCase().includes(q)));
    const by_source = {};   // under every filter but the source, as the count cards show it
    for (const c of out) by_source[c.source] = (by_source[c.source] || 0) + 1;
    const src = p.getAll("source").filter(Boolean);
    if (src.length) out = out.filter((c) => src.includes(c.source));
    const sort = p.get("sort");
    // as app.py: an age group stands in for the months when a shelter gives only that; unknown ages go last
    const age = (c) => c.age_months ?? { kitten: 6, adult: 48, senior: 120 }[c.age_group] ?? null;
    const posted = (c) => c.posted_at || c.created_at;
    const byAge = (dir) => (a, b) => (age(a) == null) - (age(b) == null) || dir * cmp(age(a), age(b)) || -cmp(posted(a), posted(b));
    out = [...out].sort(
      sort === "age" ? byAge(1)
          : sort === "age_desc" ? byAge(-1)
            : (a, b) => -cmp(posted(a), posted(b)));
    const page = Math.max(1, parseInt(p.get("page") || "1", 10) || 1);
    const per = Math.min(60, Math.max(1, parseInt(p.get("per_page") || "24", 10) || 24));
    const items = out.slice((page - 1) * per, page * per).map((c) => ({ ...c, also_listed: c.also_listed.length }));
    return { total: out.length, page, per_page: per, by_source, items };
  }

  async function report(id, opts) {
    const d = JSON.parse(opts.body || "{}");
    if (d.website) return reply(200, { ok: true });   // honeypot: only bots fill it in
    const kind = d.kind, message = (d.message || "").trim().slice(0, 1000);
    const fields = {};
    if (!REPORT_KINDS.includes(kind)) fields.kind = "required";
    if (MESSAGE_REQUIRED.includes(kind) && message.length < 5) fields.message = "too_short";
    if (Object.keys(fields).length) return reply(400, { error: "validation", fields });
    const cat = (await load()).byId.get(id);
    const form = new URLSearchParams({
      "form-name": "report", cat_id: String(id), cat: cat ? `${cat.title || ""} ${cat.source_url || ""}` : "",
      kind, message, contact: (d.contact || "").trim().slice(0, 120), website: "",
    });
    const r = await realFetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    return r.ok ? reply(201, { ok: true }) : reply(500, { error: "failed" });
  }

  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, opts);
    const method = (opts.method || "GET").toUpperCase();
    const path = url.pathname;
    try {
      if (method === "GET" && path === "/api/meta") return reply(200, (await load()).meta);
      if (method === "GET" && path === "/api/cats") return reply(200, listCats(await load(), url.searchParams));
      let m = path.match(/^\/api\/cats\/(\d+)$/);
      if (method === "GET" && m) {
        const c = (await load()).byId.get(Number(m[1]));
        return c ? reply(200, c) : reply(404, { error: "not_found" });
      }
      m = path.match(/^\/api\/cats\/(\d+)\/report$/);
      if (method === "POST" && m) return await report(Number(m[1]), opts);
    } catch (e) {
      return reply(500, { error: "failed" });
    }
    return reply(404, { error: "not_found" });   // admin and everything else: not on the public site
  };
})();
