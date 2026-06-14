const STORAGE_KEY = "circle-check-v1";
const MIGRATION_KEY = "v-ridge-local-migration-v1";
const SUPABASE_URL = "https://sgqccdmpiykfyluxhjlo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8wEFppd2xMyL4lY6U34JSg_2_m3qHuR";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function normalizeState(data) {
  const normalized = data && typeof data === "object" ? data : {};
  normalized.members = Array.isArray(normalized.members) ? normalized.members : [];
  normalized.activities = Array.isArray(normalized.activities) ? normalized.activities : [];
  normalized.activities.forEach(activity => {
    activity.records = Array.isArray(activity.records) ? activity.records : [];
    activity.expense = Math.max(0, Number(activity.expense) || 0);
    activity.collectorId = typeof activity.collectorId === "string" ? activity.collectorId : "";
  });
  normalized.currentActivityId = normalized.activities.some(a => a.id === normalized.currentActivityId) ? normalized.currentActivityId : null;
  return normalized;
}

const cachedLocalState = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { members: [], activities: [], currentActivityId: null });
if (!localStorage.getItem(MIGRATION_KEY) && (cachedLocalState.members.length || cachedLocalState.activities.length)) {
  localStorage.setItem(MIGRATION_KEY, JSON.stringify(cachedLocalState));
}
const localSnapshot = normalizeState(JSON.parse(localStorage.getItem(MIGRATION_KEY) || "null") || { members: [], activities: [], currentActivityId: null });
let state = { members: [], activities: [], currentActivityId: null };
let currentUser = null;
let currentRole = null;
let realtimeChannel = null;
let reloadTimer = null;
let recoveryMode = false;

const $ = id => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const formatDate = date => date ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date + "T00:00:00")) : "";
const formatYen = amount => `${amount < 0 ? "−" : ""}¥${Math.abs(amount).toLocaleString()}`;
const currentActivity = () => state.activities.find(a => a.id === state.currentActivityId);
const recordFor = (activity, memberId) => activity?.records.find(r => r.memberId === memberId);
const collectorName = activity => state.members.find(m => m.id === activity?.collectorId)?.name || "未設定";
const canEdit = () => currentRole === "admin" || currentRole === "editor";
const isAdmin = () => currentRole === "admin";
const toast = message => { $("toast").textContent = message; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 2200); };
const setSync = text => { $("sync-status").textContent = text; };
const setBusy = busy => document.body.classList.toggle("loading", busy);
const persistCache = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

async function query(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.data;
}

async function loadCloudState({ quiet = false } = {}) {
  if (!currentUser) return;
  if (!quiet) { setBusy(true); setSync("同期中…"); }
  try {
    const [members, activities, attendance] = await Promise.all([
      query(db.from("members").select("*").order("name")),
      query(db.from("activities").select("*").order("activity_date", { ascending: false })),
      query(db.from("attendance").select("*")),
    ]);
    const oldCurrentId = state.currentActivityId;
    state = normalizeState({
      members: members.map(m => ({ id: m.id, name: m.name, university: m.university, gender: m.gender })),
      activities: activities.map(a => ({
        id: a.id, date: a.activity_date, location: a.location, expense: a.expense,
        collectorId: a.collector_member_id || "",
        records: attendance.filter(r => r.activity_id === a.id).map(r => ({ memberId: r.member_id, attended: r.attended, paid: r.paid })),
      })),
      currentActivityId: activities.some(a => a.id === oldCurrentId) ? oldCurrentId : null,
    });
    persistCache();
    renderAll();
    setSync(`${currentUser.email} / ${roleLabel(currentRole)}`);
  } catch (error) {
    console.error(error);
    setSync("同期エラー");
    if (!quiet) toast("共有データを読み込めませんでした");
  } finally {
    setBusy(false);
  }
}

const roleLabel = role => ({ admin: "管理者", editor: "編集者", viewer: "閲覧者" }[role] || "未承認");

async function initializeUser(session) {
  currentUser = session?.user || null;
  if (recoveryMode) {
    $("auth-screen").hidden = false;
    showRecoveryForm();
    return;
  }
  if (!currentUser) {
    $("auth-screen").hidden = false;
    showLoginForm();
    return;
  }
  try {
    const profile = await query(db.from("app_users").select("role, display_name").eq("user_id", currentUser.id).single());
    currentRole = profile.role;
    $("auth-screen").hidden = true;
    applyPermissions();
    await loadCloudState();
    startRealtime();
  } catch (error) {
    console.error(error);
    await db.auth.signOut();
    currentUser = null; currentRole = null;
    $("auth-screen").hidden = false;
    $("login-error").textContent = "このアカウントは利用を許可されていません。";
  }
}

function startRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel("shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, scheduleReload)
    .subscribe();
}
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadCloudState({ quiet: true }), 350);
}

function showLoginForm() {
  $("login-form").hidden = false;
  $("recovery-form").hidden = true;
}
function showRecoveryForm() {
  $("login-form").hidden = true;
  $("recovery-form").hidden = false;
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("login-error").textContent = "";
  $("login-button").disabled = true;
  const { error } = await db.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
  $("login-button").disabled = false;
  if (error) $("login-error").textContent = "メールアドレスまたはパスワードを確認してください。";
});
$("recovery-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("recovery-error").textContent = "";
  const password = $("recovery-password").value;
  if (password !== $("recovery-password-confirm").value) {
    $("recovery-error").textContent = "確認用パスワードが一致しません。";
    return;
  }
  $("recovery-button").disabled = true;
  const { error } = await db.auth.updateUser({ password });
  $("recovery-button").disabled = false;
  if (error) {
    $("recovery-error").textContent = "パスワードを変更できませんでした。リンクを再発行してください。";
    return;
  }
  recoveryMode = false;
  history.replaceState({}, document.title, location.pathname);
  toast("パスワードを変更しました");
  const { data } = await db.auth.getSession();
  await initializeUser(data.session);
});
$("logout-button").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
db.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") recoveryMode = true;
  setTimeout(() => initializeUser(session), 0);
});
db.auth.getSession().then(({ data }) => initializeUser(data.session));

function applyPermissions() {
  const editable = canEdit();
  $("create-activity").hidden = !editable;
  $("open-member-modal").hidden = !editable;
  $("import-backup").hidden = !isAdmin();
  $("migrate-local").hidden = !(isAdmin() && localSnapshot.members.length && !state.members.length);
}

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
function showView(id) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === id));
  renderAll();
}

$("activity-date").value = new Date().toISOString().slice(0, 10);
$("create-activity").addEventListener("click", async () => {
  if (!canEdit()) return;
  const date = $("activity-date").value, location = $("activity-location").value.trim(), expense = Math.max(0, Number($("activity-expense").value) || 0), collectorId = $("activity-collector").value || null;
  if (!date || !location) return toast("活動日と場所を入力してください");
  setBusy(true);
  try {
    const existing = state.activities.find(a => a.date === date && a.location === location);
    let row;
    if (existing) {
      row = await query(db.from("activities").update({ expense, collector_member_id: collectorId }).eq("id", existing.id).select().single());
    } else {
      row = await query(db.from("activities").insert({ activity_date: date, location, expense, collector_member_id: collectorId }).select().single());
    }
    state.currentActivityId = row.id;
    await logChange(existing ? "update" : "insert", "activities", row.id);
    await loadCloudState({ quiet: true });
    toast("参加記録を開始しました");
  } catch (error) { console.error(error); toast("活動を保存できませんでした"); }
  finally { setBusy(false); }
});

function participationStats(memberId, excludedActivityId = null) {
  const activities = state.activities.filter(a => a.id !== excludedActivityId);
  const count = activities.filter(a => recordFor(a, memberId)?.attended).length;
  return { count, rate: activities.length ? Math.round(count / activities.length * 100) : 0 };
}
function personHtml(m, rate = null) {
  const rateText = rate === null ? "" : ` ・ 参加率：${rate}%`;
  return `<div class="person"><div class="avatar">${esc(m.name.slice(0, 1))}</div><div class="person-info"><strong>${esc(m.name)}</strong><span>${esc(m.university || "大学未設定")}${rateText}</span></div></div>`;
}
function renderReception() {
  const activity = currentActivity();
  $("reception-empty").hidden = !!activity; $("reception-content").hidden = !activity;
  $("today-attendance").textContent = activity?.records.filter(r => r.attended).length || 0;
  $("today-paid").textContent = activity?.records.filter(r => r.paid).length || 0;
  if (!activity) return;
  $("current-activity-label").textContent = `${formatDate(activity.date)} / ${activity.location} / 体育館代 ¥${activity.expense.toLocaleString()} / 徴収：${collectorName(activity)}`;
  renderAttendanceList();
}
function checkRow(m, activity) {
  const record = recordFor(activity, m.id), attended = !!record?.attended, paid = !!record?.paid, disabled = canEdit() ? "" : "disabled";
  const { rate } = participationStats(m.id, activity.id);
  return `<div class="check-row">${personHtml(m, rate)}<button class="toggle ${attended ? "on" : ""}" onclick="toggleRecord('${m.id}','attended')" ${disabled}>${attended ? "✓ 参加" : "参加する"}</button><button class="toggle paid ${paid ? "on" : ""}" onclick="toggleRecord('${m.id}','paid')" ${!attended || !canEdit() ? "disabled" : ""}>${paid ? "✓ 100円済" : "100円"}</button></div>`;
}
window.toggleRecord = async (memberId, type) => {
  if (!canEdit()) return;
  const activity = currentActivity(); if (!activity) return;
  const existing = recordFor(activity, memberId) || { attended: false, paid: false };
  const next = { ...existing, [type]: !existing[type] };
  if (type === "attended" && !next.attended) next.paid = false;
  try {
    await query(db.from("attendance").upsert({ activity_id: activity.id, member_id: memberId, attended: next.attended, paid: next.paid }));
    await logChange("upsert", "attendance", `${activity.id}:${memberId}`);
    await loadCloudState({ quiet: true });
  } catch (error) { console.error(error); toast("参加記録を保存できませんでした"); }
};

$("attendance-search").addEventListener("input", renderAttendanceList);
function renderAttendanceList() {
  const activity = currentActivity(); if (!activity) return;
  const q = $("attendance-search").value.trim().toLowerCase();
  const members = state.members.filter(m => !q || `${m.name} ${m.university}`.toLowerCase().includes(q)).sort((a, b) => {
    const aStats = participationStats(a.id, activity.id), bStats = participationStats(b.id, activity.id);
    return bStats.rate - aStats.rate || bStats.count - aStats.count || a.name.localeCompare(b.name, "ja");
  });
  $("attendance-list").innerHTML = members.length ? members.map(m => checkRow(m, activity)).join("") : `<div class="empty">該当するメンバーはいません</div>`;
}

function renderActivities() {
  $("activity-list").innerHTML = state.activities.length ? state.activities.map(a => {
    const attended = a.records.filter(r => r.attended).length, paid = a.records.filter(r => r.paid).length, income = paid * 100, expense = Number(a.expense) || 0;
    return `<div class="panel activity-card"><p class="eyebrow">${formatDate(a.date)}</p><h3>${esc(a.location)}</h3><div class="activity-meta"><span>参加 ${attended}人</span><span>徴収 ${esc(collectorName(a))}</span></div><div class="activity-meta finance-meta"><span>参加費 ¥${income.toLocaleString()} / 体育館代 ¥${expense.toLocaleString()}</span><strong>収支 ${formatYen(income - expense)}</strong></div><div class="actions"><button class="secondary" onclick="openActivity('${a.id}')">${canEdit() ? "参加を編集" : "詳細を見る"}</button>${canEdit() ? `<button class="danger" onclick="deleteActivity('${a.id}')">削除</button>` : ""}</div></div>`;
  }).join("") : `<div class="empty">活動履歴はまだありません</div>`;
}
window.openActivity = id => {
  const activity = state.activities.find(a => a.id === id); if (!activity) return;
  state.currentActivityId = id;
  $("activity-date").value = activity.date; $("activity-location").value = activity.location; $("activity-expense").value = activity.expense || 0; $("activity-collector").value = activity.collectorId || "";
  renderAll(); showView("reception");
};
window.deleteActivity = async id => {
  if (!canEdit() || !confirm("この活動記録を削除しますか？")) return;
  try { await query(db.from("activities").delete().eq("id", id)); await logChange("delete", "activities", id); await loadCloudState({ quiet: true }); }
  catch (error) { console.error(error); toast("活動を削除できませんでした"); }
};

$("open-member-modal").addEventListener("click", () => openMemberModal());
document.querySelectorAll(".close-modal").forEach(btn => btn.addEventListener("click", () => $("member-modal").close()));
$("member-search").addEventListener("input", renderMembers);
function openMemberModal(id = "") {
  if (!canEdit()) return;
  const m = state.members.find(x => x.id === id);
  $("member-form-title").textContent = m ? "メンバー編集" : "メンバー追加";
  $("member-id").value = m?.id || ""; $("member-name").value = m?.name || ""; $("member-university").value = m?.university || ""; $("member-gender").value = m?.gender || ""; $("member-modal").showModal();
}
window.editMember = openMemberModal;
$("member-form").addEventListener("submit", async event => {
  event.preventDefault(); if (!canEdit()) return;
  const id = $("member-id").value, values = { name: $("member-name").value.trim(), university: $("member-university").value.trim(), gender: $("member-gender").value };
  if (!values.name) return;
  try {
    const row = id ? await query(db.from("members").update(values).eq("id", id).select().single()) : await query(db.from("members").insert(values).select().single());
    await logChange(id ? "update" : "insert", "members", row.id);
    $("member-modal").close(); await loadCloudState({ quiet: true }); toast("メンバー情報を保存しました");
  } catch (error) { console.error(error); toast("メンバー情報を保存できませんでした"); }
});
window.deleteMember = async id => {
  if (!canEdit() || !confirm("このメンバーを削除しますか？ 過去の参加記録も集計対象外になります。")) return;
  try { await query(db.from("members").delete().eq("id", id)); await logChange("delete", "members", id); await loadCloudState({ quiet: true }); }
  catch (error) { console.error(error); toast("メンバーを削除できませんでした"); }
};
function renderMembers() {
  const q = $("member-search").value.trim().toLowerCase(), members = state.members.filter(m => !q || `${m.name} ${m.university}`.toLowerCase().includes(q));
  $("member-list").innerHTML = members.map(m => `<div class="member-row">${personHtml(m)}<span>${esc(m.university || "未設定")}</span><span>${esc(m.gender || "未設定")}</span>${canEdit() ? `<div class="actions"><button class="icon-btn" onclick="editMember('${m.id}')">編集</button><button class="icon-btn" onclick="deleteMember('${m.id}')">削除</button></div>` : ""}</div>`).join("") || `<div class="empty">メンバーがいません</div>`;
}
function renderCollectorOptions() {
  const select = $("activity-collector"), selected = select.value;
  select.disabled = !canEdit();
  select.innerHTML = `<option value="">未設定</option>` + state.members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
  select.value = currentActivity()?.collectorId || (state.members.some(m => m.id === selected) ? selected : "");
}

function renderStats() {
  const activityCount = state.activities.length, totalAttendance = state.activities.reduce((n, a) => n + a.records.filter(r => r.attended).length, 0), totalPaid = state.activities.reduce((n, a) => n + a.records.filter(r => r.paid).length, 0), totalExpense = state.activities.reduce((n, a) => n + (Number(a.expense) || 0), 0), totalRevenue = totalPaid * 100, balance = totalRevenue - totalExpense;
  $("stat-activities").textContent = activityCount; $("stat-attendance").textContent = totalAttendance; $("stat-revenue").textContent = formatYen(totalRevenue); $("stat-expense").textContent = formatYen(totalExpense); $("stat-balance").textContent = formatYen(balance); $("stat-balance").classList.toggle("negative", balance < 0); $("stat-average").textContent = activityCount ? (totalAttendance / activityCount).toFixed(1) : "0";
  const rows = state.members.map(m => { const count = state.activities.filter(a => recordFor(a, m.id)?.attended).length; return { name: m.name, count, rate: activityCount ? Math.round(count / activityCount * 100) : 0 }; }).sort((a, b) => b.count - a.count);
  $("member-stats").innerHTML = rows.map(x => `<div class="stat-row"><strong>${esc(x.name)}</strong><span>${x.count}回参加</span><strong>${x.rate}%</strong></div>`).join("") || `<div class="empty">データがありません</div>`;
  const universities = {}; state.members.forEach(m => { const uni = m.university || "未設定"; universities[uni] = (universities[uni] || 0) + state.activities.filter(a => recordFor(a, m.id)?.attended).length; });
  $("university-stats").innerHTML = Object.entries(universities).sort((a,b) => b[1] - a[1]).map(([name, count]) => `<div class="stat-row"><strong>${esc(name)}</strong><span>${count}回参加</span></div>`).join("") || `<div class="empty">データがありません</div>`;
}

function downloadFile(content, name, type) {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href);
}
$("export-csv").addEventListener("click", () => {
  const headers = ["名前", "大学", "性別", "参加回数", "参加率", "支払回数", "支払合計"];
  const lines = state.members.map(m => { const attended = state.activities.filter(a => recordFor(a, m.id)?.attended).length, paid = state.activities.filter(a => recordFor(a, m.id)?.paid).length, rate = state.activities.length ? Math.round(attended / state.activities.length * 100) + "%" : "0%"; return [m.name, m.university, m.gender, attended, rate, paid, paid * 100]; });
  downloadFile(toCsv([headers, ...lines]), `v-ridge-members-${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8");
});
$("export-activities-csv").addEventListener("click", () => {
  const headers = ["活動日", "活動場所", "参加人数", "支払人数", "参加費収入", "体育館代", "収支", "徴収担当者"];
  const lines = state.activities.map(a => { const attended = a.records.filter(r => r.attended).length, paid = a.records.filter(r => r.paid).length, revenue = paid * 100, expense = Number(a.expense) || 0; return [a.date, a.location, attended, paid, revenue, expense, revenue - expense, collectorName(a)]; });
  downloadFile(toCsv([headers, ...lines]), `v-ridge-activities-${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8");
});
const toCsv = rows => "\uFEFF" + rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");

$("export-backup").addEventListener("click", () => {
  const backup = { format: "circle-check-backup", version: 2, exportedAt: new Date().toISOString(), data: state };
  downloadFile(JSON.stringify(backup, null, 2), `v-ridge-backup-${new Date().toISOString().slice(0,10)}.json`, "application/json");
});
$("import-backup").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = ""; if (!file || !isAdmin()) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup.data || !Array.isArray(backup.data.members) || !Array.isArray(backup.data.activities)) throw new Error("invalid");
    if (!confirm("共有データをバックアップ内のデータで置き換えますか？")) return;
    await importState(normalizeState(backup.data), true); toast("バックアップから共有データを復元しました");
  } catch (error) { console.error(error); toast("このファイルは復元に使用できません"); }
});
$("migrate-local").addEventListener("click", async () => {
  if (!isAdmin() || !confirm("この端末に残っているデータを共有データへ移行しますか？")) return;
  try { await importState(localSnapshot, false); localStorage.removeItem(MIGRATION_KEY); $("migrate-local").hidden = true; toast("端末データを共有へ移行しました"); }
  catch (error) { console.error(error); toast("端末データを移行できませんでした"); }
});

async function importState(source, replace) {
  setBusy(true);
  try {
    if (replace) {
      await query(db.from("attendance").delete().not("activity_id", "is", null));
      await query(db.from("activities").delete().not("id", "is", null));
      await query(db.from("members").delete().not("id", "is", null));
    }
    const memberMap = new Map();
    for (const member of source.members) {
      const row = await query(db.from("members").insert({ name: member.name, university: member.university || "", gender: member.gender || "" }).select().single());
      memberMap.set(member.id, row.id);
    }
    for (const activity of source.activities) {
      const row = await query(db.from("activities").insert({ activity_date: activity.date, location: activity.location, expense: activity.expense || 0, collector_member_id: memberMap.get(activity.collectorId) || null }).select().single());
      const records = activity.records.map(r => ({ activity_id: row.id, member_id: memberMap.get(r.memberId), attended: !!r.attended, paid: !!r.paid })).filter(r => r.member_id);
      if (records.length) await query(db.from("attendance").insert(records));
    }
    await logChange(replace ? "restore" : "migrate", "all", null);
    await loadCloudState({ quiet: true });
  } finally { setBusy(false); }
}

async function logChange(action, tableName, recordId) {
  try { await db.from("audit_logs").insert({ user_id: currentUser.id, action, table_name: tableName, record_id: recordId }); } catch {}
}

let installPrompt = null;
const installBanner = $("install-banner");
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; installBanner.hidden = false; });
$("install-app").addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installBanner.hidden = true; });
$("dismiss-install").addEventListener("click", () => { installBanner.hidden = true; });
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone) { installBanner.hidden = false; $("install-app").hidden = true; $("install-help").textContent = "Safariの共有ボタンから「ホーム画面に追加」を選んでください。"; }
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));

function renderAll() { renderCollectorOptions(); renderReception(); renderActivities(); renderMembers(); renderStats(); applyPermissions(); }
renderAll();
