"use strict";
/* Cat Home — static front end for a Wix Headless site.
   Reads shelter open data live in the browser, listings from the Wix CMS (collections `cats` and `listings`),
   and lets signed-in site members post and edit only their own listings (Wix enforces it: SITE_MEMBER_AUTHOR). */
const CLIENT_ID = "8bc44965-1e71-4c3d-8216-89e612cf9bb7";
const API = "https://www.wixapis.com";
const MOA = "https://data.moa.gov.tw/Service/OpenData/TransService.aspx?UnitId=QcbUEzN6E6DL&animal_kind=%E8%B2%93&%24top=20000";
const PER_PAGE = 24;
const REGIONS = ["臺北市","新北市","基隆市","桃園市","新竹市","新竹縣","苗栗縣","臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市","高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"];
const REGION_EN = {"臺北市":"Taipei","新北市":"New Taipei","基隆市":"Keelung","桃園市":"Taoyuan","新竹市":"Hsinchu City","新竹縣":"Hsinchu County","苗栗縣":"Miaoli","臺中市":"Taichung","彰化縣":"Changhua","南投縣":"Nantou","雲林縣":"Yunlin","嘉義市":"Chiayi City","嘉義縣":"Chiayi County","臺南市":"Tainan","高雄市":"Kaohsiung","屏東縣":"Pingtung","宜蘭縣":"Yilan","花蓮縣":"Hualien","臺東縣":"Taitung","澎湖縣":"Penghu","金門縣":"Kinmen","連江縣":"Lienchiang"};
const BREEDS = {mixed:["米克斯（混種）","Mixed / domestic"],ragdoll:["布偶貓","Ragdoll"],british_shorthair:["英國短毛貓","British Shorthair"],american_shorthair:["美國短毛貓","American Shorthair"],scottish_fold:["蘇格蘭摺耳貓","Scottish Fold"],persian:["波斯貓","Persian"],siamese:["暹羅貓","Siamese"],maine_coon:["緬因貓","Maine Coon"],bengal:["孟加拉貓","Bengal"],russian_blue:["俄羅斯藍貓","Russian Blue"],munchkin:["曼赤肯（短腿貓）","Munchkin"],exotic_shorthair:["異國短毛貓","Exotic Shorthair"],norwegian_forest:["挪威森林貓","Norwegian Forest"],sphynx:["斯芬克斯（無毛貓）","Sphynx"],birman:["伯曼貓","Birman"],abyssinian:["阿比西尼亞貓","Abyssinian"],chinchilla:["金吉拉","Chinchilla"]};
const HEALTH = {skin:["皮膚問題","Skin condition"],stomatitis:["口炎","Stomatitis"],kidney:["腎臟問題","Kidney issue"],eye:["眼睛問題","Eye issue"],disability:["行動不便／殘疾","Mobility / disability"],cold:["感冒／鼻支","Cat flu"],digestive:["腸胃問題","Digestive issue"],heart:["心臟問題","Heart condition"],diabetes:["糖尿病","Diabetes"],dewormed:["已驅蟲","Dewormed"],healthy:["健康","Healthy"],fiv_pos:["愛滋陽性","FIV positive"]};
const COLOR_EN = [["橘白","Orange & white"],["黃白","Orange & white"],["虎斑白","Tabby & white"],["虎斑","Tabby"],["賓士","Tuxedo"],["乳牛","Black & white"],["三花","Calico"],["玳瑁","Tortoiseshell"],["狸花","Mackerel tabby"],["黑白","Black & white"],["藍白","Blue & white"],["灰白","Gray & white"],["銀漸層","Silver shaded"],["金漸層","Golden shaded"],["奶茶","Milk tea"],["橘","Orange"],["黃","Yellow"],["黑","Black"],["白","White"],["灰","Gray"],["藍","Blue"]];

const T = {
zh:{brand:"貓咪找家",tagline:"整合收容所、臉書社團與民眾送養的貓咪，一個網站找到你的貓",nav_browse:"找貓咪",nav_post:"刊登送養",nav_mine:"我的刊登",login:"登入／註冊",logout:"登出",
stat_total:"隻待領養",stat_shelter:"收容所",stat_fb:"臉書社團",stat_user:"民眾刊登",search_ph:"搜尋花色、品種、地點、關鍵字…",region:"地區",all_regions:"全部地區",sex:"性別",age:"年齡",breed:"品種",source:"來源",all:"不限",sort:"排序",sort_new:"最新",sort_region:"地區",sort_age:"年齡小到大",
neutered_only:"已結紮",vaccinated_only:"已打疫苗",fiv_neg:"愛滋白血陰性",reset:"清除條件",results:"共 {n} 隻",no_results:"找不到符合條件的貓咪，放寬條件試試看。",prev:"上一頁",next:"下一頁",page:"第 {p} / {t} 頁",loading:"貓咪們正在趕來…",
unknown:"未註明",yes:"是",no:"否",neutered:"結紮",vaccinated:"疫苗",fiv_felv:"愛滋/白血",neg:"陰性",pos:"陽性",neutered_yes:"已結紮",neutered_no:"未結紮",vaccinated_yes:"已打疫苗",vaccinated_no:"未打疫苗",
contact:"聯絡方式",phone:"電話",line:"LINE",contact_name:"聯絡人",view_source:"查看原文／原始頁面",description:"詳細說明",health_status:"健康狀況",location:"所在地",found_at:"尋獲地點",updated:"更新",available_from:"可認養日",shelter_no:"收容編號",color:"花色",close:"關閉",
src_shelter:"收容所",src_fb_catparadise:"臉書社團",src_user:"民眾刊登",sex_M:"男生",sex_F:"女生",sex_U:"性別不明",age_kitten:"幼貓（1歲內）",age_adult:"成貓（1–7歲）",age_senior:"高齡（7歲以上）",age_unknown:"年齡不明",months:"{n} 個月",years:"{n} 歲",age_at_post:"貼文當時年齡",
shelter_fail:"暫時讀不到收容所資料，先顯示其他來源。",load_fail:"資料載入失敗，請稍後重新整理。",
post_title:"刊登待領養貓咪",edit_title:"修改刊登",post_intro:"填寫貓咪的資訊，讓更多人看見。每隻貓只能刊登一次。",login_first:"刊登與修改需要先登入。登入後，你的刊登紀錄會保留在這個瀏覽器，下次不用重新登入。",
f_name:"貓咪名字",f_region:"縣市",f_district:"鄉鎮市區",f_age_months:"目前年齡（月）",f_color:"花色",f_health:"健康狀況說明",f_desc:"詳細說明（個性、領養條件…）",f_photo:"照片連結（選填）",f_photo_hint:"貼上圖片網址，例如雲端相簿的圖片連結；沒有也沒關係。",f_phone:"聯絡電話",f_line:"LINE ID",f_other:"其他聯絡方式",contact_hint:"電話、LINE 或其他聯絡方式至少填一項",submit:"送出刊登",save:"儲存修改",saving:"送出中…",
posted_ok:"刊登成功！你可以在「我的刊登」修改或下架。",saved_ok:"已儲存修改。",dup_blocked:"這隻貓咪已經刊登過了，不能重複刊登。",dup_see:"查看已刊登的內容",err_required:"請填寫此欄位",err_short:"內容太短（至少 10 個字）",err_generic:"送出失敗，請稍後再試。",err_perm:"你沒有修改這則刊登的權限。",
mine_title:"我的刊登",mine_empty:"你還沒有刊登任何貓咪。",mine_note:"這些是你刊登的貓咪，只有你（和網站管理者）可以修改。紀錄也會保留在這個瀏覽器。",edit:"修改",remove:"下架刪除",confirm_remove:"確定要刪除這則刊登嗎？",removed:"已刪除。",mine_badge:"我的刊登",
auth_login:"登入",auth_register:"註冊",email:"Email",password:"密碼",first_name:"名",last_name:"姓",auth_code:"驗證碼（請看信箱）",verify:"驗證",
auth_verify_need:"我們寄了驗證碼到你的信箱，請輸入後繼續。",auth_approval:"註冊成功，等網站管理者核准後就能登入。",auth_wrong:"帳號或密碼不正確。",auth_exists:"這個 Email 已經註冊過，請改用登入。",auth_reset:"需要先重設密碼才能登入。",auth_nosession:"登入沒有完成，請再試一次。",auth_timeout:"登入逾時，請重新整理後再試。",auth_why:"為什麼要登入？這樣才能確保只有刊登的人可以修改自己的貓。",
rp_open:"回報問題／提出建議",rp_close:"收起",rp_kind:"回報類型",rp_wrong_info:"資訊有誤",rp_adopted:"貓咪已被領養／已送出",rp_duplicate:"重複刊登",rp_inappropriate:"不當或可疑內容",rp_suggestion:"網站建議",rp_other:"其他",rp_message:"說明",rp_contact:"聯絡方式（選填）",rp_submit:"送出回報",rp_thanks:"謝謝你的回報！我們會盡快查看。",rp_short:"請至少寫 5 個字",
foot:"資料來源：農業部全國動物收容管理系統開放資料（即時）、貓咪天堂臉書社團公開貼文、網友刊登。實際領養請以原始來源為準。"},
en:{brand:"Cat Home",tagline:"Shelter cats, Facebook-group listings and private rehoming, all in one place",nav_browse:"Find a cat",nav_post:"Post a cat",nav_mine:"My listings",login:"Log in / Sign up",logout:"Log out",
stat_total:"cats available",stat_shelter:"Shelters",stat_fb:"Facebook group",stat_user:"Posted here",search_ph:"Search color, breed, place, keywords…",region:"Region",all_regions:"All regions",sex:"Sex",age:"Age",breed:"Breed",source:"Source",all:"Any",sort:"Sort",sort_new:"Newest",sort_region:"Region",sort_age:"Youngest first",
neutered_only:"Neutered",vaccinated_only:"Vaccinated",fiv_neg:"FIV/FeLV negative",reset:"Clear filters",results:"{n} cats",no_results:"No cats match. Try loosening the filters.",prev:"Previous",next:"Next",page:"Page {p} of {t}",loading:"The cats are on their way…",
unknown:"Not stated",yes:"Yes",no:"No",neutered:"Neutered",vaccinated:"Vaccinated",fiv_felv:"FIV/FeLV",neg:"Negative",pos:"Positive",neutered_yes:"Neutered",neutered_no:"Not neutered",vaccinated_yes:"Vaccinated",vaccinated_no:"Not vaccinated",
contact:"Contact",phone:"Phone",line:"LINE",contact_name:"Contact",view_source:"View original listing",description:"Details",health_status:"Health",location:"Location",found_at:"Found at",updated:"Updated",available_from:"Adoptable from",shelter_no:"Shelter no.",color:"Coat",close:"Close",
src_shelter:"Shelter",src_fb_catparadise:"Facebook group",src_user:"Posted here",sex_M:"Male",sex_F:"Female",sex_U:"Sex unknown",age_kitten:"Kitten (under 1)",age_adult:"Adult (1–7)",age_senior:"Senior (7+)",age_unknown:"Age unknown",months:"{n} mo",years:"{n} yr",age_at_post:"Age when posted",
shelter_fail:"Shelter data is unavailable right now; showing the other sources.",load_fail:"Could not load the data. Please refresh later.",
post_title:"Post a cat for adoption",edit_title:"Edit listing",post_intro:"Tell people about the cat. Each cat can be posted only once.",login_first:"Posting and editing need a login. After you log in, your listings stay in this browser so you don't have to sign in again.",
f_name:"Cat's name",f_region:"City / county",f_district:"District",f_age_months:"Age now (months)",f_color:"Coat color",f_health:"Health notes",f_desc:"Details (personality, adoption terms…)",f_photo:"Photo link (optional)",f_photo_hint:"Paste an image URL, for example from a cloud album. Fine to leave empty.",f_phone:"Phone",f_line:"LINE ID",f_other:"Other contact",contact_hint:"Give at least one of phone, LINE or other contact",submit:"Post listing",save:"Save changes",saving:"Sending…",
posted_ok:"Posted! You can edit or remove it under “My listings”.",saved_ok:"Changes saved.",dup_blocked:"This cat has already been posted and cannot be posted again.",dup_see:"See the existing listing",err_required:"Required",err_short:"Too short (at least 10 characters)",err_generic:"Could not send. Please try again later.",err_perm:"You are not allowed to change this listing.",
mine_title:"My listings",mine_empty:"You have not posted any cats yet.",mine_note:"These are your cats. Only you (and the site admin) can change them. They are also remembered in this browser.",edit:"Edit",remove:"Remove",confirm_remove:"Delete this listing?",removed:"Deleted.",mine_badge:"Mine",
auth_login:"Log in",auth_register:"Sign up",email:"Email",password:"Password",first_name:"First name",last_name:"Last name",auth_code:"Verification code (check your email)",verify:"Verify",
auth_verify_need:"We emailed you a code. Enter it to continue.",auth_approval:"You're signed up. You can log in once the site admin approves.",auth_wrong:"Wrong email or password.",auth_exists:"This email is already registered. Log in instead.",auth_reset:"You need to reset your password first.",auth_nosession:"Login did not finish. Please try again.",auth_timeout:"Login timed out. Refresh and try again.",auth_why:"Why log in? So only the person who posted a cat can change it.",
rp_open:"Report a problem / suggest",rp_close:"Hide",rp_kind:"Type",rp_wrong_info:"Wrong information",rp_adopted:"Cat already adopted / rehomed",rp_duplicate:"Duplicate listing",rp_inappropriate:"Inappropriate or suspicious",rp_suggestion:"Site suggestion",rp_other:"Other",rp_message:"Details",rp_contact:"Contact (optional)",rp_submit:"Send report",rp_thanks:"Thanks for letting us know! We'll look soon.",rp_short:"Please write at least 5 characters",
foot:"Sources: Ministry of Agriculture shelter open data (live), public posts of the Cat Paradise Facebook group, and user listings. Always confirm with the original source."}
};
const S = { lang: load("catjoy-lang", "zh"), all: [], loaded: false, shelterFail: false, member: null, loggedIn: false, memberLoading: true,
  f: { q: "", region: "", sex: "", age: "", breed: "", source: "", neutered: false, vaccinated: false, fiv: false, sort: "new", page: 1 } };
const t = (k, v = {}) => (T[S.lang][k] ?? T.zh[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "");
const $ = (s, e = document) => e.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const en = () => S.lang === "en";
function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

/* ---------- Wix client: visitor and member tokens (public client id, safe in page source) ---------- */
const TK = "catjoy-tokens-" + CLIENT_ID;
let tokens = load(TK, null), pendingMint = null, pendingState = null;
async function mint(body, role = "visitor") {
  const r = await fetch(API + "/oauth2/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: CLIENT_ID, ...body }) });
  if (!r.ok) throw new Error("auth " + r.status);
  const d = await r.json();
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + d.expires_in * 1000, role };
}
async function accessToken() {
  if (tokens && tokens.accessToken && tokens.expiresAt - 60000 > Date.now()) return tokens.accessToken;
  pendingMint = pendingMint || (async () => {
    let fresh = null;
    if (tokens && tokens.refreshToken) { try { fresh = await mint({ grantType: "refresh_token", refreshToken: tokens.refreshToken }, tokens.role || "visitor"); } catch (e) { /* fall back to a new visitor */ } }
    if (!fresh) { fresh = await mint({ grantType: "anonymous" }); }
    tokens = fresh; save(TK, tokens); return fresh.accessToken;
  })().finally(() => { pendingMint = null; });
  return pendingMint;
}
async function wx(path, { method = "POST", body, query } = {}) {
  const u = new URL(path, API);
  Object.entries(query || {}).forEach(([k, v]) => u.searchParams.append(k, v));
  const r = await fetch(u, { method, headers: { Authorization: await accessToken(), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    let j = {}; try { j = await r.json(); } catch (e) { /* no body */ }
    const err = new Error(j.message || method + " " + u.pathname + " " + r.status);
    err.status = r.status; err.code = j && j.details && j.details.applicationError && j.details.applicationError.code; err.details = j && j.details;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

/* ---------- Member login on this page's own form (IAM API, then PKCE exchange in a hidden iframe) ---------- */
const b64u = (bytes) => { let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const rand = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
async function memberTokens(sessionToken) {
  const verifier = rand();
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = rand();
  const res = await wx("/headless/v1/redirect-session", { body: { auth: { authRequest: { clientId: CLIENT_ID, codeChallenge: challenge, codeChallengeMethod: "S256", responseMode: "web_message", responseType: "code", scope: "offline_access", state, sessionToken }, prompt: "none" } } });
  const url = res && res.redirectSession && res.redirectSession.fullUrl;
  if (!url) throw new Error("nosession");
  const code = await new Promise((resolve, reject) => {
    const frame = document.createElement("iframe"); frame.style.display = "none";
    const done = () => { window.removeEventListener("message", onMsg); clearTimeout(timer); frame.remove(); };
    const onMsg = (e) => { const d = e.data; if (!d || d.state !== state) return; done(); d.code ? resolve(d.code) : reject(new Error(d.error || "nocode")); };
    const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, 60000);
    window.addEventListener("message", onMsg); frame.src = url; document.body.appendChild(frame);
  });
  return mint({ grantType: "authorization_code", code, codeVerifier: verifier }, "member");
}
const STATES = { SUCCESS: "SUCCESS", REQUIRE_EMAIL_VERIFICATION: "VERIFY", REQUIRE_OWNER_APPROVAL: "APPROVAL" };
async function finishAuth(raw) {
  const state = STATES[raw && raw.state] || "FAILURE";
  if (state === "SUCCESS") {
    pendingState = null;
    if (!raw.sessionToken) return { state: "FAILURE", error: t("auth_nosession") };
    tokens = await memberTokens(raw.sessionToken); save(TK, tokens);
    await refreshMember();
    return { state: "SUCCESS" };
  }
  if (raw && raw.stateToken) pendingState = raw.stateToken;
  return { state };
}
function authError(e, kind) {
  if (e && e.message === "timeout") return t("auth_timeout");
  if (e && e.message === "nosession") return t("auth_nosession");
  if (kind === "register" && e && e.code === "-19995") return t("auth_exists");
  if (e && e.code === "-19973") return t("auth_reset");
  if (kind === "login") return t("auth_wrong");
  return (e && e.message) || t("err_generic");
}
async function doLogin(email, password) { try { return await finishAuth(await wx("/_api/iam/authentication/v2/login", { body: { loginId: { email }, password } })); } catch (e) { return { state: "FAILURE", error: authError(e, "login") }; } }
async function doRegister(email, password, profile) { try { return await finishAuth(await wx("/_api/iam/authentication/v2/register", { body: { loginId: { email }, password, profile } })); } catch (e) { return { state: "FAILURE", error: authError(e, "register") }; } }
async function doVerify(code) { if (!pendingState) return { state: "FAILURE", error: t("auth_nosession") }; try { return await finishAuth(await wx("/_api/iam/verification/v1/auth/verify", { body: { code, stateToken: pendingState } })); } catch (e) { return { state: "FAILURE", error: authError(e, "verify") }; } }
async function refreshMember() {
  S.loggedIn = !!(tokens && tokens.role === "member"); S.member = null;
  if (S.loggedIn) {
    try {
      const r = await wx("/members/v1/members/my", { method: "GET", query: { fieldsets: "FULL" } });
      const m = r && r.member;
      if (m && m.id) S.member = { id: m.id, name: (m.profile && m.profile.nickname) || [m.contact && m.contact.firstName, m.contact && m.contact.lastName].filter(Boolean).join(" ") || String(m.loginEmail || "").split("@")[0] || "Member" };
    } catch (e) { /* profile unavailable: still logged in */ }
  }
  S.memberLoading = false; renderMember();
}
function logout() { tokens = null; save(TK, null); S.loggedIn = false; S.member = null; renderMember(); if (/^#\/(post|edit|mine)/.test(location.hash)) location.hash = "#/"; else route(); }

/* ---------- data ---------- */
function bigrams(s) { s = String(s || "").toLowerCase().replace(/[\s\W_]+/g, ""); const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; }
function similarity(a, b) { const x = bigrams(a), y = bigrams(b); if (!x.size || !y.size) return 0; let n = 0; x.forEach((g) => { if (y.has(g)) n++; }); return n / (x.size + y.size - n); }
const tri = (v) => (v === "yes" ? true : v === "no" ? false : null);
const dateOf = (v) => { const raw = v && v.$date ? v.$date : v; const d = raw ? new Date(raw) : null; return d && !isNaN(d) ? d : null; };
function cityOf(s) {
  const x = String(s || "").replace(/台/g, "臺");
  const map = [["新北","新北市"],["臺北","臺北市"],["桃園","桃園市"],["臺中","臺中市"],["臺南","臺南市"],["高雄","高雄市"],["基隆","基隆市"],["新竹縣","新竹縣"],["新竹市","新竹市"],["新竹","新竹市"],["苗栗","苗栗縣"],["彰化","彰化縣"],["南投","南投縣"],["雲林","雲林縣"],["嘉義縣","嘉義縣"],["嘉義市","嘉義市"],["嘉義","嘉義市"],["屏東","屏東縣"],["宜蘭","宜蘭縣"],["花蓮","花蓮縣"],["臺東","臺東縣"],["澎湖","澎湖縣"],["金門","金門縣"],["馬祖","連江縣"],["連江","連江縣"]];
  for (const [k, v] of map) if (x.includes(k)) return v;
  return "";
}
const BREED_MAP = [["ragdoll",/布偶/],["british_shorthair",/英國短毛|英短/],["american_shorthair",/美國短毛|美短/],["scottish_fold",/蘇格蘭|摺耳/],["persian",/波斯/],["siamese",/暹羅/],["maine_coon",/緬因/],["bengal",/孟加拉/],["russian_blue",/俄羅斯藍/],["munchkin",/曼赤肯/],["exotic_shorthair",/異國短毛/],["norwegian_forest",/挪威/],["mixed",/混種/]];
function fromShelter(r) {
  const v = String(r.animal_Variety || "").trim();
  const hit = BREED_MAP.find(([, re]) => re.test(v));
  const open = String(r.animal_opendate || "");
  return { id: "s" + r.animal_id, source: "shelter", title: String(r.animal_place || "") + " " + String(r.animal_subid || ""), breed: hit ? hit[0] : "", breedText: v, color: String(r.animal_colour || "").trim(),
    sex: r.animal_sex === "M" ? "M" : r.animal_sex === "F" ? "F" : "U", ageGroup: r.animal_age === "CHILD" ? "kitten" : r.animal_age === "ADULT" ? "adult" : "unknown",
    neutered: r.animal_sterilization === "T" ? true : r.animal_sterilization === "F" ? false : null, vaccinated: r.animal_bacterin === "T" ? true : r.animal_bacterin === "F" ? false : null,
    healthTags: [], region: cityOf(r.shelter_address) || cityOf(r.animal_place), locationText: String(r.animal_foundplace || "").trim(), contactName: String(r.shelter_name || r.animal_place || ""),
    contactPhone: String(r.shelter_tel || "").trim(), contactOther: String(r.shelter_address || "").trim(), description: String(r.animal_remark || "").trim(), photo: String(r.album_file || "").trim(),
    shelterNo: String(r.animal_subid || ""), availableFrom: open && open < "2999" ? open : "", postedAt: dateOf(String(r.animal_createtime || "").replace(/\//g, "-")),
    sourceUrl: "https://www.pet.gov.tw/AnimalApp/AnnounceMent.aspx?PageType=Transfer" };
}
function fromCms(item, collection) {
  const d = item.data || item;
  return { id: d._id || item.id, cms: collection, owner: d._owner || "", source: d.source || (collection === "listings" ? "user" : "fb_catparadise"), title: d.title || "", name: d.name || "", breed: d.breed || "", breedText: d.breedText || "", color: d.color || "",
    sex: d.sex || "U", ageGroup: d.ageGroup || "unknown", ageMonths: typeof d.ageMonths === "number" ? d.ageMonths : null, ageText: d.ageText || "", neutered: tri(d.neutered), vaccinated: tri(d.vaccinated), fiv: d.fivFelv || "",
    healthTags: d.healthTags || [], healthNote: d.healthNote || "", region: d.region || "", district: d.district || "", locationText: d.locationText || "", contactName: d.contactName || "", contactPhone: d.contactPhone || "",
    contactLine: d.contactLine || "", contactOther: d.contactOther || "", description: d.description || "", photo: d.photoUrl || "", postedAt: dateOf(d.postedAt), sourceUrl: d.sourceUrl || "", status: d.status || "open" };
}
async function queryAll(collection, filter) {
  const out = []; let offset = 0;
  for (;;) {
    const r = await wx("/wix-data/v2/items/query", { body: { dataCollectionId: collection, query: { filter: filter || {}, paging: { limit: 100, offset } } } });
    const items = r.dataItems || []; out.push(...items);
    if (items.length < 100) break; offset += 100;
  }
  return out;
}
async function loadShelter() {
  let text = null;
  try { text = sessionStorage.getItem("catjoy-moa"); } catch (e) { /* ignore */ }
  if (!text) { const r = await fetch(MOA); if (!r.ok) throw new Error("moa " + r.status); text = await r.text(); try { sessionStorage.setItem("catjoy-moa", text); } catch (e) { /* too big or private mode */ } }
  return JSON.parse(text).map(fromShelter);
}
async function loadAll() {
  const [sh, cats, mine] = await Promise.allSettled([loadShelter(), queryAll("cats"), queryAll("listings")]);
  S.shelterFail = sh.status !== "fulfilled";
  const list = [];
  if (sh.status === "fulfilled") list.push(...sh.value);
  if (cats.status === "fulfilled") list.push(...cats.value.map((i) => fromCms(i, "cats")));
  if (mine.status === "fulfilled") list.push(...mine.value.map((i) => fromCms(i, "listings")));
  S.all = list.filter((c) => c.status !== "closed");
  S.loaded = true; S.loadFail = cats.status !== "fulfilled" && mine.status !== "fulfilled" && S.shelterFail;
}

/* ---------- age: the age in a post is the age on the day it was posted, so bring it up to today ---------- */
function parseMonths(txt) {
  const s = String(txt || ""); let m;
  if ((m = /(\d{1,2})\s*歲半/.exec(s))) return +m[1] * 12 + 6;
  if (/半歲/.test(s)) return 6;
  if ((m = /(\d{1,2}(?:\.\d)?)\s*歲/.exec(s)) && +m[1] <= 22) return Math.round(+m[1] * 12);
  if ((m = /(\d{1,2}(?:\.\d)?)\s*(?:[-~到至]\s*\d{1,2}(?:\.\d)?\s*)?個月/.exec(s))) return Math.max(1, Math.round(+m[1]));
  if ((m = /(\d{1,2})\s*週/.exec(s))) return Math.max(1, Math.floor(+m[1] / 4));
  return null;
}
const groupOf = (m) => (m == null ? "unknown" : m < 12 ? "kitten" : m >= 84 ? "senior" : "adult");
function ageInfo(c) {
  if (c.source === "shelter") return { now: null, post: null, group: c.ageGroup };
  const post = c.ageMonths != null ? c.ageMonths : parseMonths(c.ageText);
  if (post == null) return { now: null, post: null, group: c.ageGroup };
  const elapsed = c.postedAt ? Math.max(0, Math.floor((Date.now() - c.postedAt.getTime()) / 86400000 / 30.4375)) : 0;
  const now = post + elapsed;
  return { now, post, group: groupOf(now) };
}
const monthsLabel = (m) => (m < 12 ? t("months", { n: m }) : t("years", { n: Math.round(m / 12 * 10) / 10 }));
const ageLabel = (c) => { const a = ageInfo(c); return a.now != null ? monthsLabel(a.now) : t("age_" + a.group); };

/* ---------- labels ---------- */
const regionLabel = (r) => (r ? (en() ? REGION_EN[r] || r : r) : t("unknown"));
const breedLabel = (c) => (c.breed && BREEDS[c.breed] ? BREEDS[c.breed][en() ? 1 : 0] : c.breedText || null);
const colorLabel = (c) => { if (!c) return null; if (!en()) return c; const h = COLOR_EN.find(([z]) => c.includes(z)); return h ? h[1] : c; };
const sexLabel = (s) => t("sex_" + (s || "U"));
const sourceLabel = (s) => t("src_" + (s === "shelter" || s === "user" ? s : "fb_catparadise"));
function titleOf(c) {
  if (c.source === "shelter") return [breedLabel(c), colorLabel(c.color), c.shelterNo].filter(Boolean).join(" · ");
  return c.name || c.title || (c.description || "").slice(0, 28) || "—";
}
function healthTags(c) {
  const o = [];
  if (c.neutered === true) o.push([t("neutered_yes"), "g"]); if (c.neutered === false) o.push([t("neutered_no"), "w"]);
  if (c.vaccinated === true) o.push([t("vaccinated_yes"), "g"]); if (c.vaccinated === false) o.push([t("vaccinated_no"), "w"]);
  if (c.fiv === "neg") o.push([t("fiv_felv") + " " + t("neg"), "g"]); if (c.fiv === "pos") o.push([t("fiv_felv") + " " + t("pos"), "w"]);
  (c.healthTags || []).forEach((k) => { if (k === "fiv_pos" && c.fiv === "pos") return; if (HEALTH[k]) o.push([HEALTH[k][en() ? 1 : 0], k === "healthy" || k === "dewormed" ? "g" : "w"]); });
  return o;
}
const fmtDate = (d) => (d ? d.toISOString().slice(0, 10) : "");
const isMine = (c) => !!(c.cms === "listings" && S.member && c.owner && c.owner === S.member.id);
const photoHtml = (c) => (c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "") + "🐱";

/* ---------- browse ---------- */
function visible() {
  const f = S.f, q = f.q.trim().toLowerCase();
  const list = S.all.filter((c) => {
    if (f.region && c.region !== f.region) return false;
    if (f.sex && c.sex !== f.sex) return false;
    if (f.age && ageInfo(c).group !== f.age) return false;
    if (f.breed && c.breed !== f.breed) return false;
    if (f.source && (f.source === "fb" ? c.source === "shelter" || c.source === "user" : c.source !== f.source)) return false;
    if (f.neutered && c.neutered !== true) return false;
    if (f.vaccinated && c.vaccinated !== true) return false;
    if (f.fiv && c.fiv !== "neg") return false;
    if (q && ![c.title, c.name, c.description, c.color, c.breedText, c.contactName, c.region, c.district, c.locationText].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const when = (c) => (c.postedAt ? c.postedAt.getTime() : 0);
  if (f.sort === "region") list.sort((a, b) => a.region.localeCompare(b.region) || when(b) - when(a));
  else if (f.sort === "age") list.sort((a, b) => { const x = ageInfo(a).now, y = ageInfo(b).now; return (x == null) - (y == null) || x - y; });
  else list.sort((a, b) => when(b) - when(a));
  return list;
}
function cardHtml(c) {
  const a = ageInfo(c);
  const tags = [[sexLabel(c.sex), c.sex === "F" ? "f" : "m"], [ageLabel(c), "w"], breedLabel(c) && [breedLabel(c), "g"], colorLabel(c.color) && [colorLabel(c.color), "f"]].filter(Boolean);
  const health = healthTags(c).slice(0, 3);
  return `<button class="card" data-id="${esc(c.id)}" type="button">
    <div class="photo">${photoHtml(c)}<span class="ribbon">${esc(isMine(c) ? t("mine_badge") : sourceLabel(c.source))}</span></div>
    <div class="cbody"><h3>${esc(titleOf(c))}</h3>
      <div class="tags">${tags.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join("")}</div>
      <div class="tags">${health.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join("")}</div>
      <div class="meta">📍 ${esc(regionLabel(c.region))}${c.district ? " " + esc(c.district) : ""}${c.postedAt ? " · " + esc(fmtDate(c.postedAt)) : ""}</div></div></button>`;
}
function chipGroup(name, keys, label) { return `<div class="chips" data-chips="${name}">${keys.map((k) => `<button type="button" class="chip${S.f[name] === k ? " on" : ""}" data-v="${k}">${esc(label(k))}</button>`).join("")}</div>`; }
function renderBrowse() {
  const counts = { shelter: 0, fb: 0, user: 0 }, byRegion = {}, byBreed = {};
  S.all.forEach((c) => { counts[c.source === "shelter" ? "shelter" : c.source === "user" ? "user" : "fb"]++; if (c.region) byRegion[c.region] = (byRegion[c.region] || 0) + 1; if (c.breed) byBreed[c.breed] = (byBreed[c.breed] || 0) + 1; });
  const f = S.f;
  $("#app").innerHTML = `
  <section class="hero"><div><h1>${esc(t("brand"))}</h1><p>${esc(t("tagline"))}</p>
    <div class="stats"><div class="stat"><b>${S.all.length}</b><span>${esc(t("stat_total"))}</span></div><div class="stat"><b>${counts.shelter}</b><span>${esc(t("stat_shelter"))}</span></div><div class="stat"><b>${counts.fb}</b><span>${esc(t("stat_fb"))}</span></div><div class="stat"><b>${counts.user}</b><span>${esc(t("stat_user"))}</span></div></div></div>
    <div class="art" aria-hidden="true">🐱</div></section>
  ${S.shelterFail ? `<div class="notice warn">${esc(t("shelter_fail"))}</div>` : ""}
  <section class="panel filters" aria-label="Filters">
    <div class="frow"><div class="field search"><label for="q">${esc(t("search_ph"))}</label><input type="search" id="q" value="${esc(f.q)}"></div>
      <div class="field"><label for="region">${esc(t("region"))}</label><select id="region"><option value="">${esc(t("all_regions"))}</option>${REGIONS.filter((r) => byRegion[r]).map((r) => `<option value="${r}"${f.region === r ? " selected" : ""}>${esc(regionLabel(r))} (${byRegion[r]})</option>`).join("")}</select></div>
      <div class="field"><label for="breed">${esc(t("breed"))}</label><select id="breed"><option value="">${esc(t("all"))}</option>${Object.keys(BREEDS).filter((b) => byBreed[b]).map((b) => `<option value="${b}"${f.breed === b ? " selected" : ""}>${esc(BREEDS[b][en() ? 1 : 0])} (${byBreed[b]})</option>`).join("")}</select></div></div>
    <div class="frow"><div class="field"><span class="cap">${esc(t("sex"))}</span>${chipGroup("sex", ["M", "F"], sexLabel)}</div>
      <div class="field"><span class="cap">${esc(t("age"))}</span>${chipGroup("age", ["kitten", "adult", "senior"], (k) => t("age_" + k))}</div>
      <div class="field"><span class="cap">${esc(t("source"))}</span>${chipGroup("source", ["shelter", "fb", "user"], (k) => t("src_" + (k === "fb" ? "fb_catparadise" : k)))}</div></div>
    <div class="frow"><div class="checks"><label class="check"><input type="checkbox" id="neutered"${f.neutered ? " checked" : ""}> ${esc(t("neutered_only"))}</label><label class="check"><input type="checkbox" id="vaccinated"${f.vaccinated ? " checked" : ""}> ${esc(t("vaccinated_only"))}</label><label class="check"><input type="checkbox" id="fiv"${f.fiv ? " checked" : ""}> ${esc(t("fiv_neg"))}</label></div>
      <button class="btn ghost small" id="reset" type="button">${esc(t("reset"))}</button></div>
  </section>
  <div class="resultbar"><strong id="count"></strong><label>${esc(t("sort"))} <select id="sort">${[["new", "sort_new"], ["region", "sort_region"], ["age", "sort_age"]].map(([v, k]) => `<option value="${v}"${f.sort === v ? " selected" : ""}>${esc(t(k))}</option>`).join("")}</select></label></div>
  <div class="grid" id="grid"></div><div class="pager" id="pager"></div>`;
  let timer; const refresh = () => { S.f.page = 1; renderList(); };
  $("#q").oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { S.f.q = e.target.value; refresh(); }, 250); };
  $("#region").onchange = (e) => { S.f.region = e.target.value; refresh(); };
  $("#breed").onchange = (e) => { S.f.breed = e.target.value; refresh(); };
  $("#sort").onchange = (e) => { S.f.sort = e.target.value; refresh(); };
  ["neutered", "vaccinated", "fiv"].forEach((k) => { $("#" + k).onchange = (e) => { S.f[k] = e.target.checked; refresh(); }; });
  document.querySelectorAll("[data-chips]").forEach((box) => { box.onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; const n = box.dataset.chips; S.f[n] = S.f[n] === b.dataset.v ? "" : b.dataset.v; box.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.v === S.f[n])); refresh(); }; });
  $("#reset").onclick = () => { Object.assign(S.f, { q: "", region: "", sex: "", age: "", breed: "", source: "", neutered: false, vaccinated: false, fiv: false, sort: "new", page: 1 }); renderBrowse(); };
  $("#grid").onclick = (e) => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); };
  renderList();
}
function renderList() {
  const list = visible(), pages = Math.max(1, Math.ceil(list.length / PER_PAGE)); S.f.page = Math.min(S.f.page, pages);
  const slice = list.slice((S.f.page - 1) * PER_PAGE, S.f.page * PER_PAGE);
  $("#count").textContent = t("results", { n: list.length });
  $("#grid").innerHTML = slice.length ? slice.map(cardHtml).join("") : `<p class="empty" style="grid-column:1/-1">${esc(t("no_results"))}</p>`;
  $("#pager").innerHTML = pages > 1 ? `<button class="btn ghost small" id="prev" type="button"${S.f.page <= 1 ? " disabled" : ""}>${esc(t("prev"))}</button><span>${esc(t("page", { p: S.f.page, t: pages }))}</span><button class="btn ghost small" id="next" type="button"${S.f.page >= pages ? " disabled" : ""}>${esc(t("next"))}</button>` : "";
  if (pages > 1) { $("#prev").onclick = () => { S.f.page--; renderList(); scrollTo({ top: 0 }); }; $("#next").onclick = () => { S.f.page++; renderList(); scrollTo({ top: 0 }); }; }
}

/* ---------- detail + report ---------- */
function openDetail(id) {
  const c = S.all.find((x) => x.id === id); if (!c) return;
  const a = ageInfo(c), rows = [];
  const add = (k, v) => { if (v) rows.push(`<dt>${esc(t(k))}</dt><dd>${v}</dd>`); };
  add("sex", esc(sexLabel(c.sex))); add("age", esc(ageLabel(c)));
  if (a.post != null && a.post !== a.now && c.postedAt) add("age_at_post", esc(`${monthsLabel(a.post)} (${fmtDate(c.postedAt)})`));
  add("breed", esc(breedLabel(c) || t("unknown"))); add("color", esc(colorLabel(c.color) || ""));
  add("location", esc(regionLabel(c.region) + (c.district ? " " + c.district : ""))); add("found_at", esc(c.locationText || "")); add("shelter_no", esc(c.shelterNo || "")); add("available_from", esc(c.availableFrom || "")); add("updated", esc(fmtDate(c.postedAt)));
  const h = healthTags(c); add("health_status", h.length ? h.map(([x, k]) => `<span class="tag ${k}">${esc(x)}</span>`).join(" ") + (c.healthNote ? `<div class="meta">${esc(c.healthNote)}</div>` : "") : esc(t("unknown")));
  const ct = [];
  if (c.contactName) ct.push(esc(c.contactName));
  if (c.contactPhone) ct.push(`${esc(t("phone"))}: <a href="tel:${esc(c.contactPhone.replace(/[^\d+]/g, ""))}">${esc(c.contactPhone)}</a>`);
  if (c.contactLine) ct.push(`LINE: <a href="https://line.me/ti/p/~${encodeURIComponent(c.contactLine.replace(/^@/, ""))}" target="_blank" rel="noopener noreferrer">${esc(c.contactLine)}</a>`);
  if (c.contactOther) ct.push(esc(en() ? c.contactOther.replace("Facebook 私訊", "Facebook message").replace("Facebook 留言", "Facebook comment") : c.contactOther));
  add("contact", ct.join("<br>"));
  const d = $("#detail");
  d.innerHTML = `<div class="dhead"><button class="btn ghost small" id="dclose" type="button">${esc(t("close"))}</button></div><div class="dbody">
    <div class="photo">${photoHtml(c)}<span class="ribbon">${esc(isMine(c) ? t("mine_badge") : sourceLabel(c.source))}</span></div><h2>${esc(titleOf(c))}</h2>
    <dl class="kv">${rows.join("")}</dl>
    ${c.description ? `<div><div class="cap">${esc(t("description"))}</div><div class="desc">${esc(c.description)}</div></div>` : ""}
    ${c.sourceUrl ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(t("view_source"))} ↗</a>` : ""}
    ${isMine(c) ? `<div class="actions"><button class="btn small" id="dedit" type="button">${esc(t("edit"))}</button><button class="btn bad small" id="ddel" type="button">${esc(t("remove"))}</button></div>` : ""}
    <div class="report"><button type="button" class="linkbtn" id="rptoggle">⚑ ${esc(t("rp_open"))}</button>
      <form class="form" id="rpform" hidden novalidate>
        <div class="field"><label for="rpkind">${esc(t("rp_kind"))}</label><select id="rpkind"><option value="">—</option>${["wrong_info", "adopted", "duplicate", "inappropriate", "suggestion", "other"].map((k) => `<option value="${k}">${esc(t("rp_" + k))}</option>`).join("")}</select></div>
        <div class="field"><label for="rpmsg">${esc(t("rp_message"))}</label><textarea id="rpmsg" maxlength="1000"></textarea><div class="err" id="rperr"></div></div>
        <div class="field"><label for="rpct">${esc(t("rp_contact"))}</label><input type="text" id="rpct" maxlength="120"></div>
        <input type="text" id="rphp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
        <div id="rpres"></div><div><button class="btn small" type="submit">${esc(t("rp_submit"))}</button></div></form></div></div>`;
  $("#dclose").onclick = () => d.close();
  $("#rptoggle").onclick = () => { const f = $("#rpform"); f.hidden = !f.hidden; $("#rptoggle").textContent = "⚑ " + t(f.hidden ? "rp_open" : "rp_close"); };
  $("#rpform").onsubmit = (e) => sendReport(e, c);
  if (isMine(c)) { $("#dedit").onclick = () => { d.close(); location.hash = "#/edit/" + c.id; }; $("#ddel").onclick = () => removeListing(c); }
  if (!d.open) d.showModal();
}
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
async function sendReport(e, c) {
  e.preventDefault();
  const kind = $("#rpkind").value, msg = $("#rpmsg").value.trim(), out = $("#rpres");
  if ($("#rphp").value) return;
  if (!kind) { $("#rperr").textContent = t("err_required"); return; }
  if (["wrong_info", "suggestion", "other"].includes(kind) && msg.length < 5) { $("#rperr").textContent = t("rp_short"); return; }
  const recent = load("catjoy-reports", []).filter((x) => Date.now() - x < 3600000);
  if (recent.length >= 5) { out.innerHTML = `<div class="notice warn">${esc(t("err_generic"))}</div>`; return; }
  try {
    await wx("/wix-data/v2/items", { body: { dataCollectionId: "reports", dataItem: { data: { catId: String(c.id), catTitle: titleOf(c).slice(0, 120), kind, message: msg.slice(0, 1000), contact: $("#rpct").value.trim().slice(0, 120), status: "open" } } } });
    save("catjoy-reports", [...recent, Date.now()]); $("#rpform").reset(); out.innerHTML = `<div class="notice good">${esc(t("rp_thanks"))}</div>`; $("#rperr").textContent = "";
  } catch (err) { out.innerHTML = `<div class="notice bad">${esc(t("err_generic"))}</div>`; }
}

/* ---------- post / edit / my listings (members only; Wix permissions enforce who may change what) ---------- */
function gate(html, titleKey = "post_title") {
  if (S.memberLoading) return `<section class="panel"><div class="skel"></div></section>`;
  if (S.loggedIn) return html();
  return `<section class="panel"><h1 class="page-title">${esc(t(titleKey))}</h1><div class="notice">${esc(t("login_first"))}</div><p><button class="btn" id="gologin" type="button">${esc(t("login"))}</button></p><p class="meta">${esc(t("auth_why"))}</p></section>`;
}
function bindGate() { const b = $("#gologin"); if (b) b.onclick = () => openAuth(); }
const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(l)}</option>`;
function renderPost(editId) {
  const c = editId ? S.all.find((x) => x.id === editId) : null;
  if (editId && !loadedMine(editId)) { $("#app").innerHTML = `<section class="panel"><div class="notice bad">${esc(t("err_perm"))}</div></section>`; return; }
  const a = c ? ageInfo(c) : { now: null };
  $("#app").innerHTML = gate(() => `
  <section class="panel"><h1 class="page-title">${esc(t(c ? "edit_title" : "post_title"))}</h1><p class="meta">${esc(t("post_intro"))}</p>
  <form class="form" id="pform" novalidate>
    <div class="row"><div class="field"><label for="p_name">${esc(t("f_name"))}</label><input type="text" id="p_name" maxlength="40" value="${esc(c ? c.name : "")}"></div>
      <div class="field"><label for="p_region">${esc(t("f_region"))} <span class="need">*</span></label><select id="p_region"><option value="">—</option>${REGIONS.map((r) => opt(r, regionLabel(r), c && c.region === r)).join("")}</select><div class="err" data-e="region"></div></div>
      <div class="field"><label for="p_district">${esc(t("f_district"))}</label><input type="text" id="p_district" value="${esc(c ? c.district : "")}"></div></div>
    <div class="row"><div class="field"><label for="p_sex">${esc(t("sex"))}</label><select id="p_sex">${["U", "M", "F"].map((k) => opt(k, sexLabel(k), c && c.sex === k)).join("")}</select></div>
      <div class="field"><label for="p_age">${esc(t("f_age_months"))}</label><input type="number" id="p_age" min="0" max="300" value="${a.now != null ? a.now : ""}"></div>
      <div class="field"><label for="p_breed">${esc(t("breed"))}</label><select id="p_breed">${opt("", t("unknown"), !c || !c.breed)}${Object.keys(BREEDS).map((b) => opt(b, BREEDS[b][en() ? 1 : 0], c && c.breed === b)).join("")}</select></div>
      <div class="field"><label for="p_color">${esc(t("f_color"))}</label><input type="text" id="p_color" value="${esc(c ? c.color : "")}"></div></div>
    <div class="row">${[["neutered", "neutered"], ["vaccinated", "vaccinated"]].map(([k, l]) => `<div class="field"><label for="p_${k}">${esc(t(l))}</label><select id="p_${k}">${opt("", t("unknown"), !c || c[k] == null)}${opt("yes", t("yes"), c && c[k] === true)}${opt("no", t("no"), c && c[k] === false)}</select></div>`).join("")}
      <div class="field"><label for="p_fiv">${esc(t("fiv_felv"))}</label><select id="p_fiv">${opt("", t("unknown"), !c || !c.fiv)}${opt("neg", t("neg"), c && c.fiv === "neg")}${opt("pos", t("pos"), c && c.fiv === "pos")}</select></div></div>
    <div class="field"><label for="p_health">${esc(t("f_health"))}</label><input type="text" id="p_health" value="${esc(c ? c.healthNote : "")}"></div>
    <div class="field"><label for="p_desc">${esc(t("f_desc"))} <span class="need">*</span></label><textarea id="p_desc">${esc(c ? c.description : "")}</textarea><div class="err" data-e="desc"></div></div>
    <div class="field"><label for="p_photo">${esc(t("f_photo"))}</label><input type="url" id="p_photo" placeholder="https://" value="${esc(c ? c.photo : "")}"><span class="meta">${esc(t("f_photo_hint"))}</span></div>
    <fieldset style="border:2px dashed var(--line);border-radius:18px;padding:12px"><legend>${esc(t("contact"))} <span class="need">*</span></legend>
      <div class="row"><div class="field"><label for="p_cname">${esc(t("contact_name"))} <span class="need">*</span></label><input type="text" id="p_cname" value="${esc(c ? c.contactName : "")}"><div class="err" data-e="cname"></div></div>
        <div class="field"><label for="p_phone">${esc(t("f_phone"))}</label><input type="tel" id="p_phone" value="${esc(c ? c.contactPhone : "")}"></div>
        <div class="field"><label for="p_line">${esc(t("f_line"))}</label><input type="text" id="p_line" value="${esc(c ? c.contactLine : "")}"></div>
        <div class="field"><label for="p_other">${esc(t("f_other"))}</label><input type="text" id="p_other" value="${esc(c ? c.contactOther : "")}"></div></div>
      <div class="meta">${esc(t("contact_hint"))}</div><div class="err" data-e="contact"></div></fieldset>
    <div id="pres"></div><div class="actions"><button class="btn" id="psubmit" type="submit">${esc(t(c ? "save" : "submit"))}</button></div></form></section>`);
  bindGate();
  const form = $("#pform"); if (form) form.onsubmit = (e) => submitListing(e, c);
}
const loadedMine = (id) => { const c = S.all.find((x) => x.id === id); return !S.loaded || (c && isMine(c)); };
async function submitListing(e, existing) {
  e.preventDefault();
  document.querySelectorAll("[data-e]").forEach((x) => { x.textContent = ""; });
  const v = (id) => $("#" + id).value.trim(), err = {};
  if (!v("p_region")) err.region = t("err_required");
  if (v("p_desc").length < 10) err.desc = t("err_short");
  if (!v("p_cname")) err.cname = t("err_required");
  if (!(v("p_phone") || v("p_line") || v("p_other"))) err.contact = t("err_required");
  if (Object.keys(err).length) { Object.entries(err).forEach(([k, m]) => { const el = document.querySelector(`[data-e="${k}"]`); if (el) el.textContent = m; }); const first = document.querySelector("[data-e]:not(:empty)"); if (first) first.scrollIntoView({ block: "center" }); return; }
  const digits = (s) => String(s || "").replace(/\D/g, ""), phone = digits(v("p_phone")), line = v("p_line").toLowerCase();
  if (!existing) {
    const dup = S.all.find((x) => x.source !== "shelter" && ((phone && digits(x.contactPhone) === phone) || (line && (x.contactLine || "").toLowerCase() === line) || similarity(x.description, v("p_desc")) >= 0.85));
    if (dup) { $("#pres").innerHTML = `<div class="notice bad"><strong>${esc(t("dup_blocked"))}</strong><p><a href="#/" data-open="${esc(dup.id)}">${esc(t("dup_see"))}: ${esc(titleOf(dup))}</a></p></div>`; const a = $("#pres a"); a.onclick = (ev) => { ev.preventDefault(); openDetail(a.dataset.open); }; return; }
  }
  const age = v("p_age") === "" ? null : Math.max(0, Math.min(300, parseInt(v("p_age"), 10)));
  const data = { title: (v("p_name") || v("p_desc").split("\n")[0]).slice(0, 80), name: v("p_name"), source: "user", breed: v("p_breed"), color: v("p_color"), sex: v("p_sex"), ageGroup: groupOf(age), neutered: v("p_neutered"), vaccinated: v("p_vaccinated"), fivFelv: v("p_fiv"),
    healthTags: [], healthNote: v("p_health"), region: v("p_region"), district: v("p_district"), contactName: v("p_cname"), contactPhone: v("p_phone"), contactLine: v("p_line"), contactOther: v("p_other"), description: v("p_desc").slice(0, 2000),
    photoUrl: v("p_photo"), postedAt: { $date: new Date().toISOString() }, status: "open" };
  if (age != null) data.ageMonths = age; // postedAt moves with every edit, so the age counts forward from the day it was set
  const btn = $("#psubmit"); btn.disabled = true; btn.textContent = t("saving");
  try {
    if (existing) {
      await wx("/wix-data/v2/items/" + encodeURIComponent(existing.id), { method: "PUT", body: { dataCollectionId: "listings", dataItem: { id: existing.id, data } } });
    } else {
      const r = await wx("/wix-data/v2/items", { body: { dataCollectionId: "listings", dataItem: { data } } });
      const mine = load("catjoy-mine", []); mine.unshift({ id: r.dataItem && (r.dataItem.id || (r.dataItem.data && r.dataItem.data._id)), title: data.title, at: Date.now() }); save("catjoy-mine", mine.slice(0, 100));
    }
    await loadAll(); renderMember(); sessionStorage.setItem("catjoy-flash", existing ? "saved_ok" : "posted_ok"); location.hash = "#/mine";
  } catch (er) {
    btn.disabled = false; btn.textContent = t(existing ? "save" : "submit");
    $("#pres").innerHTML = `<div class="notice bad">${esc(er.status === 403 ? t("err_perm") : t("err_generic"))}</div>`;
  }
}
async function removeListing(c) {
  if (!confirm(t("confirm_remove"))) return;
  try { await wx("/wix-data/v2/items/" + encodeURIComponent(c.id), { method: "DELETE", query: { dataCollectionId: "listings" } }); save("catjoy-mine", load("catjoy-mine", []).filter((x) => x.id !== c.id)); await loadAll(); $("#detail").close(); route(); }
  catch (er) { alert(er.status === 403 ? t("err_perm") : t("err_generic")); }
}
function renderMine() {
  const flash = sessionStorage.getItem("catjoy-flash"); sessionStorage.removeItem("catjoy-flash");
  $("#app").innerHTML = gate(() => {
    const mine = S.all.filter(isMine).sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    return `<section class="panel"><h1 class="page-title">${esc(t("mine_title"))}</h1>${flash ? `<div class="notice good">${esc(t(flash))}</div>` : ""}<p class="meta">${esc(t("mine_note"))}</p>
      <p><a class="btn small" href="#/post" style="text-decoration:none;display:inline-block">+ ${esc(t("nav_post"))}</a></p>
      ${mine.length ? `<div class="grid" id="minegrid">${mine.map(cardHtml).join("")}</div>` : `<p class="empty">${esc(t("mine_empty"))}</p>`}</section>`;
  }, "mine_title");
  bindGate(); const g = $("#minegrid"); if (g) g.onclick = (e) => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); };
}

/* ---------- auth dialog ---------- */
function openAuth(after) {
  const d = $("#authdlg"); let mode = "login", step = "form";
  const draw = (msg) => {
    d.innerHTML = `<div class="dhead"><button class="btn ghost small" id="aclose" type="button">${esc(t("close"))}</button></div><div class="dbody">
      <h2>${esc(t(mode === "login" ? "auth_login" : "auth_register"))}</h2>
      ${step === "verify" ? `<div class="notice">${esc(t("auth_verify_need"))}</div><form class="form" id="vform"><div class="field"><label for="a_code">${esc(t("auth_code"))}</label><input type="text" id="a_code" autocomplete="one-time-code"></div><div id="ares">${msg || ""}</div><div><button class="btn" type="submit">${esc(t("verify"))}</button></div></form>`
      : step === "approval" ? `<div class="notice good">${esc(t("auth_approval"))}</div>`
      : `<div class="actions"><button type="button" class="chip${mode === "login" ? " on" : ""}" data-m="login">${esc(t("auth_login"))}</button><button type="button" class="chip${mode === "register" ? " on" : ""}" data-m="register">${esc(t("auth_register"))}</button></div>
      <form class="form" id="aform">${mode === "register" ? `<div class="row"><div class="field"><label for="a_first">${esc(t("first_name"))}</label><input type="text" id="a_first" autocomplete="given-name"></div><div class="field"><label for="a_last">${esc(t("last_name"))}</label><input type="text" id="a_last" autocomplete="family-name"></div></div>` : ""}
        <div class="field"><label for="a_email">${esc(t("email"))}</label><input type="email" id="a_email" autocomplete="email" required></div>
        <div class="field"><label for="a_pw">${esc(t("password"))}</label><input type="password" id="a_pw" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required></div>
        <div id="ares">${msg || ""}</div><div><button class="btn" id="asubmit" type="submit">${esc(t(mode === "login" ? "auth_login" : "auth_register"))}</button></div><p class="meta">${esc(t("auth_why"))}</p></form>`}</div>`;
    $("#aclose").onclick = () => d.close();
    d.querySelectorAll("[data-m]").forEach((b) => { b.onclick = () => { mode = b.dataset.m; draw(); }; });
    const finish = (r) => {
      if (r.state === "SUCCESS") { d.close(); route(); if (after) after(); }
      else if (r.state === "VERIFY") { step = "verify"; draw(); }
      else if (r.state === "APPROVAL") { step = "approval"; draw(); }
      else draw(`<div class="notice bad">${esc(r.error || t("err_generic"))}</div>`);
    };
    const af = $("#aform");
    if (af) af.onsubmit = async (e) => { e.preventDefault(); const b = $("#asubmit"); b.disabled = true; const email = $("#a_email").value.trim(), pw = $("#a_pw").value;
      finish(mode === "login" ? await doLogin(email, pw) : await doRegister(email, pw, { firstName: $("#a_first").value.trim(), lastName: $("#a_last").value.trim() })); };
    const vf = $("#vform"); if (vf) vf.onsubmit = async (e) => { e.preventDefault(); finish(await doVerify($("#a_code").value.trim())); };
  };
  draw(); if (!d.open) d.showModal();
}
$("#authdlg").addEventListener("click", (e) => { if (e.target.id === "authdlg") e.target.close(); });

/* ---------- shell ---------- */
function renderMember() {
  const m = $("#member");
  if (S.memberLoading) m.innerHTML = `<div class="skel"></div>`;
  else if (S.loggedIn) { const n = (S.member && S.member.name) || "Member"; m.innerHTML = `<div class="mini-user"><span class="avatar">${esc(n.slice(0, 1).toUpperCase())}</span><button class="btn ghost small" id="logout" type="button">${esc(t("logout"))}</button></div>`; $("#logout").onclick = logout; }
  else { m.innerHTML = `<button class="btn small" id="login" type="button">${esc(t("login"))}</button>`; $("#login").onclick = () => openAuth(); }
}
function renderNav() {
  const r = location.hash || "#/";
  const items = [["#/", "nav_browse", /^#\/?$/], ["#/post", "nav_post", /^#\/(post|edit)/], ["#/mine", "nav_mine", /^#\/mine/]];
  $("#nav").innerHTML = items.map(([h, k, re]) => `<a href="${h}" class="${re.test(r) ? "on" : ""}">${esc(t(k))}</a>`).join("");
  $("#brandText").textContent = t("brand"); $("#foot").textContent = t("foot");
  document.documentElement.lang = en() ? "en" : "zh-Hant";
  document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === S.lang));
}
function route() {
  renderNav(); renderMember();
  const h = location.hash || "#/";
  if (!S.loaded) { $("#app").innerHTML = `<p class="empty">${esc(t("loading"))} 🐾</p>`; return; }
  if (S.loadFail) { $("#app").innerHTML = `<div class="notice bad" style="margin-top:20px">${esc(t("load_fail"))}</div>`; return; }
  if (h.startsWith("#/post")) renderPost(null);
  else if (h.startsWith("#/edit/")) renderPost(decodeURIComponent(h.slice(7)));
  else if (h.startsWith("#/mine")) renderMine();
  else renderBrowse();
}
document.querySelectorAll(".lang button").forEach((b) => { b.onclick = () => { S.lang = b.dataset.lang; save("catjoy-lang", S.lang); route(); }; });
window.addEventListener("hashchange", () => { const d = $("#detail"); if (d.open) d.close(); route(); });
route();
Promise.all([loadAll().catch(() => { S.loaded = true; S.loadFail = true; }), refreshMember()]).then(() => { renderMember(); route(); });