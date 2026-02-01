import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { appText } from "./content.js";

// ① 改成你自己的
const SUPABASE_URL = "https://ehmkvkgbwdppwllxdxrl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobWt2a2did2RwcHdsbHhkeHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NjAyNzIsImV4cCI6MjA4NTMzNjI3Mn0.vxEseoz0PBAmfyVBBgq96WaVNAvKG8fcx8FsITgXmU0";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// UI refs
const el = (id) => document.getElementById(id);
const authStatus = el("authStatus");
const createStatus = el("createStatus");
const uploadStatus = el("uploadStatus");
const expenseList = el("expenseList");

let currentUser = null;
let lastExpenseId = null;

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function setAuthUI(loggedIn) {
  const btn = el("btnSignOut");
  if (btn) btn.disabled = !loggedIn;
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user ?? null;
  if (authStatus) {
    authStatus.textContent = currentUser ? `已登入：${currentUser.email}` : "尚未登入";
  }
  setAuthUI(!!currentUser);
}

// Auth actions logic removed per request
/*
el("btnSignUp").addEventListener("click", ...);
el("btnSignIn").addEventListener("click", ...);
el("btnSignOut").addEventListener("click", ...);
*/

// Create expense
el("expenseDate").value = todayISO();

el("btnCreateExpense").addEventListener("click", async () => {
  try {
    createStatus.textContent = "";
    // Auth Check removed
    // if (!currentUser) throw new Error("請先登入");
    // Use a VALID UUID for the mock user to satisfy DB constraints
    const MOCK_USER_ID = "00000000-0000-0000-0000-000000000000";
    const userId = currentUser ? currentUser.id : MOCK_USER_ID;

    const identityId = el("identitySelect").value;
    const identityProfileId = el("identityProfileSelect").value;
    const customerId = el("customerSelect").value || null;
    const amount = Number(el("amount").value);
    const currency = el("currency").value || "TWD";
    const expenseDate = el("expenseDate").value;
    const claimStatus = el("claimStatus").value;
    const note = el("note").value.trim() || null;

    if (!identityId) throw new Error("請選我的身份");
    if (!identityProfileId) throw new Error("請選名片名稱");
    if (!customerId) throw new Error("請選朋友名稱");
    if (!amount || amount <= 0) throw new Error("金額需大於 0");
    if (!expenseDate) throw new Error("請選日期");

    // Start Loading
    showLoader();

    // Insert Expense Record
    // DB Operation (Insert or Update)
    let newId = null;

    if (currentEditingId) {

      // UPDATE Logic with Audit Log
      // 1. Fetch current state for history
      const { data: oldData, error: fetchErr } = await supabase
        .from("expenses")
        .select("*")
        .eq("id", currentEditingId)
        .single();

      if (!fetchErr && oldData) {
        await logExpenseVersion(oldData, "UPDATE");
      }

      // 2. Perform Update
      const { data, error } = await supabase
        .from("expenses")
        .update({
          // user_id shouldn't change
          identity_id: identityId,
          identity_profile_id: identityProfileId,
          customer_id: customerId,
          amount,
          currency,
          expense_date: expenseDate,
          claim_status: claimStatus,
          note
        })
        .eq("id", currentEditingId)
        .select("id")
        .single();

      if (error) throw error;
      newId = currentEditingId;
      lastExpenseId = newId;

    } else {
      // INSERT (No previous history)
      const { data, error } = await supabase
        .from("expenses")
        .insert({
          user_id: userId,
          identity_id: identityId,
          identity_profile_id: identityProfileId,
          customer_id: customerId,
          amount,
          currency,
          expense_date: expenseDate,
          claim_status: claimStatus,
          note
        })
        .select("id")
        .single();

      if (error) throw error;
      newId = data.id;
      lastExpenseId = newId;
    }

    let statusMsg = currentEditingId ? "費用已更新" : "費用已建立";

    // Handle File Upload (Sequential)
    // Capture file object BEFORE resetting form
    const file = el("receiptFile").files?.[0];

    if (file) {
      // statusMsg += " ...正在上傳收據";
      // User wants popup, so we don't show incremental progress on screen to keep it clean.
      // createStatus.textContent = statusMsg;

      // Log Upload Action (fetch fresh state just in case)
      const { data: currentForLog } = await supabase.from("expenses").select("*").eq("id", lastExpenseId).single();
      if (currentForLog) await logExpenseVersion(currentForLog, "UPLOAD");

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const filename = `${crypto.randomUUID()}.${ext}`;
      const objectPath = `${userId}/${lastExpenseId}/${filename}`;

      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(objectPath, file, { upsert: false, contentType: file.type });

      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from("expense_attachments").insert({
        expense_id: lastExpenseId,
        // DB requires user_id (not just expense_id)
        user_id: userId,
        object_path: objectPath,
        file_name: file.name,
        mime_type: file.type,
        size: file.size
      });

      if (dbErr) throw dbErr;
      statusMsg += "，收據上傳成功";
    }

    // Unify reset logic
    resetForm();
    validateForm(); // Re-disable button

    clearExpenseCache(); // Invalidate cache
    await loadExpenses();

    // Show Success Modal
    // Ensure we await it if we want to block (though not strictly necessary here)
    // User requested Title to be "費用已建立" and no subtitle.
    // statusMsg is "費用已建立" or "費用已更新"
    // Show Success Modal
    hideLoader();
    showAlert(statusMsg, "");

  } catch (e) {
    console.error(e);
    hideLoader();
    showAlert("錯誤", e.message);
  }
});

// Global Loader Helpers
function showLoader() {
  const l = el("globalLoader");
  if (l) l.classList.add("visible");
}

function hideLoader() {
  const l = el("globalLoader");
  if (l) l.classList.remove("visible");
}




// Global for Edit Mode
let currentEditingId = null;
let currentFilterDate = new Date(); // To track current filter month

// Pagination State
const PAGE_SIZE = 10;
let historyPage = 1;
let searchPage = 1;

// Client-Side Cache
const expenseCache = new Map();

function clearExpenseCache() {
  expenseCache.clear();
  console.log("Cache cleared");
}

// Month Filter UI
const btnPrevMonth = el("btnPrevMonth");
const btnNextMonth = el("btnNextMonth");
const lblCurrentMonth = el("lblCurrentMonth");

if (btnPrevMonth && btnNextMonth) {
  btnPrevMonth.addEventListener("click", () => changeMonth(-1));
  btnNextMonth.addEventListener("click", () => changeMonth(1));
}

function renderMonthFilter() {
  const y = currentFilterDate.getFullYear();
  const m = String(currentFilterDate.getMonth() + 1).padStart(2, '0');
  if (lblCurrentMonth) lblCurrentMonth.textContent = `${y}-${m}`;
}

function changeMonth(offset) {
  currentFilterDate.setMonth(currentFilterDate.getMonth() + offset);
  historyPage = 1; // Reset page when month changes
  renderMonthFilter();
  loadExpenses();
}

// List expenses + show first attachment image (if any)
async function loadExpenses() {
  // Update Filter UI first
  renderMonthFilter();

  // Calculate Date Range (Local Date String YYYY-MM-DD to avoid Timezone shift)
  const y = currentFilterDate.getFullYear();
  const m = currentFilterDate.getMonth() + 1; // 1-12
  const lastDay = new Date(y, m, 0).getDate();

  const startStr = `${y}-${String(m).padStart(2, '0')}-01`;
  const endStr = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;

  // Cache Key
  const cacheKey = `history-${y}-${m}-${historyPage}`;

  let expenses = [];
  let count = 0;

  if (expenseCache.has(cacheKey)) {
    console.log("Serving from cache:", cacheKey);
    const cached = expenseCache.get(cacheKey);
    expenses = cached.expenses;
    count = cached.count;
  } else {
    // Calculate Pagination Range
    const from = (historyPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // Fetch expenses (Filter deleted + Date Range + Pagination)
    const { data, error, count: dbCount } = await supabase
      .from("expenses")
      .select("id, amount, currency, expense_date, claim_status, note, created_at, identity_id, identity_profile_id, customer_id", { count: 'exact' })
      .is("deleted_at", null)
      .gte("expense_date", startStr)
      .lte("expense_date", endStr)
      .order("expense_date", { ascending: false })
      .range(from, to);

    if (error) {
      if (expenseList) expenseList.innerHTML = `<div class="hint">${error.message}</div>`;
      return;
    }

    expenses = data;
    count = dbCount;

    // Store in Cache
    expenseCache.set(cacheKey, { expenses, count });
  }

  // Render Pagination Controls
  updatePaginationUI("history", historyPage, count);

  // Fetch attachments (Same logic)
  const ids = expenses.map((x) => x.id);
  let attachmentsByExpense = {};
  if (ids.length) {
    const { data: atts } = await supabase
      .from("expense_attachments")
      .select("expense_id, object_path")
      .in("expense_id", ids);

    for (const a of atts || []) {
      attachmentsByExpense[a.expense_id] ||= [];
      attachmentsByExpense[a.expense_id].push(a.object_path);
    }
  }

  // Fetch Friend Names (Manual Join)
  const customerIds = [...new Set(expenses.map(x => x.customer_id).filter(Boolean))];
  const friendMap = {};
  if (customerIds.length) {
    const { data: friends } = await supabase
      .from("ref_friends")
      .select("id, name")
      .in("id", customerIds);

    (friends || []).forEach(f => {
      friendMap[f.id] = f.name;
    });
  }

  // Render List
  renderExpenseListUI(expenseList, expenses, friendMap, attachmentsByExpense);
}

// Reusable Render Function
function renderExpenseListUI(container, expenses, friendMap, attachmentsByExpense) {
  if (expenses.length === 0) {
    container.innerHTML = '<div class="hint">沒有找到相關費用</div>';
    return;
  }

  container.innerHTML = expenses
    .map((x) => {
      const paths = attachmentsByExpense[x.id] || [];
      const count = paths.length;
      const friendName = friendMap[x.customer_id] || "未知";
      const hasAttachments = paths.length > 0;

      // New Layout (Flex Row)
      return `
        <div class="expense-history-item">
          <div class="history-content-left">
            <div class="history-row date">${x.expense_date}</div>
            <div class="history-row friend">${escapeHtml(friendName)}</div>
            <div class="history-row amount">${x.currency || "TWD"} <strong>${x.amount}</strong></div>
            <div class="history-row note">${x.note ? escapeHtml(x.note) : "無備註"}</div>
            <div class="history-row attachment">附件：${count} 張</div>
          </div>
          <div class="history-actions-right">
             ${hasAttachments ?
          `<button class="history-btn-action view-receipt" onclick="window.viewReceipts('${x.id}')">查看收據</button>` :
          ``
        }
             <button class="history-btn-action edit" data-edit-id="${x.id}" data-json='${JSON.stringify(x).replace(/'/g, "&#39;")}'>修改</button>
             <button class="history-btn-action delete" data-delete-id="${x.id}" data-json='${JSON.stringify(x).replace(/'/g, "&#39;")}'>刪除</button>
          </div>
        </div>
        <div class="history-separator"></div>
      `;
    })
    .join("");

  // Re-bind buttons after render
  bindListButtons();
}

function bindListButtons() {
  document.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const json = JSON.parse(btn.getAttribute("data-json"));
      window.editExpense(json.id);
    });
  });

  document.querySelectorAll("[data-delete-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-id");
      const json = JSON.parse(btn.getAttribute("data-json"));
      showConfirmModal("確認刪除", "確定要刪除這筆費用嗎？(此動作將封存舊資料)", async () => {
        await performDelete(id, json);
      });
    });
  });
}

// Separate delete logic for reusability
async function performDelete(id, jsonRecord) {
  try {
    await logExpenseVersion(jsonRecord, "DELETE");
    const { error } = await supabase
      .from("expenses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    // Refresh current view (History or Search?)
    // Simple strategy: Reload History if visible, or re-search if needed. 
    // For MVP, just loadExpenses() which updates History. 
    // If we are in Search, we might want to re-trigger search, but let's stick to base flow.
    clearExpenseCache(); // Invalidate cache
    await loadExpenses();


  } catch (e) {
    alert("刪除失敗：" + e.message);
    console.error(e);
  }
}

// Bind Buttons
// Upload button removed per user request (redundant with Edit)

document.querySelectorAll("[data-delete-id]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-delete-id");
    const json = JSON.parse(btn.getAttribute("data-json"));

    showConfirmModal("確認刪除", "確定要刪除這筆費用嗎？(此動作將封存舊資料)", async () => {
      try {
        // 1. Audit Log 
        await logExpenseVersion(json, "DELETE");

        // 2. Soft Delete
        const { error } = await supabase
          .from("expenses")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id);

        if (error) throw error;
        await loadExpenses();

      } catch (e) {
        alert("刪除失敗：" + e.message);
        console.error(e);
      }
    });
  });
});

document.querySelectorAll("[data-edit-id]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const json = JSON.parse(btn.getAttribute("data-json"));
    startEditMode(json);
  });
});


// Helper: Audit Log
async function logExpenseVersion(record, type) {
  const MOCK_USER_ID = "00000000-0000-0000-0000-000000000000";
  const userId = currentUser ? currentUser.id : MOCK_USER_ID;
  const { error } = await supabase.from("expense_versions").insert({
    expense_id: record.id,
    change_type: type,
    amount: record.amount,
    currency: record.currency,
    expense_date: record.expense_date,
    claim_status: record.claim_status,
    note: record.note,
    identity_id: record.identity_id,
    identity_profile_id: record.identity_profile_id,
    customer_id: record.customer_id,
    user_id: userId, // Ensure userId is available globally or passed
    snapshot_data: record
  });
  if (error) console.error("Audit Log Failed:", error);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// init
await refreshSession();
if (currentUser) await loadExpenses();

// ... existing code ...
// Search Logic
const searchKeyword = el("searchKeyword");
const searchFriendId = el("searchFriendId");
const btnSearch = el("btnSearch");
const searchResultList = el("searchResultList");

async function updateSearchFriendDropdown() {
  if (!searchFriendId) return;
  const { data: friends } = await supabase.from("ref_friends").select("id, name");
  const currentVal = searchFriendId.value;
  searchFriendId.innerHTML = '<option value="">所有朋友</option>';
  (friends || []).forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    searchFriendId.appendChild(opt);
  });
  if (currentVal) searchFriendId.value = currentVal;
}

// Pagination UI Helper
function updatePaginationUI(type, page, totalCount) {
  const container = el(type === "history" ? "historyPagination" : "searchPagination");
  const label = el(type === "history" ? "historyPageLabel" : "searchPageLabel");
  const btnPrev = el(type === "history" ? "btnHistoryPrev" : "btnSearchPrev");
  const btnNext = el(type === "history" ? "btnHistoryNext" : "btnSearchNext");

  if (!container || !label || !btnPrev || !btnNext) return;

  // Only show pagination if there are items or we are not on page 1
  // Actually user requested persistent pagination or at least "next 10"
  // Let's hide if totalCount is 0? No, maybe show empty state in list.

  container.style.display = totalCount > 0 ? "flex" : "none";
  label.textContent = `第 ${page} 頁`;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  btnPrev.disabled = page <= 1;
  btnNext.disabled = page >= totalPages;

  // Bind click events (ensure no duplicate binding or remove/add listener)
  // Simple way: overwrite onclick handler (since it's simple MVP)
  btnPrev.onclick = () => changePage(type, -1);
  btnNext.onclick = () => changePage(type, 1);
}

function changePage(type, offset) {
  if (type === "history") {
    historyPage += offset;
    loadExpenses();
  } else {
    searchPage += offset;
    executeSearch();
  }
}

// Search Logic
async function executeSearch() {
  if (btnSearch) {
    btnSearch.disabled = true;
    btnSearch.textContent = "搜尋中...";
  }

  try {
    const keyword = searchKeyword.value.trim();
    const friendId = searchFriendId.value;

    let query = supabase
      .from("expenses")
      .select("id, amount, currency, expense_date, claim_status, note, created_at, identity_id, identity_profile_id, customer_id", { count: 'exact' })
      .is("deleted_at", null)
      .order("expense_date", { ascending: false });

    if (keyword) {
      query = query.ilike('note', `%${keyword}%`);
    }

    if (friendId) {
      query = query.eq('customer_id', friendId);
    }

    // Pagination
    const from = (searchPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    const { data: expenses, error, count } = await query;

    if (error) throw error;

    // Fetch Metadata
    const ids = expenses.map(x => x.id);
    const customerIds = [...new Set(expenses.map(x => x.customer_id).filter(Boolean))];

    // 1. Attachments
    let attachmentsByExpense = {};
    if (ids.length) {
      const { data: atts } = await supabase.from("expense_attachments").select("expense_id, object_path").in("expense_id", ids);
      (atts || []).forEach(a => {
        attachmentsByExpense[a.expense_id] ||= [];
        attachmentsByExpense[a.expense_id].push(a.object_path);
      });
    }

    // 2. Friends
    const friendMap = {};
    if (customerIds.length) {
      const { data: friends } = await supabase.from("ref_friends").select("id, name").in("id", customerIds);
      (friends || []).forEach(f => friendMap[f.id] = f.name);
    }

    // Render
    renderExpenseListUI(searchResultList, expenses, friendMap, attachmentsByExpense);
    updatePaginationUI("search", searchPage, count);

  } catch (e) {
    searchResultList.innerHTML = `<div class="hint">搜尋失敗: ${e.message}</div>`;
  } finally {
    if (btnSearch) {
      btnSearch.disabled = false;
      btnSearch.textContent = "搜尋";
    }
  }
}

if (btnSearch) {
  btnSearch.addEventListener("click", () => {
    searchPage = 1; // Reset to page 1 on new search
    executeSearch();
  });
}

// Initial populate of search dropdown
updateSearchFriendDropdown();

// Alert Modal Logic
const ALERT_MODAL = el("alertModal");
// Alert Modal Logic (Dynamic fetch to ensure robust init)
function bindAlertModal() {
  const btn = el("btnAlertOk");
  if (btn) {
    // Remove old listeners? Hard to do without ref, but overwriting onclick is safe for MVP
    btn.onclick = () => {
      const modal = el("alertModal");
      if (modal) modal.classList.remove("visible");
      if (_alertResolve) {
        _alertResolve(true);
        _alertResolve = null;
      }
    };
  }
}
bindAlertModal();

let _alertResolve = null;

function showAlert(title, message) {
  return new Promise((resolve) => {
    // Dynamic fetch to ensure element exists
    const modal = el("alertModal");

    if (el("alertTitle")) el("alertTitle").textContent = title;

    const msgEl = el("alertMessage");
    if (msgEl) {
      if (message) {
        msgEl.style.display = "block";
        msgEl.innerHTML = message.replace(/\n/g, "<br>");
      } else {
        msgEl.style.display = "none";
      }
    }

    _alertResolve = resolve;

    if (modal) {
      modal.classList.add("visible");
      // Re-bind button just in case
      bindAlertModal();
    } else {
      // Fallback if truly missing
      alert(`${title}\n${message}`);
      resolve(true);
    }
  });
}

// ... existing code ...

// --------------------------------------------------------------------------
// Reference Data Logic (Cascading Dropdowns)
// --------------------------------------------------------------------------

const selIdentity = el("identitySelect");
const selProfile = el("identityProfileSelect");
const selCustomer = el("customerSelect");

async function fetchIdentities() {
  const { data, error } = await supabase
    .from("ref_identities")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("fetchIdentities error", error);
    alert("讀取身份失敗：" + error.message);
    return;
  }

  if (!data || data.length === 0) {
    const opt = document.createElement("option");
    opt.text = "無資料 (請確認資料庫已建立)";
    selIdentity.add(opt);
  }

  populateSelect(selIdentity, data, "請選擇我的身份");
  // Clear dependents
  populateSelect(selProfile, [], "請選擇名片名稱");
  populateSelect(selCustomer, [], "請選擇朋友名稱");
  validateForm();
}

async function fetchNamecards(identityId) {
  if (!identityId) {
    populateSelect(selProfile, [], "請選擇名片名稱");
    populateSelect(selCustomer, [], "請選擇朋友名稱");
    return;
  }

  const { data, error } = await supabase
    .from("ref_namecards")
    .select("id, name")
    .eq("identity_id", identityId)
    .order("name");

  if (error) {
    console.error("fetchNamecards error", error);
    return;
  }
  populateSelect(selProfile, data, "請選擇名片名稱");
  populateSelect(selCustomer, [], "請選擇朋友名稱");
  validateForm();
}

async function fetchFriends(namecardId) {
  if (!namecardId) {
    populateSelect(selCustomer, [], "請選擇朋友名稱");
    return;
  }

  const { data, error } = await supabase
    .from("ref_friends")
    .select("id, name")
    .eq("namecard_id", namecardId)
    .order("name");

  if (error) {
    console.error("fetchFriends error", error);
    return;
  }
  populateSelect(selCustomer, data, "請選擇朋友名稱");
  validateForm();
}

function populateSelect(selectEl, items, placeholderText) {
  selectEl.innerHTML = "";

  // Placeholder option
  const optDefault = document.createElement("option");
  optDefault.value = "";
  optDefault.textContent = placeholderText || "請選擇";
  optDefault.disabled = true;
  optDefault.selected = true;
  selectEl.appendChild(optDefault);

  if (!items) return;

  items.forEach(item => {
    const opt = document.createElement("option");
    // We store the ID (UUID) as value, but the name is visual
    opt.value = item.id;
    opt.textContent = item.name;
    // Store name in dataset if we want to save name text to expenses
    opt.dataset.name = item.name;
    selectEl.appendChild(opt);
  });
}

// Event Listeners for Cascade
selIdentity.addEventListener("change", (e) => {
  fetchNamecards(e.target.value);
  validateForm();
});

selProfile.addEventListener("change", (e) => {
  fetchFriends(e.target.value);
  validateForm();
});

selCustomer.addEventListener("change", validateForm);

const inpAmount = el("amount");
const inpDate = el("expenseDate");
const btnCreate = el("btnCreateExpense");

if (inpAmount) inpAmount.addEventListener("input", validateForm);
if (inpDate) inpDate.addEventListener("change", validateForm);

function validateForm() {
  if (!btnCreate) return;

  const valid =
    selIdentity.value &&
    selProfile.value &&
    selCustomer.value &&
    Number(inpAmount.value) > 0 &&
    inpDate.value;

  btnCreate.disabled = !valid;
}

// Init Dropdowns
await fetchIdentities();
validateForm(); // logic check on load

// ... existing code ...
supabase.auth.onAuthStateChange(async () => {
  await refreshSession();
  if (currentUser) await loadExpenses();
});

// Shell UI Logic
const drawer = el("navDrawer");
const overlay = el("drawerOverlay");
const btnOpenDrawer = el("btnOpenDrawer");

function openDrawer() {
  if (drawer) drawer.classList.add("open");
  if (overlay) overlay.classList.add("visible");
}

function closeDrawer() {
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.classList.remove("visible");
}

if (btnOpenDrawer) btnOpenDrawer.addEventListener("click", openDrawer);
if (overlay) overlay.addEventListener("click", closeDrawer);

// View Switching (Segmented Control)
const viewSwitcher = el("viewSwitcher");
const segItems = document.querySelectorAll(".segmented-item");
const secCreate = el("expenseCard");
const secHistory = el("historyCard");
const secSearch = el("searchCard");

if (viewSwitcher) {
  segItems.forEach(item => {
    item.addEventListener("click", () => {
      // 1. UI Toggle
      segItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      // 2. Section Toggle
      const target = item.dataset.target;

      if (secCreate) secCreate.style.display = target === "create" ? "block" : "none";
      if (secHistory) secHistory.style.display = target === "history" ? "block" : "none";
      if (secSearch) secSearch.style.display = target === "search" ? "block" : "none";

      if (target === "history") {
        loadExpenses();
      }
    });
  });
}


// Drawer Navigation (Placeholders)
document.querySelectorAll(".drawer-item").forEach(item => {
  item.addEventListener("click", () => {
    const id = item.id;
    console.log("Navigating to:", id);
    closeDrawer();
    // Implement actual navigation or view switching here
    if (id === 'nav-logout') {
      el("btnSignOut")?.click();
    }
  });
});

// --------------------------------------------------------------------------
// Currency Logic
// --------------------------------------------------------------------------
const CURRENCY_LIST = [
  { code: "TWD", name: "新台幣 (TWD)" },
  { code: "USD", name: "美金 (USD)" },
  { code: "JPY", name: "日幣 (JPY)" },
  { code: "EUR", name: "歐元 (EUR)" },
  { code: "GBP", name: "英鎊 (GBP)" },
  { code: "CNY", name: "人民幣 (CNY)" },
  { code: "HKD", name: "港幣 (HKD)" },
  { code: "KRW", name: "韓元 (KRW)" },
  { code: "AUD", name: "澳幣 (AUD)" },
  { code: "CAD", name: "加幣 (CAD)" },
  { code: "SGD", name: "新加坡幣 (SGD)" },
  { code: "CHF", name: "瑞士法郎 (CHF)" },
  { code: "MYR", name: "馬來西亞林吉特 (MYR)" },
  { code: "THB", name: "泰銖 (THB)" },
  { code: "PHP", name: "菲律賓披索 (PHP)" },
  { code: "IDR", name: "印尼盾 (IDR)" },
  { code: "VND", name: "越南盾 (VND)" },
  { code: "INR", name: "印度盧比 (INR)" },
  { code: "NZD", name: "紐西蘭元 (NZD)" }
];

// Custom Modal Logic
let modal, modalTitle, modalMessage, btnModalConfirm, btnModalCancel;

function initModal() {
  if (modal) return true; // Already init
  modal = document.getElementById("confirmModal");
  if (!modal) {
    console.error("Modal element #confirmModal not found!");
    return false;
  }

  modalTitle = document.getElementById("modalTitle");
  modalMessage = document.getElementById("modalMessage");
  btnModalConfirm = document.getElementById("btnModalConfirm");
  btnModalCancel = document.getElementById("btnModalCancel");

  if (btnModalCancel) {
    btnModalCancel.addEventListener("click", closeConfirmModal);
  }

  if (btnModalConfirm) {
    btnModalConfirm.addEventListener("click", () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });
  }
  return true;
}

let confirmCallback = null;

function showConfirmModal(title, message, onConfirm) {
  if (!initModal()) {
    // Fallback
    if (confirm(message)) onConfirm();
    return;
  }

  if (modalTitle) modalTitle.textContent = title;
  if (modalMessage) modalMessage.textContent = message;
  confirmCallback = onConfirm;
  modal.classList.add("visible");
}

function closeConfirmModal() {
  if (modal) modal.classList.remove("visible");
  confirmCallback = null;
}

function populateCurrencies() {
  const sel = el("currency");
  if (!sel) return;
  sel.innerHTML = "";
  CURRENCY_LIST.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.name;
    if (c.code === "TWD") opt.selected = true;
    sel.appendChild(opt);
  });
}

populateCurrencies();


// Global state to track return view
let lastReturnTab = "history"; // default
// Global Function for HTML onclick
window.editExpense = async (id) => {
  // 1. Determine current view to return to
  const historyCard = el("historyCard");
  const searchCard = el("searchCard");

  if (searchCard && searchCard.style.display !== "none") {
    lastReturnTab = "search";
  } else {
    lastReturnTab = "history";
  }

  // 2. Find the expense data
  let item = null;
  // Try finding in button attribute first (efficient)
  const btn = document.querySelector(`button[data-edit-id="${id}"]`);
  if (btn && btn.dataset.json) {
    try {
      item = JSON.parse(btn.dataset.json);
    } catch (e) {
      console.error(e);
    }
  }

  // Fallback: fetch from DB if not found (async, but for now specific flow assumes list is loaded)
  if (!item) return;

  currentEditingId = item.id;
  lastExpenseId = item.id; // for attachment logic

  // Populate Form (Async for Cascading)
  el("identitySelect").value = item.identity_id || "";

  if (item.identity_id) {
    await fetchNamecards(item.identity_id);
    el("identityProfileSelect").value = item.identity_profile_id || "";
  }

  if (item.identity_profile_id) {
    await fetchFriends(item.identity_profile_id);
    el("customerSelect").value = item.customer_id || "";
  }

  el("expenseDate").value = item.expense_date;
  el("amount").value = item.amount;
  el("currency").value = item.currency;
  el("note").value = item.note || "";

  // Note: Attachments file input cannot be pre-filled securely. 
  // User must re-upload if they want to change image. 
  // Render existing attachments for deletion
  await renderEditAttachments(item.id);

  // Switch Tab
  const tabCreate = document.querySelector('.segmented-item[data-target="create"]');
  if (tabCreate) tabCreate.click();

  // Update Button Text
  const btnCreate = el("btnCreateExpense");
  btnCreate.textContent = "更新費用";
  btnCreate.disabled = false;
  // User requested to remove text: createStatus.textContent = `正在修改費用`;
  createStatus.textContent = "";

  // Disable Identity/Friend fields (Modification not allowed)
  selIdentity.disabled = true;
  selProfile.disabled = true;
  selCustomer.disabled = true;

  // Add "Cancel Edit" button if not exists
  let btnCancel = el("btnCancelEdit");
  if (!btnCancel) {
    btnCancel = document.createElement("button");
    btnCancel.id = "btnCancelEdit";
    btnCancel.textContent = "取消修改";
    // Match format: btn-large-action (base) + btn-secondary (modifier)
    btnCancel.className = "btn-large-action btn-secondary";
    btnCancel.style.marginTop = "12px";
    btnCancel.style.width = "100%"; // Full width like main button
    btnCancel.addEventListener("click", resetForm);
    // Insert after create button container
    const row = btnCreate.parentNode;
    // Ensure we append cleanly
    row.parentNode.insertBefore(btnCancel, row.nextSibling);
  }
}

function resetForm() {
  currentEditingId = null;
  lastExpenseId = null; // Clear last expense ID
  el("amount").value = "";
  el("note").value = "";
  el("receiptFile").value = "";
  if (el("editAttachmentsList")) el("editAttachmentsList").innerHTML = "";

  // Re-enable fields
  selIdentity.disabled = false;
  selProfile.disabled = false;
  selCustomer.disabled = false;

  const btn = el("btnCreateExpense");
  btn.textContent = "建立費用";
  createStatus.textContent = "";

  const btnCancel = el("btnCancelEdit");
  if (btnCancel) btnCancel.remove();

  validateForm();

  // Return to previous tab if this was a cancellation
  // (We check if we are currently in 'create' view to avoid jumping if called from elsewhere)
  const tabReturn = document.querySelector(`.segmented-item[data-target="${lastReturnTab}"]`);
  if (tabReturn) tabReturn.click();
}

// --------------------------------------------------------------------------
// Image Viewer Logic

// Attachment Management in Edit Mode
async function renderEditAttachments(expenseId) {
  const container = el("editAttachmentsList");
  if (!container) return;
  container.innerHTML = ""; // Clear current

  const { data, error } = await supabase
    .from("expense_attachments")
    .select("*")
    .eq("expense_id", expenseId);

  if (error) {
    console.error("Error fetching attachments:", error);
    return;
  }

  if (!data || data.length === 0) return;

  // Fetch signed URLs for all items
  const itemsWithUrls = await Promise.all(data.map(async (att) => {
    const { data: signData } = await supabase.storage
      .from("receipts")
      .createSignedUrl(att.object_path, 3600); // 1 hour validity
    return {
      ...att,
      signedUrl: signData ? signData.signedUrl : null
    };
  }));

  itemsWithUrls.forEach(att => {
    const item = document.createElement("div");
    item.className = "attachment-item-edit";

    // Convert size
    const sizeKB = Math.round(att.size / 1024);

    // Thumbnail or Placeholder
    const imgHtml = att.signedUrl
      ? `<img src="${att.signedUrl}" class="attachment-thumb" alt="${att.file_name}">`
      : `<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:10px;">No Image</div>`;

    item.innerHTML = `
      ${imgHtml}
      <div class="attachment-details" title="${att.file_name}">
        <div style="color:#111827; font-weight:500;">${att.file_name}</div>
        <div>${sizeKB} KB</div>
      </div>
      <button class="btn-delete-attachment" type="button" title="刪除">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    // Bind Delete Event
    const btnDel = item.querySelector(".btn-delete-attachment");
    btnDel.addEventListener("click", () => deleteAttachment(att.id, att.object_path, expenseId));

    container.appendChild(item);
  });
}

async function deleteAttachment(attachmentId, objectPath, expenseId) {
  showConfirmModal(appText.receipt.delete_confirm_title, "", async () => {
    showLoader();
    try {
      // 1. Delete from Storage
      const { error: storageErr } = await supabase.storage
        .from("receipts")
        .remove([objectPath]);

      if (storageErr) throw storageErr;

      // 2. Delete from DB
      const { error: dbErr } = await supabase
        .from("expense_attachments")
        .delete()
        .eq("id", attachmentId);

      if (dbErr) throw dbErr;

      // 3. Refresh List
      await renderEditAttachments(expenseId);

      // 4. Update Main List Cache (optional, but good practice)
      clearExpenseCache();
      await loadExpenses();

      showAlert(appText.receipt.delete_success_title, "");
      resetForm(); // Return to previous list

    } catch (e) {
      console.error(e);
      showAlert("錯誤", "刪除附件失敗: " + e.message);
    } finally {
      hideLoader();
    }
  });
}

// --------------------------------------------------------------------------
let viewerState = {
  images: [], // Array of object_paths
  currentIndex: 0,
  signedUrls: {}, // Cache signed URLs
  zoomLevel: 1
};

const viewerModal = el("imageViewerModal");
const viewerImg = el("viewerImage");
const btnViewerClose = el("btnViewerClose");
const btnViewerPrev = el("btnViewerPrev");
const btnViewerNext = el("btnViewerNext");
const viewerCounter = el("viewerCounter");

// Close
if (btnViewerClose) btnViewerClose.onclick = closeViewer;

// Nav
if (btnViewerPrev) btnViewerPrev.onclick = (e) => {
  e.stopPropagation();
  changeViewerImage(-1);
};
if (btnViewerNext) btnViewerNext.onclick = (e) => {
  e.stopPropagation();
  changeViewerImage(1);
};

// Zoom
if (viewerImg) {
  viewerImg.onclick = (e) => {
    e.stopPropagation();
    toggleZoom();
  };
}

// Global Function for HTML onclick
window.viewReceipts = async (expenseId) => {
  try {
    const { data: atts } = await supabase.from("expense_attachments").select("object_path").eq("expense_id", expenseId);

    if (!atts || atts.length === 0) {
      showAlert("通知", "此費用沒有收據影像");
      return;
    }

    const paths = atts.map(a => a.object_path);
    openViewer(paths, 0);

  } catch (e) {
    console.error(e);
    showAlert("錯誤", "無法讀取收據：" + e.message);
  }
};

async function openViewer(paths, index) {
  viewerState.images = paths;
  viewerState.currentIndex = index;
  viewerState.zoomLevel = 1;
  viewerState.signedUrls = {}; // clear cache

  updateViewerUI();
  if (viewerModal) {
    viewerModal.classList.add("visible");
    viewerModal.style.display = "flex"; // Ensure layout
  }
}

function closeViewer() {
  if (viewerModal) {
    viewerModal.classList.remove("visible");
    setTimeout(() => { if (!viewerModal.classList.contains("visible")) viewerModal.style.display = 'none'; }, 200);
  }
}

async function updateViewerUI() {
  if (!viewerImg) return;

  // Reset Zoom
  viewerState.zoomLevel = 1;
  viewerImg.classList.remove("zoomed");
  viewerImg.style.transform = "";

  const path = viewerState.images[viewerState.currentIndex];

  // Update Counter
  if (viewerCounter) viewerCounter.textContent = `${viewerState.currentIndex + 1} / ${viewerState.images.length}`;

  // Update Nav Buttons
  if (btnViewerPrev) btnViewerPrev.disabled = viewerState.currentIndex === 0;
  if (btnViewerNext) btnViewerNext.disabled = viewerState.currentIndex === viewerState.images.length - 1;

  // Load Image (Get Signed URL)
  // Load Image (Get Signed URL)
  const loader = el("viewerLoader");
  if (loader) loader.style.display = "block";
  viewerImg.style.opacity = 0;

  let url = viewerState.signedUrls[path];

  if (!url) {
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
    if (error) {
      console.error(error);
      return;
    }
    url = data.signedUrl;
    viewerState.signedUrls[path] = url;
  }

  viewerImg.src = url;
  viewerImg.onload = () => {
    // User requested 1.5s delay to see the animation
    setTimeout(() => {
      viewerImg.style.opacity = 1;
      if (loader) loader.style.display = "none";
    }, 1500);
  };
}

function changeViewerImage(offset) {
  const newIndex = viewerState.currentIndex + offset;
  if (newIndex >= 0 && newIndex < viewerState.images.length) {
    viewerState.currentIndex = newIndex;
    updateViewerUI();
  }
}

function toggleZoom() {
  if (viewerState.zoomLevel === 1) {
    viewerState.zoomLevel = 2; // Zoom In
    viewerImg.classList.add("zoomed");
  } else {
    viewerState.zoomLevel = 1; // Zoom Out
    viewerImg.classList.remove("zoomed");
  }
}


