const STORAGE_KEY = "circle-check-v1";
const sampleMembers = [
  ["田中 悠斗", "青葉大学", "男性"], ["佐藤 美咲", "青葉大学", "女性"],
  ["鈴木 健太", "中央工科大学", "男性"], ["高橋 彩", "西山大学", "女性"],
  ["伊藤 翔", "中央工科大学", "男性"], ["渡辺 葵", "西山大学", "女性"],
].map(([name, university, gender], i) => ({ id: `m${i + 1}`, name, university, gender }));

function normalizeState(data) {
  const normalized = data && typeof data === "object" ? data : {};
  normalized.members = Array.isArray(normalized.members) ? normalized.members : [];
  normalized.activities = Array.isArray(normalized.activities) ? normalized.activities : [];
  normalized.activities.forEach(activity => {
    activity.records = Array.isArray(activity.records) ? activity.records : [];
    activity.expense = Math.max(0, Number(activity.expense) || 0);
    if (!activity.collectorId && typeof activity.collector === "string") activity.collectorId = normalized.members.find(m => m.name === activity.collector)?.id || "";
    activity.collectorId = typeof activity.collectorId === "string" ? activity.collectorId : "";
    delete activity.collector;
  });
  normalized.currentActivityId = normalized.activities.some(a => a.id === normalized.currentActivityId) ? normalized.currentActivityId : null;
  return normalized;
}
let state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { members: sampleMembers, activities: [], currentActivityId: null });
const $ = id => document.getElementById(id);
const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const save = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderAll(); };
const formatDate = date => date ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date + "T00:00:00")) : "";
const currentActivity = () => state.activities.find(a => a.id === state.currentActivityId);
const recordFor = (activity, memberId) => activity?.records.find(r => r.memberId === memberId);
const collectorName = activity => state.members.find(m => m.id === activity?.collectorId)?.name || "未設定";
const toast = message => { $("toast").textContent = message; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 1800); };

document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
function showView(id) {
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === id));
  renderAll();
}

$("activity-date").value = new Date().toISOString().slice(0, 10);
$("create-activity").addEventListener("click", () => {
  const date = $("activity-date").value, location = $("activity-location").value.trim(), expense = Math.max(0, Number($("activity-expense").value) || 0), collectorId = $("activity-collector").value;
  if (!date || !location) return toast("活動日と場所を入力してください");
  const existing = state.activities.find(a => a.date === date && a.location === location);
  if (existing) { existing.expense = expense; existing.collectorId = collectorId; state.currentActivityId = existing.id; }
  else {
    const activity = { id: uid("a"), date, location, expense, collectorId, records: [] };
    state.activities.unshift(activity); state.currentActivityId = activity.id;
  }
  save(); toast("参加記録を開始しました");
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
  const record = recordFor(activity, m.id), attended = !!record?.attended, paid = !!record?.paid;
  const { rate } = participationStats(m.id, activity.id);
  return `<div class="check-row">${personHtml(m, rate)}<button class="toggle ${attended ? "on" : ""}" onclick="toggleRecord('${m.id}','attended')">${attended ? "✓ 参加" : "参加する"}</button><button class="toggle paid ${paid ? "on" : ""}" onclick="toggleRecord('${m.id}','paid')" ${!attended ? "disabled" : ""}>${paid ? "✓ 100円済" : "100円"}</button></div>`;
}
window.toggleRecord = (memberId, type) => {
  const activity = currentActivity(); let record = recordFor(activity, memberId);
  if (!record) { record = { memberId, attended: false, paid: false }; activity.records.push(record); }
  record[type] = !record[type]; if (type === "attended" && !record.attended) record.paid = false; save();
};

$("attendance-search").addEventListener("input", renderAttendanceList);
function renderAttendanceList() {
  const activity = currentActivity(); if (!activity) return;
  const q = $("attendance-search").value.trim().toLowerCase();
  const members = state.members
    .filter(m => !q || `${m.name} ${m.university}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStats = participationStats(a.id, activity.id), bStats = participationStats(b.id, activity.id);
      return bStats.rate - aStats.rate || bStats.count - aStats.count || a.name.localeCompare(b.name, "ja");
    });
  $("attendance-list").innerHTML = members.length ? members.map(m => checkRow(m, activity)).join("") : `<div class="empty">該当するメンバーはいません</div>`;
}

function renderActivities() {
  $("activity-list").innerHTML = state.activities.length ? state.activities.map(a => {
    const attended = a.records.filter(r => r.attended).length, paid = a.records.filter(r => r.paid).length, income = paid * 100, expense = Number(a.expense) || 0;
    return `<div class="panel activity-card"><p class="eyebrow">${formatDate(a.date)}</p><h3>${esc(a.location)}</h3><div class="activity-meta"><span>参加 ${attended}人</span><span>徴収 ${esc(collectorName(a))}</span></div><div class="activity-meta finance-meta"><span>参加費 ¥${income.toLocaleString()} / 体育館代 ¥${expense.toLocaleString()}</span><strong>収支 ${formatYen(income - expense)}</strong></div><div class="actions"><button class="secondary" onclick="openActivity('${a.id}')">参加を編集</button><button class="danger" onclick="deleteActivity('${a.id}')">削除</button></div></div>`;
  }).join("") : `<div class="empty">活動履歴はまだありません</div>`;
}
window.openActivity = id => {
  const activity = state.activities.find(a => a.id === id); if (!activity) return;
  state.currentActivityId = id;
  $("activity-date").value = activity.date;
  $("activity-location").value = activity.location;
  $("activity-expense").value = activity.expense || 0;
  $("activity-collector").value = activity.collectorId || "";
  save(); showView("reception");
};
window.deleteActivity = id => { if (!confirm("この活動記録を削除しますか？")) return; state.activities = state.activities.filter(a => a.id !== id); if (state.currentActivityId === id) state.currentActivityId = null; save(); };

$("open-member-modal").addEventListener("click", () => openMemberModal());
document.querySelectorAll(".close-modal").forEach(btn => btn.addEventListener("click", () => $("member-modal").close()));
$("member-search").addEventListener("input", renderMembers);
function openMemberModal(id = "") {
  const m = state.members.find(x => x.id === id);
  $("member-form-title").textContent = m ? "メンバー編集" : "メンバー追加";
  $("member-id").value = m?.id || ""; $("member-name").value = m?.name || ""; $("member-university").value = m?.university || "";
  $("member-gender").value = m?.gender || ""; $("member-modal").showModal();
}
window.editMember = openMemberModal;
$("member-form").addEventListener("submit", e => {
  e.preventDefault();
  const data = { id: $("member-id").value || uid("m"), name: $("member-name").value.trim(), university: $("member-university").value.trim(), gender: $("member-gender").value };
  if (!data.name) return;
  const index = state.members.findIndex(m => m.id === data.id); if (index >= 0) state.members[index] = data; else state.members.push(data);
  $("member-modal").close(); save(); toast("メンバー情報を保存しました");
});
window.deleteMember = id => {
  if (!confirm("このメンバーを削除しますか？ 過去の参加記録も集計対象外になります。")) return;
  state.members = state.members.filter(m => m.id !== id); state.activities.forEach(a => a.records = a.records.filter(r => r.memberId !== id)); save();
};
function renderMembers() {
  const q = $("member-search").value.trim().toLowerCase(), members = state.members.filter(m => !q || `${m.name} ${m.university}`.toLowerCase().includes(q));
  $("member-list").innerHTML = members.map(m => `<div class="member-row">${personHtml(m)}<span>${esc(m.university || "未設定")}</span><span>${esc(m.gender || "未設定")}</span><div class="actions"><button class="icon-btn" onclick="editMember('${m.id}')">編集</button><button class="icon-btn" onclick="deleteMember('${m.id}')">削除</button></div></div>`).join("") || `<div class="empty">メンバーがいません</div>`;
}
function renderCollectorOptions() {
  const select = $("activity-collector"), selected = select.value;
  select.innerHTML = `<option value="">未設定</option>` + state.members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
  const activity = currentActivity();
  select.value = activity?.collectorId || (state.members.some(m => m.id === selected) ? selected : "");
}

function renderStats() {
  const activityCount = state.activities.length, totalAttendance = state.activities.reduce((n, a) => n + a.records.filter(r => r.attended).length, 0), totalPaid = state.activities.reduce((n, a) => n + a.records.filter(r => r.paid).length, 0), totalExpense = state.activities.reduce((n, a) => n + (Number(a.expense) || 0), 0), totalRevenue = totalPaid * 100, balance = totalRevenue - totalExpense;
  $("stat-activities").textContent = activityCount; $("stat-attendance").textContent = totalAttendance; $("stat-revenue").textContent = formatYen(totalRevenue); $("stat-expense").textContent = formatYen(totalExpense); $("stat-balance").textContent = formatYen(balance); $("stat-balance").classList.toggle("negative", balance < 0); $("stat-average").textContent = activityCount ? (totalAttendance / activityCount).toFixed(1) : "0";
  const rows = state.members.map(m => { const count = state.activities.filter(a => recordFor(a, m.id)?.attended).length; return { name: m.name, count, rate: activityCount ? Math.round(count / activityCount * 100) : 0 }; }).sort((a, b) => b.count - a.count);
  $("member-stats").innerHTML = rows.map(x => `<div class="stat-row"><strong>${esc(x.name)}</strong><span>${x.count}回参加</span><strong>${x.rate}%</strong></div>`).join("") || `<div class="empty">データがありません</div>`;
  const universities = {}; state.members.forEach(m => { const uni = m.university || "未設定"; universities[uni] = (universities[uni] || 0) + state.activities.filter(a => recordFor(a, m.id)?.attended).length; });
  $("university-stats").innerHTML = Object.entries(universities).sort((a,b) => b[1] - a[1]).map(([name, count]) => `<div class="stat-row"><strong>${esc(name)}</strong><span>${count}回参加</span></div>`).join("") || `<div class="empty">データがありません</div>`;
}

const formatYen = amount => `${amount < 0 ? "−" : ""}¥${Math.abs(amount).toLocaleString()}`;

$("export-csv").addEventListener("click", () => {
  const headers = ["名前", "大学", "性別", "参加回数", "参加率", "支払回数", "支払合計"];
  const lines = state.members.map(m => { const attended = state.activities.filter(a => recordFor(a, m.id)?.attended).length, paid = state.activities.filter(a => recordFor(a, m.id)?.paid).length, rate = state.activities.length ? Math.round(attended / state.activities.length * 100) + "%" : "0%"; return [m.name, m.university, m.gender, attended, rate, paid, paid * 100]; });
  const csv = "\uFEFF" + [headers, ...lines].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `circle-check-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href); toast("Excel用CSVを出力しました");
});
$("export-activities-csv").addEventListener("click", () => {
  const headers = ["活動日", "活動場所", "参加人数", "支払人数", "参加費収入", "体育館代", "収支", "徴収担当者"];
  const lines = state.activities.map(a => {
    const attended = a.records.filter(r => r.attended).length, paid = a.records.filter(r => r.paid).length, revenue = paid * 100, expense = Number(a.expense) || 0;
    return [a.date, a.location, attended, paid, revenue, expense, revenue - expense, collectorName(a)];
  });
  const csv = "\uFEFF" + [headers, ...lines].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  downloadFile(csv, `circle-check-activities-${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8");
  toast("活動・収支CSVを出力しました");
});

function downloadFile(content, name, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
}
$("export-backup").addEventListener("click", () => {
  const backup = { format: "circle-check-backup", version: 1, exportedAt: new Date().toISOString(), data: state };
  downloadFile(JSON.stringify(backup, null, 2), `circle-check-backup-${new Date().toISOString().slice(0,10)}.json`, "application/json");
  toast("バックアップを保存しました");
});
$("import-backup").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = ""; if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "circle-check-backup" || !backup.data || !Array.isArray(backup.data.members) || !Array.isArray(backup.data.activities)) throw new Error("invalid");
    if (!confirm("現在のデータをバックアップ内のデータで置き換えますか？")) return;
    state = normalizeState(backup.data); save(); toast("バックアップから復元しました");
  } catch {
    toast("このファイルは復元に使用できません");
  }
});

let installPrompt = null;
const installBanner = $("install-banner");
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; installBanner.hidden = false; });
$("install-app").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installBanner.hidden = true;
});
$("dismiss-install").addEventListener("click", () => { installBanner.hidden = true; });
window.addEventListener("appinstalled", () => { installBanner.hidden = true; toast("インストールしました"); });
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone) {
  installBanner.hidden = false; $("install-app").hidden = true; $("install-help").textContent = "Safariの共有ボタンから「ホーム画面に追加」を選んでください。";
}
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));

function renderAll() { renderCollectorOptions(); renderReception(); renderActivities(); renderMembers(); renderStats(); }
renderAll();
