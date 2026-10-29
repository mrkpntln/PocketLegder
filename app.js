/* PocketLedger — offline-first PWA.
   Supabase project configured for auth and cloud sync. Public publishable key only; private keys must never be shipped to this app.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://evzzmwjfedlmehdkgtng.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_8GEj9g2tFy8qMZq_vx4jwQ_dD228GDX"; // Public publishable key; RLS protects user data.
  const DB_NAME = "pocketledger-db";
  const DB_VERSION = 1;
  const STORE = "transactions";
  const META_KEY = "pocketledger-meta-v1";
  const BUILTIN = {
    income: [
      {name:"Salary", icon:"S"}, {name:"Business", icon:"B"}, {name:"Side hustle", icon:"↗"},
      {name:"Allowance", icon:"A"}, {name:"Investment", icon:"↗"}, {name:"Gift", icon:"G"}, {name:"Other income", icon:"＋"}
    ],
    expense: [
      {name:"Food", icon:"F"}, {name:"Bills", icon:"B"}, {name:"Transportation", icon:"T"},
      {name:"Groceries", icon:"G"}, {name:"Shopping", icon:"S"}, {name:"Health", icon:"✚"},
      {name:"Home", icon:"H"}, {name:"Education", icon:"E"}, {name:"Savings", icon:"$"},
      {name:"Entertainment", icon:"P"}, {name:"Other expense", icon:"•"}
    ]
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    transactions: [], customCategories: {income: [], expense: []}, planItems: [], currentType: "expense",
    amountText: "0", expression: "", replaceOnDigit: false, selectedMonth: monthKey(new Date()), planMonth: monthKey(new Date()),
    planTab: "overview", debtFilter: "owe", billFilter: "all", billSearch: "", billMonth: monthKey(new Date()), authMode: "login", supabase: null, user: null, syncing: false
  };

  function uid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function todayKey() { return dateKey(new Date()); }
  function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  function money(n) { return new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0); }
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function allCategories(type) { return [...BUILTIN[type], ...state.customCategories[type]]; }
  function categoryIcon(type, name) { return allCategories(type).find(c => c.name === name)?.icon || (type === "income" ? "＋" : "•"); }
  function getTx(id) { return state.transactions.find(t => t.id === id); }

  let dbPromise;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:"id"});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function localGetAll() {
    const db = await openDb();
    return new Promise((resolve,reject) => {
      const req = db.transaction(STORE,"readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function localPut(tx) {
    const db = await openDb();
    return new Promise((resolve,reject) => {
      const req = db.transaction(STORE,"readwrite").objectStore(STORE).put(tx);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  async function localDelete(id) {
    const db = await openDb();
    return new Promise((resolve,reject) => {
      const req = db.transaction(STORE,"readwrite").objectStore(STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch { return {}; }
  }
  function saveMeta(patch) { localStorage.setItem(META_KEY, JSON.stringify({...readMeta(), ...patch})); if(patch.customCategories&&state.user&&state.supabase&&navigator.onLine&&!state.syncing) state.supabase.from("user_settings").upsert({user_id:state.user.id,data:{customCategories:patch.customCategories},updated_at:new Date().toISOString()},{onConflict:"user_id"}).then(({error})=>{if(error)console.warn("Settings sync failed",error.message);}); }
  function setToast(message) {
    const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(setToast.timer); setToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function setView(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `${view}View`));
    document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("selected", b.dataset.view === view));
    window.scrollTo({top:0, behavior:"smooth"});
    if (view === "logs") renderLogs();
    if (view === "reports") renderReports();
    if (view === "plan") renderPlan();
  }
  function openTransactionForm(type = "expense", tx = null) {
    state.currentType = type;
    state.amountText = tx ? String(Number(tx.amount)) : "0";
    state.expression = ""; state.replaceOnDigit = false;
    $("transactionId").value = tx?.id || "";
    $("transactionNote").value = tx?.note || "";
    $("transactionDate").value = tx?.date || todayKey();
    $("formTitle").textContent = tx ? "Edit transaction" : `Add ${type}`;
    $("formEyebrow").textContent = tx ? "UPDATE RECORD" : "NEW TRANSACTION";
    $("formError").textContent = "";
    setFormType(type);
    renderAmount();
    $("transactionModal").classList.remove("hidden");
  }
  function closeTransactionForm() { $("transactionModal").classList.add("hidden"); }
  function setFormType(type) {
    state.currentType = type;
    const sheet = document.querySelector("#transactionModal .modal-sheet");
    sheet.classList.toggle("expense-mode", type === "expense");
    sheet.classList.toggle("income-mode", type === "income");
    document.querySelectorAll("[data-form-type]").forEach(b => b.classList.toggle("selected", b.dataset.formType === type));
    $("formTitle").textContent = $("transactionId").value ? "Edit transaction" : `Add ${type}`;
    const select = $("transactionCategory"), current = select.value;
    select.innerHTML = allCategories(type).map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
    const tx = getTx($("transactionId").value);
    if (tx && tx.type === type) select.value = tx.category;
    else if (allCategories(type).some(c => c.name === current)) select.value = current;
  }
  function renderAmount() {
    $("amountDisplay").textContent = Number(state.amountText || 0).toLocaleString("en-PH",{maximumFractionDigits:8});
    $("amountValue").value = state.amountText || "0";
  }
  function calculateExpression(a, operator, b) {
    switch (operator) {
      case "+": return a + b;
      case "−": return a - b;
      case "×": return a * b;
      case "÷": return b === 0 ? NaN : a / b;
      default: return b;
    }
  }
  function calcKey(key) {
    if (/^\d$/.test(key)) {
      if (state.replaceOnDigit || state.amountText === "0") state.amountText = key;
      else if (state.amountText.length < 15) state.amountText += key;
      state.replaceOnDigit = false;
    } else if (key === ".") {
      if (state.replaceOnDigit) { state.amountText = "0."; state.replaceOnDigit = false; }
      else if (!state.amountText.includes(".")) state.amountText += ".";
    } else if (key === "clear") {
      state.amountText = "0"; state.expression = ""; state.replaceOnDigit = false;
    } else if (key === "sign") {
      const value = Number(state.amountText || 0);
      state.amountText = String(value === 0 ? 0 : -value);
      state.replaceOnDigit = false;
    } else if (key === "percent") {
      state.amountText = String(Number(state.amountText || 0) / 100);
      state.replaceOnDigit = true;
    } else if (["+","−","×","÷"].includes(key)) {
      if (state.expression) {
        const match = state.expression.match(/^(-?\d*\.?\d+)\s([+−×÷])\s$/);
        if (match) {
          const result = calculateExpression(Number(match[1]), match[2], Number(state.amountText));
          if (Number.isFinite(result)) state.amountText = String(Number(result.toFixed(8)));
          else { setToast("Cannot divide by zero."); renderAmount(); return; }
        }
      }
      state.expression = `${state.amountText} ${key} `;
      state.replaceOnDigit = true;
    } else if (key === "equals") {
      if (state.expression) {
        const match = state.expression.match(/^(-?\d*\.?\d+)\s([+−×÷])\s$/);
        if (match) {
          const result = calculateExpression(Number(match[1]), match[2], Number(state.amountText));
          if (Number.isFinite(result)) state.amountText = String(Number(result.toFixed(8)));
          else { setToast("Cannot divide by zero."); renderAmount(); return; }
        }
        state.expression = "";
        state.replaceOnDigit = true;
      }
    }
    renderAmount();
  }
  async function saveTransaction(event) {
    event.preventDefault();
    const amount = Number(state.amountText);
    if (!Number.isFinite(amount) || amount <= 0) { $("formError").textContent = "Please enter an amount greater than zero."; return; }
    if (amount > 999999999999) { $("formError").textContent = "That amount is too large."; return; }
    const id = $("transactionId").value || uid();
    const previous = getTx(id);
    const tx = {
      id, type: state.currentType, amount: Number(amount.toFixed(2)),
      category: $("transactionCategory").value, date: $("transactionDate").value,
      note: $("transactionNote").value.trim(), updated_at: new Date().toISOString(),
      created_at: previous?.created_at || new Date().toISOString(),
      user_id: state.user?.id || null, sync_status: state.user ? "pending" : "local"
    };
    if (!tx.date) { $("formError").textContent = "Please choose a date."; return; }
    await localPut(tx);
    const i = state.transactions.findIndex(t => t.id === id);
    if (i >= 0) state.transactions[i] = tx; else state.transactions.push(tx);
    closeTransactionForm(); renderAll(); setToast(previous ? "Transaction updated." : "Transaction saved on this device.");
    if (state.user && navigator.onLine) syncNow();
  }
  async function deleteTransaction(id) {
    const tx = getTx(id); if (!tx) return;
    if (!confirm(`Delete ${tx.type} of ${money(tx.amount)}? This cannot be undone.`)) return;
    markSyncDeleted("ledger_transactions",id);
    await localDelete(id); state.transactions = state.transactions.filter(t => t.id !== id);
    renderAll(); setToast("Transaction deleted.");
    if (state.user && navigator.onLine) syncNow();
  }
  function transactionHtml(tx, tools = false) {
    const typeClass = tx.type === "income" ? "income" : "expense";
    const sign = tx.type === "income" ? "+" : "−";
    const label = tx.note || tx.category;
    const date = new Date(`${tx.date}T12:00:00`).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
    return `<article class="transaction-item">
      <div class="transaction-icon ${typeClass}">${escapeHtml(categoryIcon(tx.type,tx.category))}</div>
      <div class="transaction-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(tx.category)} · ${escapeHtml(date)}</small></div>
      <div class="transaction-amount ${typeClass}">${sign}${money(tx.amount)}</div>
      ${tools ? `<div class="transaction-tools"><button class="tiny-button" data-edit-tx="${escapeHtml(tx.id)}" aria-label="Edit transaction">✎</button><button class="tiny-button" data-delete-tx="${escapeHtml(tx.id)}" aria-label="Delete transaction">×</button></div>` : ""}
    </article>`;
  }
  function sum(list,type) { return list.filter(t => !type || t.type === type).reduce((a,t) => a + Number(t.amount),0); }
  function renderDashboard() {
    const totalIncome=sum(state.transactions,"income"), totalExpense=sum(state.transactions,"expense");
    const debtAdjustment=state.planItems.filter(i=>i.kind==="debt").reduce((net,i)=>{
      const mode=String(i.details||"owe").toLowerCase();
      if(mode==="collect") return net+(i.done?Number(i.amount||0):0);
      return net-Number(i.amount||0);
    },0);
    $("balanceAmount").textContent=money(totalIncome-totalExpense+debtAdjustment); $("incomeTotal").textContent=money(totalIncome); $("expenseTotal").textContent=money(totalExpense);
    $("monthPicker").value=state.selectedMonth;
    const monthTx=state.transactions.filter(t=>t.date?.startsWith(state.selectedMonth));
    const mi=sum(monthTx,"income"), me=sum(monthTx,"expense"), max=Math.max(mi,me,1);
    $("monthIncome").textContent=money(mi); $("monthExpense").textContent=money(me); $("monthNet").textContent=money(mi-me);
    $("incomeTrack").style.width=`${mi/max*100}%`; $("expenseTrack").style.width=`${me/max*100}%`;
    const recent=[...state.transactions].sort((a,b)=>(b.date||"").localeCompare(a.date||"") || (b.updated_at||"").localeCompare(a.updated_at||"")).slice(0,5);
    $("recentTransactions").classList.toggle("empty-state",recent.length===0);
    $("recentTransactions").innerHTML=recent.length?recent.map(t=>transactionHtml(t)).join(""):"Your transactions will appear here.";
  }
  function renderLogs() {
    const q=$("searchInput").value.trim().toLowerCase(), type=$("typeFilter").value, cat=$("categoryFilter").value;
    const from=$("fromDate").value, to=$("toDate").value;
    const list=[...state.transactions].filter(t=>(type==="all"||t.type===type)&&(cat==="all"||t.category===cat)&&(!from||t.date>=from)&&(!to||t.date<=to)&&(!q||`${t.note} ${t.category} ${t.type}`.toLowerCase().includes(q))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.updated_at||"").localeCompare(a.updated_at||""));
    $("logsSummary").textContent=`${list.length} transaction${list.length===1?"":"s"} · Net ${money(sum(list,"income")-sum(list,"expense"))}`;
    $("allTransactions").classList.toggle("empty-state",list.length===0);
    $("allTransactions").innerHTML=list.length?list.map(t=>transactionHtml(t,false)).join(""):"No transactions match your filters.";
  }
  function renderReports() {
    const month=$("reportMonth").value||state.selectedMonth, list=state.transactions.filter(t=>t.date?.startsWith(month));
    const inc=sum(list,"income"), exp=sum(list,"expense");
    $("reportIncome").textContent=money(inc); $("reportExpense").textContent=money(exp);
    const breakdown=(type,target)=>{
      const grouped={}; list.filter(t=>t.type===type).forEach(t=>grouped[t.category]=(grouped[t.category]||0)+Number(t.amount));
      const entries=Object.entries(grouped).sort((a,b)=>b[1]-a[1]), total=entries.reduce((a,e)=>a+e[1],0);
      $(target).classList.toggle("empty-state",entries.length===0);
      $(target).innerHTML=entries.length?entries.map(([name,value])=>`<div class="breakdown-row ${type==="expense"?"expense-breakdown":""}"><div class="breakdown-label"><span>${escapeHtml(categoryIcon(type,name))} ${escapeHtml(name)}</span><strong>${money(value)} · ${total?Math.round(value/total*100):0}%</strong></div><div class="breakdown-track"><i style="width:${total?value/total*100:0}%"></i></div></div>`).join(""):"No data for this month yet.";
    };
    breakdown("expense","expenseBreakdown"); breakdown("income","incomeBreakdown");
  }
  function savePlanItems() { saveMeta({planItems:state.planItems}); if(state.user&&navigator.onLine&&!state.syncing) syncNow(); }
  function setPlanTab(tab) {
    state.planTab=tab;
    document.querySelectorAll("[data-plan-tab]").forEach(b=>b.classList.toggle("selected",b.dataset.planTab===tab));
    document.querySelectorAll(".plan-panel").forEach(p=>p.classList.toggle("hidden",p.id!==({overview:"overviewPanel",calendar:"calendarPanel",bills:"billsPanel",debts:"debtsPanel"}[tab])));
    renderPlan();
  }
  function changePlanMonth(delta) {
    const [y,m]=state.planMonth.split("-").map(Number);const d=new Date(y,m-1+delta,1);state.planMonth=monthKey(d);renderPlan();
  }
  function addPlanItem(kind) { openPlanForm(kind); }
  function addBillItem() { openPlanForm("bill"); }
  function openPlanForm(kind="activity", item=null, selectedDate="") {
    $("planForm").reset();
    $("planFormId").value=item?.id||"";
    $("planFormKind").value=kind;
    $("planFormTitle").textContent=item?"Edit details":({activity:"Add activity",bill:"Add bill",debt:"Add utang"}[kind]||"Add item");
    $("planTitleInput").value=item?.title||"";
    $("planDateInput").value=item?.date||selectedDate||todayKey();
    $("planAmountInput").value=String(item?.amount??0);
    $("planDetailsInput").value=item?.details||"";
    $("planCategoryInput").value=item?.billCategory||"Utilities";
    $("planRecurrenceInput").value=item?.recurrence||"monthly";
    $("planDebtInput").value=(item?.details||"owe").toLowerCase()==="collect"?"collect":"owe";
    $("planReminderInput").value=String(item?.reminderDays??3);
    $("planCategoryWrap").classList.toggle("hidden",kind!=="bill");
    $("planRecurrenceWrap").classList.toggle("hidden",kind!=="bill");
    $("planReminderWrap").classList.toggle("hidden",kind!=="bill");
    $("planDebtWrap").classList.toggle("hidden",kind!=="debt");
    $("planAmountInput").closest("label").classList.toggle("hidden",kind==="activity");
    $("planFormModal").classList.remove("hidden");
  }
  function closePlanForm(){$("planFormModal").classList.add("hidden");}
  function submitPlanForm(event){
    event.preventDefault();
    const id=$("planFormId").value,kind=$("planFormKind").value,title=$("planTitleInput").value.trim(),date=$("planDateInput").value,amount=Number($("planAmountInput").value||0);
    if(!title||!date||!Number.isFinite(amount)||amount<0||(kind!=="activity"&&amount<=0)){setToast("Check the required fields.");return;}
    const details=kind==="debt"?$("planDebtInput").value:$("planDetailsInput").value.trim();
    const fields={kind,title,date,amount,details};
    if(kind==="bill"){fields.billCategory=$("planCategoryInput").value;fields.recurrence=$("planRecurrenceInput").value;fields.reminderDays=Number($("planReminderInput").value||0);}
    if(id){const item=state.planItems.find(x=>x.id===id);if(item){Object.assign(item,fields);savePlanItems();renderAll();renderNotifications();setToast("Updated.");}}
    else savePlanItem({...fields,...(kind==="bill"?{paidAmount:0,payments:[],receiptName:"",receiptData:""}:{})});
    closePlanForm();
  }
  function billRemaining(item){return Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0));}
  function billIsPaid(item){return item.kind==="bill" ? billRemaining(item)<0.005 : !!item.done;}
  function billStatus(item){if(billIsPaid(item))return "Paid";return item.date<todayKey()?"Overdue":"Unpaid";}
  function billStatusClass(item){return billStatus(item).toLowerCase().replace(/\s/g,"-");}
  function nextRecurringDate(date, recurrence){const base=new Date(date+"T12:00:00");if(recurrence==="weekly")base.setDate(base.getDate()+7);else if(recurrence==="monthly"||recurrence==="quarterly"){const day=base.getDate();base.setDate(1);base.setMonth(base.getMonth()+(recurrence==="monthly"?1:3));const lastDay=new Date(base.getFullYear(),base.getMonth()+1,0).getDate();base.setDate(Math.min(day,lastDay));}else if(recurrence==="yearly"){const month=base.getMonth(),day=base.getDate();base.setDate(1);base.setFullYear(base.getFullYear()+1);base.setMonth(month);base.setDate(Math.min(day,new Date(base.getFullYear(),month+1,0).getDate()));}while(dateKey(base)<=todayKey()&&recurrence!=="none"){if(recurrence==="weekly")base.setDate(base.getDate()+7);else if(recurrence==="monthly"||recurrence==="quarterly"){const day=base.getDate();base.setDate(1);base.setMonth(base.getMonth()+(recurrence==="monthly"?1:3));base.setDate(Math.min(day,new Date(base.getFullYear(),base.getMonth()+1,0).getDate()));}else if(recurrence==="yearly")base.setFullYear(base.getFullYear()+1);else break;}return dateKey(base);}
  async function recordBillPayment(item, amount, method, reference) {
    const payment={id:uid(),amount:Number(amount),date:todayKey(),method:method||"Other",reference:reference||"",created_at:new Date().toISOString()};
    item.payments=Array.isArray(item.payments)?item.payments:[];item.payments.push(payment);item.paidAmount=Number(item.paidAmount||0)+payment.amount;item.done=billRemaining(item)<0.005;
    const tx={id:uid(),type:"expense",amount:payment.amount,category:"Bills",note:`${item.title} payment${payment.reference?" · Ref "+payment.reference:""}`,date:payment.date,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),user_id:state.user?.id||null,sync_status:state.user?"pending":"local",bill_id:item.id,bill_payment_id:payment.id};
    await localPut(tx);state.transactions.push(tx);savePlanItems();
    if(item.done&&item.recurrence&&item.recurrence!=="none"&&!item.nextGenerated){const next={...item,id:uid(),date:nextRecurringDate(item.date,item.recurrence),paidAmount:0,payments:[],done:false,nextGenerated:false,created_at:new Date().toISOString(),receiptName:"",receiptData:"",sourceBillId:item.id};item.nextGenerated=true;state.planItems.push(next);}
    savePlanItems();renderAll();if(state.user&&navigator.onLine)syncNow();setToast(item.done?"Bill paid and expense recorded.":"Partial payment recorded.");
  }
  async function payBill(id){
    const item=state.planItems.find(x=>x.id===id&&x.kind==="bill");if(!item)return;
    const remaining=billRemaining(item);if(remaining<=0){setToast("This bill is already paid.");return;}
    const actions=$("planDetailActions");
    actions.innerHTML=`<form id="billPaymentForm" class="inline-payment-form"><label class="field-label">Amount<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" value="${remaining.toFixed(2)}" required></label><label class="field-label">Payment method<select name="method"><option>GCash</option><option>Cash</option><option>Bank</option><option>Card</option><option>Other</option></select></label><label class="field-label">Reference number<input name="reference" maxlength="100"></label><button class="primary-button full-width" type="submit">Record payment</button><button class="secondary-button full-width" type="button" data-cancel-payment="${escapeHtml(id)}">Cancel</button></form>`;
    const form=$("billPaymentForm");form.addEventListener("submit",async e=>{e.preventDefault();const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;const fd=new FormData(form),amount=Number(fd.get("amount"));if(!Number.isFinite(amount)||amount<=0||amount>billRemaining(item)+0.005){submit.disabled=false;setToast("Enter a valid payment amount.");return;}await recordBillPayment(item,amount,String(fd.get("method")),String(fd.get("reference")||""));showPlanDetail(id);});
  }
  function showBillHistory(id){const item=state.planItems.find(x=>x.id===id&&x.kind==="bill");if(!item)return;showPlanDetail(id);const history=$("planDetailContent").querySelector(".payment-history");if(history)history.scrollIntoView({behavior:"smooth",block:"center"});}
  function editBill(id){const item=state.planItems.find(x=>x.id===id&&x.kind==="bill");if(!item)return;$("planDetailModal").classList.add("hidden");openPlanForm("bill",item);}
  function attachBillReceipt(id){const item=state.planItems.find(x=>x.id===id&&x.kind==="bill");if(!item)return;const input=document.createElement("input");input.type="file";input.accept="image/*,.pdf,application/pdf";input.onchange=()=>{const file=input.files?.[0];if(!file)return;if(file.size>500*1024){setToast("For reliable local backup storage, receipt files must be 500 KB or smaller.");return;}const reader=new FileReader();reader.onload=()=>{item.receiptName=file.name;item.receiptData=String(reader.result||"");savePlanItems();renderPlan();setToast("Receipt attached.");};reader.readAsDataURL(file);};input.click();}
  function openBillReceipt(id){const item=state.planItems.find(x=>x.id===id);if(!item?.receiptData)return;const win=window.open();if(!win){setToast("Allow pop-ups to view the receipt.");return;}if(item.receiptData.startsWith("data:application/pdf")){win.document.write(`<title>${escapeHtml(item.receiptName||"Receipt")}</title><iframe src="${item.receiptData}" style="border:0;width:100%;height:100vh"></iframe>`);}else{win.document.write(`<title>${escapeHtml(item.receiptName||"Receipt")}</title><img src="${item.receiptData}" style="max-width:100%;height:auto">`);}}
  function savePlanItem(item) {
    state.planItems.push({id:uid(),done:false,created_at:new Date().toISOString(),...item});savePlanItems();renderAll();checkDueNotifications();setToast("Added to your plan.");
  }
  function togglePlanComplete(id) {
    const item=state.planItems.find(x=>x.id===id);if(!item||item.done)return;item.done=true;savePlanItems();renderAll();renderNotifications();setToast("Marked as done.");
  }
  function deletePlanItem(id) {
    const item=state.planItems.find(x=>x.id===id);if(!item||!confirm(`Delete “${item.title}”?`))return;
    markSyncDeleted("plan_items",id);
    state.planItems=state.planItems.filter(x=>x.id!==id);savePlanItems();renderAll();$("planDetailModal")?.classList.add("hidden");setToast("Plan item deleted.");
  }
  function planItemHtml(item) {
    const typeLabel={activity:"Activity",bill:item.billCategory||"Bill",debt:(item.details||"owe").toLowerCase()==="collect"?"To collect":"Utang"}[item.kind]||"Plan";
    const due=item.date===todayKey()?"Today":item.date<todayKey()?"Overdue":new Date(item.date+"T12:00:00").toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
    const status=item.kind==="bill"?billStatus(item):(item.done?"Done":(item.date<todayKey()?"Overdue":"Upcoming"));
    const amount=item.kind==="activity"?"":`<strong class="plan-amount">${money(item.kind==="bill"?billRemaining(item):item.amount||0)}</strong>`;
    return `<button type="button" class="plan-item plan-item-clickable ${item.kind==="bill"?`bill-card ${status.toLowerCase()} ${status==="Paid"?"is-done":""}`:""} ${item.done?"is-done":""}" data-open-plan="${escapeHtml(item.id)}"><span class="plan-item-marker ${item.kind}"></span><span class="plan-item-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(typeLabel)} · ${escapeHtml(due)}${item.kind==="bill"?` · ${status}`:""}${item.kind==="bill"&&item.recurrence&&item.recurrence!=="none"?` · ${escapeHtml(item.recurrence)}`:""}</small>${item.kind==="bill"?`<span class="bill-progress"><i style="width:${Math.min(100,Number(item.amount)?Number(item.paidAmount||0)/Number(item.amount)*100:0)}%"></i></span>`:""}${item.details&&item.kind!=="debt"?`<small>${escapeHtml(item.details)}</small>`:""}</span>${amount}<span class="plan-chevron" aria-hidden="true">›</span></button>`;
  }
  function showPlanDetail(id){
    const item=state.planItems.find(x=>x.id===id);if(!item)return;
    const kindLabel={activity:"Activity",bill:item.billCategory||"Bill",debt:(item.details||"owe").toLowerCase()==="collect"?"To collect":"Utang"}[item.kind]||"Plan";
    const due=new Date(item.date+"T12:00:00").toLocaleDateString("en-PH",{weekday:"short",month:"long",day:"numeric",year:"numeric"});
    $("planDetailTitle").textContent=item.title;
    $("planDetailContent").innerHTML=`<div class="detail-summary"><span>${escapeHtml(kindLabel)}</span><strong>${escapeHtml(due)}</strong>${item.kind!=="activity"?`<strong>${money(item.kind==="bill"?billRemaining(item):item.amount||0)}${item.kind==="bill"?" remaining":""}</strong>`:""}${item.details&&item.kind!=="debt"?`<p>${escapeHtml(item.details)}</p>`:""}${item.kind==="bill"?`<div class="bill-progress"><i style="width:${Math.min(100,Number(item.amount)?Number(item.paidAmount||0)/Number(item.amount)*100:0)}%"></i></div><p>Paid ${money(item.paidAmount||0)} of ${money(item.amount)}</p><div class="payment-history">${(item.payments||[]).map(p=>`<div><span>${escapeHtml(p.date)} · ${escapeHtml(p.method||"Other")}</span><strong>${money(p.amount)}</strong></div>`).join("")||""}</div>${item.receiptData?`<button class="secondary-button full-width" data-open-receipt="${escapeHtml(item.id)}">View receipt</button>`:""}`:""}</div>`;
    const actions=[];
    if(item.kind==="bill"){if(billRemaining(item)>0)actions.push(`<button class="primary-button full-width" data-pay-bill="${escapeHtml(item.id)}">Record payment</button>`);actions.push(`<button class="secondary-button full-width" data-bill-history="${escapeHtml(item.id)}">Payment history</button>`,`<button class="secondary-button full-width" data-edit-bill="${escapeHtml(item.id)}">Edit</button>`,`<button class="secondary-button full-width" data-attach-receipt="${escapeHtml(item.id)}">${item.receiptData?"Replace receipt":"Attach receipt"}</button>`);}
    else {if(!item.done)actions.push(`<button class="primary-button full-width" data-complete-plan="${escapeHtml(item.id)}">Mark as done</button>`);if(item.kind==="debt"&&!item.done)actions.push(`<button class="secondary-button full-width" data-edit-plan="${escapeHtml(item.id)}">Edit</button>`);}
    actions.push(`<button class="secondary-button full-width danger-action" data-delete-plan="${escapeHtml(item.id)}">Delete</button>`);
    $("planDetailActions").innerHTML=actions.join("");$("planDetailModal").classList.remove("hidden");
  }
  function renderPlanOverview() {
    const month=monthKey(new Date());
    const monthItems=state.planItems.filter(i=>String(i.date||"").startsWith(month));
    const openItems=monthItems.filter(i=>!(i.kind==="bill"?billIsPaid(i):i.done));
    const activities=openItems.filter(i=>i.kind==="activity");
    const bills=openItems.filter(i=>i.kind==="bill");
    const debts=openItems.filter(i=>i.kind==="debt");
    const owed=debts.filter(i=>(i.details||"owe").toLowerCase()!=="collect");
    const commitments=bills.reduce((n,i)=>n+billRemaining(i),0)+owed.reduce((n,i)=>n+Number(i.amount||0),0);
    if($("overviewActivityCount"))$("overviewActivityCount").textContent=String(activities.length);
    if($("overviewBillsCount"))$("overviewBillsCount").textContent=String(bills.length);
    if($("overviewDebtCount"))$("overviewDebtCount").textContent=String(debts.length);
    if($("overviewCommitments"))$("overviewCommitments").textContent=money(commitments);
    const horizon=new Date();horizon.setDate(horizon.getDate()+30);const end=dateKey(horizon),today=todayKey();
    const upcoming=state.planItems.filter(i=>!(i.kind==="bill"?billIsPaid(i):i.done)&&i.date<=end).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
    const target=$("planOverviewUpcoming");
    if(target)target.innerHTML=upcoming.length?upcoming.map(planItemHtml).join(""):'<div class="plan-overview-empty">No upcoming items</div>';
  }
  function renderPlan() {
    const [year,month]=state.planMonth.split("-").map(Number);const first=new Date(year,month-1,1);const last=new Date(year,month,0);
    if($("planMonthLabel")) $("planMonthLabel").textContent=first.toLocaleDateString("en-PH",{month:"long",year:"numeric"});
    const items=state.planItems.filter(i=>i.date?.startsWith(state.planMonth));
    if($("calendarGrid")) {
      const cells=[];for(let i=0;i<first.getDay();i++)cells.push('<span class="calendar-blank"></span>');
      for(let d=1;d<=last.getDate();d++){const key=`${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;const has=state.planItems.some(i=>i.date===key&&!(i.kind==="bill"?billIsPaid(i):i.done));cells.push(`<button class="calendar-day ${key===todayKey()?"is-today":""} ${has?"has-plan":""}" data-calendar-date="${key}"><span>${d}</span>${has?'<i></i>':""}</button>`);}
      $("calendarGrid").innerHTML=cells.join("");
    }
    const renderList=(target,list,empty)=>{const el=$(target);if(!el)return;const sorted=[...list].sort((a,b)=>a.date.localeCompare(b.date));el.innerHTML=sorted.length?sorted.map(planItemHtml).join(""):`<p class="empty-state">${empty}</p>`;};
    renderList("calendarItems",items,"No activities or due dates this month. Tap a calendar date or Add activity.");
    const allBills=state.planItems.filter(i=>i.kind==="bill");
    const billSearch=$("billSearch")?.value?.trim().toLowerCase()||"";const billFilter=$("billStatusFilter")?.value||"all";const billMonth=$("billMonthFilter")?.value||"all";
    const filteredBills=allBills.filter(i=>{const matchSearch=!billSearch||`${i.title} ${i.billCategory||""} ${i.details||""}`.toLowerCase().includes(billSearch);const status=billStatus(i).toLowerCase();const matchStatus=billFilter==="all"||(billFilter==="paid"&&status==="paid")||(billFilter==="unpaid"&&status==="unpaid")||(billFilter==="overdue"&&status==="overdue");const matchMonth=billMonth==="all"||i.date.startsWith(billMonth);return matchSearch&&matchStatus&&matchMonth;}).sort((a,b)=>a.date.localeCompare(b.date));
    const unpaid=allBills.filter(i=>!billIsPaid(i));const paidThisMonth=allBills.filter(i=>billIsPaid(i)&&(i.payments||[]).some(p=>p.date.startsWith(monthKey(new Date()))));
    if($("billUnpaidTotal"))$("billUnpaidTotal").textContent=money(unpaid.reduce((sum,i)=>sum+billRemaining(i),0));
    if($("billDueCount")){const today=todayKey(),weekEnd=dateKey(new Date(Date.now()+7*86400000));$("billDueCount").textContent=String(unpaid.filter(i=>i.date>=today&&i.date<=weekEnd).length);}
    if($("billPaidTotal"))$("billPaidTotal").textContent=money(paidThisMonth.reduce((sum,i)=>sum+(i.payments||[]).filter(p=>p.date.startsWith(monthKey(new Date()))).reduce((n,p)=>n+Number(p.amount||0),0),0));
    if($("billHistoryMonth"))$("billHistoryMonth").textContent=new Date().toLocaleDateString("en-PH",{month:"long",year:"numeric"});
    if($("billHistoryTotal"))$("billHistoryTotal").textContent=money(allBills.reduce((sum,i)=>sum+(i.payments||[]).filter(p=>p.date.startsWith(monthKey(new Date()))).reduce((n,p)=>n+Number(p.amount||0),0),0));
    const billEl=$("billsList");if(billEl)billEl.innerHTML=filteredBills.length?filteredBills.map(planItemHtml).join(""):'<p class="empty-state">No bills match this filter. Tap Add bill to create one.</p>';
    const debts=state.planItems.filter(i=>i.kind==="debt");
    const owed=debts.filter(i=>(i.details||"owe").toLowerCase()!=="collect");
    const collect=debts.filter(i=>(i.details||"owe").toLowerCase()==="collect");
    const outstanding=list=>list.filter(i=>!i.done).reduce((sum,i)=>sum+Number(i.amount||0),0);
    if($("debtOweTotal"))$("debtOweTotal").textContent=money(outstanding(owed));
    if($("debtCollectTotal"))$("debtCollectTotal").textContent=money(outstanding(collect));
    if($("debtOweCount"))$("debtOweCount").textContent=`${owed.filter(i=>!i.done).length} active ${owed.filter(i=>!i.done).length===1?"record":"records"}`;
    if($("debtCollectCount"))$("debtCollectCount").textContent=`${collect.filter(i=>!i.done).length} active ${collect.filter(i=>!i.done).length===1?"record":"records"}`;
    document.querySelectorAll("[data-debt-filter]").forEach(b=>{const active=b.dataset.debtFilter===state.debtFilter;b.classList.toggle("selected",active);b.setAttribute("aria-pressed",String(active));});
    if($("debtListTitle"))$("debtListTitle").textContent=state.debtFilter==="collect"?"Akong kolektahon":"Akong bayran";
    const selectedDebts=state.debtFilter==="collect"?collect:owed;
    renderList("debtsList",selectedDebts,"Walay record sa maong category.");
    renderPlanOverview();
    if(state.planTab) setPlanTabVisualOnly();
  }
  function setPlanTabVisualOnly(){document.querySelectorAll("[data-plan-tab]").forEach(b=>b.classList.toggle("selected",b.dataset.planTab===state.planTab));document.querySelectorAll(".plan-panel").forEach(p=>p.classList.toggle("hidden",p.id!==({overview:"overviewPanel",calendar:"calendarPanel",bills:"billsPanel",debts:"debtsPanel"}[state.planTab])));}
  function upcomingItems() {
    const today=todayKey(), horizon=new Date();horizon.setDate(horizon.getDate()+30);const end=dateKey(horizon);
    return state.planItems.filter(i=>!(i.kind==="bill"?billIsPaid(i):i.done)&&i.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function renderNotifications() {
    const items=upcomingItems();const badge=$("notificationBadge");if(badge){badge.textContent=String(items.length);badge.classList.toggle("hidden",items.length===0);}
    const list=$("notificationsList");if(list)list.innerHTML=items.length?items.map(i=>{const isBill=i.kind==="bill",due=i.date===todayKey()?"Today":i.date<todayKey()?"Overdue":new Date(i.date+"T12:00:00").toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});const status=i.date<todayKey()?"Overdue":i.date===todayKey()?"Due today":"Upcoming";return `<button type="button" class="notification-item" data-open-plan="${escapeHtml(i.id)}"><span class="notification-item-mark ${isBill?"bill":"activity"}"></span><span class="notification-item-copy"><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(isBill?(i.billCategory||"Bill"):i.kind==="debt"?"Utang":"Activity")} · ${escapeHtml(due)}</small></span><span class="notification-item-side"><strong>${isBill?money(billRemaining(i)):""}</strong><small>${status}</small></span></button>`;}).join(""):'<div class="notification-empty">No upcoming notifications</div>';
  }
  function checkDueNotifications() {
    renderNotifications();
    if(!("Notification" in window)||Notification.permission!=="granted")return;
    const today=todayKey();const key="pocketledger-notified-date";const notified=JSON.parse(localStorage.getItem(key)||"{}");
    state.planItems.filter(i=>{if(i.kind==="bill"?billIsPaid(i):i.done)return false;const days=Math.round((new Date(i.date+"T12:00:00")-new Date(today+"T12:00:00"))/86400000);const lead=i.kind==="bill"?Number(i.reminderDays||0):0;return days<=0||days<=lead;}).forEach(i=>{const stamp=`${today}:${i.date}`;if(notified[i.id]===stamp)return;try{const days=Math.round((new Date(i.date+"T12:00:00")-new Date(today+"T12:00:00"))/86400000);const heading=days<0?"Overdue: "+i.title:days===0?"Due today: "+i.title:"Upcoming: "+i.title;new Notification(heading,{body:i.kind==="activity"?`Scheduled activity · ${i.date}`:`${money(billRemaining(i))} · ${i.kind==="bill"?"Bill due "+i.date:"Utang due "+i.date}`});notified[i.id]=stamp;}catch{}});
    localStorage.setItem(key,JSON.stringify(notified));
  }

  function renderCategories() {
    const render=(type,target)=> {
      $(target).innerHTML=allCategories(type).map((c,i)=>{
        const custom=i>=BUILTIN[type].length;
        return `<div class="category-row"><span class="category-emoji">${escapeHtml(c.icon)}</span><strong>${escapeHtml(c.name)}</strong><small>${custom?"Custom":"Built-in"}</small>${custom?`<button class="tiny-button" data-remove-category="${escapeHtml(type)}|${escapeHtml(c.name)}" aria-label="Delete ${escapeHtml(c.name)}">×</button>`:""}</div>`;
      }).join("");
    };
    render("income","incomeCategories"); render("expense","expenseCategories");
  }
  function renderCategoryFilter() {
    const select=$("categoryFilter"), old=select.value;
    const categories=[...new Set([...allCategories("income"),...allCategories("expense")].map(c=>c.name))];
    select.innerHTML='<option value="all">All categories</option>'+categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if(categories.includes(old))select.value=old;
  }
  function renderAll() { renderDashboard(); renderCategoryFilter(); renderLogs(); renderReports(); renderPlan(); renderNotifications(); }
  async function addCategory(type) {
    const name=prompt(`Name your new ${type} category:`); if(!name)return;
    const clean=name.trim().slice(0,40);
    if(!clean)return;
    if(allCategories(type).some(c=>c.name.toLowerCase()===clean.toLowerCase())){setToast("That category already exists.");return;}
    const icon=type==="income"?"✦":"•";
    state.customCategories[type].push({name:clean,icon});
    saveMeta({customCategories:state.customCategories});
    renderAll(); setToast("Category added.");
  }
  function removeCategory(type,name) {
    if(state.transactions.some(t=>t.type===type&&t.category===name)){setToast("This category is in use by a transaction.");return;}
    if(!confirm(`Delete custom category "${name}"?`))return;
    state.customCategories[type]=state.customCategories[type].filter(c=>c.name!==name);
    saveMeta({customCategories:state.customCategories});renderAll();setToast("Category deleted.");
  }
  function download(name,content,type) {
    const blob=new Blob([content],{type}), url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }
  function exportCsv() {
    const rows=[["Date","Type","Amount_PHP","Category","Note"],...state.transactions.map(t=>[t.date,t.type,Number(t.amount).toFixed(2),t.category,t.note||""])];
    const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    download("pocketledger-transactions.csv",csv,"text/csv;charset=utf-8");setToast("CSV export ready.");
  }
  function backupJson() {
    const payload={format:"pocketledger-backup",version:1,exported_at:new Date().toISOString(),transactions:state.transactions,customCategories:state.customCategories,planItems:state.planItems};
    download(`pocketledger-backup-${todayKey()}.json`,JSON.stringify(payload,null,2),"application/json");setToast("Backup downloaded.");
  }
  async function restoreJson(file) {
    try {
      const payload=JSON.parse(await file.text());
      if(payload.format!=="pocketledger-backup"||!Array.isArray(payload.transactions))throw new Error("This file is not a PocketLedger backup.");
      if(!confirm(`Restore ${payload.transactions.length} transactions? Matching IDs will be replaced.`))return;
      for(const raw of payload.transactions){
        if(!raw.id||!["income","expense"].includes(raw.type)||!Number.isFinite(Number(raw.amount))||Number(raw.amount)<=0||!raw.date)continue;
        const tx={...raw,amount:Number(raw.amount),user_id:state.user?.id||null,sync_status:state.user?"pending":"local",updated_at:new Date().toISOString()};
        await localPut(tx);
      }
      if(payload.customCategories){state.customCategories={income:Array.isArray(payload.customCategories.income)?payload.customCategories.income:[],expense:Array.isArray(payload.customCategories.expense)?payload.customCategories.expense:[]};saveMeta({customCategories:state.customCategories});}
      if(Array.isArray(payload.planItems)){state.planItems=payload.planItems;saveMeta({planItems:state.planItems});}
      state.transactions=await localGetAll();renderAll();setToast("Backup restored.");
      if(state.user&&navigator.onLine)syncNow();
    }catch(e){setToast(e.message||"Could not restore that backup.");}
  }

  function initSupabase() {
    if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!window.supabase?.createClient) return;
    state.supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    state.supabase.auth.getSession().then(({data})=>{
      state.user=data.session?.user||null;updateAccountUI();
      if(state.user&&navigator.onLine)syncNow();
    });
    state.supabase.auth.onAuthStateChange((_event,session)=>{
      state.user=session?.user||null;updateAccountUI();
      if(state.user&&navigator.onLine) setTimeout(()=>syncNow(),0);
    });
  }
  function updateAccountUI() {
    const wasAuthRequired=document.body.classList.contains("auth-required");
    document.body.classList.toggle("auth-required",!state.user);
    if(!state.user) $("accountModal").classList.remove("hidden");
    else if(wasAuthRequired) $("accountModal").classList.add("hidden");
    const configured=!!state.supabase;
    $("accountSignedOut").classList.toggle("hidden",!!state.user||!configured);
    $("accountSignedIn").classList.toggle("hidden",!state.user);
    if(!configured){
      $("syncHeadline").textContent="Offline-first storage";
      $("syncDescription").textContent="Your entries are saved on this device. Sign in to securely sync your data across devices.";
      $("authMessage").textContent="Sign in or create an account to enable cloud sync. Local mode remains available offline.";
    }else{
      $("syncHeadline").textContent=state.user?"Account connected":"Sign in to sync";
      $("syncDescription").textContent=state.user?"Your account is connected. Pending changes can sync when you're online.":"Create an account or sign in to sync your transactions across devices.";
      if(state.user)$("signedInEmail").textContent=state.user.email||"Signed-in user";
    }
    $("authForm").classList.toggle("hidden",!configured);
    $("connectionPill").classList.toggle("online",navigator.onLine);
    $("connectionPill").classList.toggle("offline",!navigator.onLine);
    $("connectionText").textContent=navigator.onLine?(state.user?"Online · signed in":"Online · local mode"):"Offline ready";
  }
  async function submitAuth(e) {
    e.preventDefault();
    if(!state.supabase){$("authMessage").textContent="Supabase is not ready. Check your connection and try again.";return;}
    const email=$("authEmail").value.trim(),password=$("authPassword").value;
    $("authSubmit").disabled=true;$("authMessage").textContent="Please wait…";
    try{
      const result=state.authMode==="signup"
        ?await state.supabase.auth.signUp({email,password})
        :await state.supabase.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      $("authMessage").textContent=state.authMode==="signup"&&!result.data.session?"Account created. Check your email to confirm it, then sign in.":"Signed in successfully.";
      if(result.data.user&&!result.data.session&&state.authMode==="signup")setToast("Check your email to confirm your account.");
      else setToast("Account connected.");
    }catch(err){$("authMessage").textContent=err.message||"Authentication failed.";}
    finally{$("authSubmit").disabled=false;}
  }
  async function signInWithGoogle() {
    if(!state.supabase){$("authMessage").textContent="Supabase is not configured.";return;}
    $("authMessage").textContent="Opening Google sign-in…";
    const redirectTo = window.location.origin + window.location.pathname;
    const {error}=await state.supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo}});
    if(error)$("authMessage").textContent=error.message;
  }

  function markSyncDeleted(table,id) {
    const meta=readMeta(), all=meta.syncTombstones||{};
    const ids=new Set(all[table]||[]);ids.add(String(id));
    saveMeta({syncTombstones:{...all,[table]:[...ids]}});
  }
  async function syncRows(table, localRows, encode, decode) {
    const {data:remote,error}=await state.supabase.from(table).select("*").eq("user_id",state.user.id);
    if(error)throw error;
    const meta=readMeta(), all=meta.syncTombstones||{}, ids=new Set(all[table]||[]);
    for(const row of remote||[])if(row.deleted_at)ids.add(String(row.client_id));
    const mergedById=new Map();
    for(const row of remote||[])if(!row.deleted_at)mergedById.set(String(row.client_id),decode(row));
    for(const local of localRows){
      const id=String(local.id);if(ids.has(id))continue;
      const cloud=mergedById.get(id);
      if(!cloud || new Date(local.updated_at||local.created_at||0)>=new Date(cloud.updated_at||cloud.created_at||0))mergedById.set(id,local);
    }
    const merged=[...mergedById.values()];
    for(let i=0;i<merged.length;i+=100){
      const batch=merged.slice(i,i+100).map(encode);
      if(batch.length){const {error:upsertError}=await state.supabase.from(table).upsert(batch,{onConflict:"user_id,client_id"});if(upsertError)throw upsertError;}
    }
    if(ids.size){
      const deletedAt=new Date().toISOString();
      const tombstones=[...ids].map(id=>({user_id:state.user.id,client_id:id,data:{},created_at:deletedAt,updated_at:deletedAt,deleted_at:deletedAt}));
      const {error:tombstoneError}=await state.supabase.from(table).upsert(tombstones,{onConflict:"user_id,client_id"});if(tombstoneError)throw tombstoneError;
    }
    saveMeta({syncTombstones:{...all,[table]:[...ids]}});
    return merged;
  }
  async function syncNow() {
    if(!state.supabase||!state.user||!navigator.onLine||state.syncing)return;
    state.syncing=true;$("syncHeadline").textContent="Syncing…";
    try{
      const localTransactions=await localGetAll();
      const transactions=await syncRows("ledger_transactions",localTransactions,
        tx=>({user_id:state.user.id,client_id:String(tx.id),data:tx,created_at:tx.created_at||new Date().toISOString(),updated_at:tx.updated_at||tx.created_at||new Date().toISOString()}),
        row=>({...row.data,id:row.client_id,user_id:state.user.id,sync_status:"synced",created_at:row.created_at,updated_at:row.updated_at}));
      const deletedTxIds=new Set(readMeta().syncTombstones?.ledger_transactions||[]);
      for(const id of deletedTxIds)await localDelete(id);
      for(const tx of transactions)await localPut({...tx,user_id:state.user.id,sync_status:"synced"});
      state.transactions=(await localGetAll()).filter(tx=>!deletedTxIds.has(String(tx.id)));

      const plans=await syncRows("plan_items",state.planItems,
        item=>({user_id:state.user.id,client_id:String(item.id),data:item,created_at:item.created_at||new Date().toISOString(),updated_at:item.updated_at||item.created_at||new Date().toISOString()}),
        row=>({...row.data,id:row.client_id,created_at:row.data?.created_at||row.created_at,updated_at:row.updated_at}));
      const deletedPlanIds=new Set(readMeta().syncTombstones?.plan_items||[]);
      state.planItems=plans.filter(item=>!deletedPlanIds.has(String(item.id)));saveMeta({planItems:state.planItems});

      const paymentRows=[];
      for(const item of state.planItems){
        (Array.isArray(item.payments)?item.payments:[]).forEach((payment,index)=>paymentRows.push({
          id:String(payment.id||`${item.id}-payment-${index+1}`), plan_item_client_id:String(item.id), payment, created_at:payment.created_at||payment.date||item.created_at||new Date().toISOString()
        }));
      }
      const {error:paymentsError}=await state.supabase.from("payment_history").upsert(paymentRows.map(p=>({user_id:state.user.id,client_id:p.id,plan_item_client_id:p.plan_item_client_id,data:p.payment,created_at:p.created_at,updated_at:p.created_at})),{onConflict:"user_id,client_id"});
      if(paymentsError)throw paymentsError;

      const {data:settings,error:settingsError}=await state.supabase.from("user_settings").select("data").eq("user_id",state.user.id).maybeSingle();
      if(settingsError)throw settingsError;
      if(settings?.data?.customCategories){state.customCategories=settings.data.customCategories;saveMeta({customCategories:state.customCategories});}
      else {const {error:settingsUpsertError}=await state.supabase.from("user_settings").upsert({user_id:state.user.id,data:{customCategories:state.customCategories},updated_at:new Date().toISOString()},{onConflict:"user_id"});if(settingsUpsertError)throw settingsUpsertError;}

      renderAll();
      $("syncHeadline").textContent="All caught up";
      $("syncDescription").textContent=`Synced ${state.transactions.length} transactions, ${state.planItems.length} plans and debts, and ${paymentRows.length} payments for ${state.user.email||"your account"}.`;
      setToast("PocketLedger sync complete.");
    }catch(err){
      $("syncHeadline").textContent="Sync needs attention";
      $("syncDescription").textContent=err.message||"Could not sync. Your local data is still saved on this device.";
      setToast("Sync failed. Local data is still saved on this device.");
    }finally{state.syncing=false;updateAccountUI();}
  }
  async function signOut() {
    if(!state.supabase)return;
    const {error}=await state.supabase.auth.signOut();
    if(error){setToast(error.message);return;}
    state.user=null;updateAccountUI();setToast("Signed out. Local transactions remain on this device.");
  }

  function initEvents() {
    document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
    document.querySelectorAll("[data-open-form]").forEach(b=>b.addEventListener("click",()=>openTransactionForm(b.dataset.openForm)));
    document.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",closeTransactionForm));
    document.querySelectorAll("[data-form-type]").forEach(b=>b.addEventListener("click",()=>setFormType(b.dataset.formType)));
    $("calculator").addEventListener("click",e=>{const b=e.target.closest("[data-key]");if(b)calcKey(b.dataset.key);});
    $("transactionForm").addEventListener("submit",saveTransaction);
    $("accountButton").addEventListener("click",()=>{$("accountModal").classList.remove("hidden");updateAccountUI();});
    $("notificationButton").addEventListener("click",()=>{$("notificationModal").classList.remove("hidden");renderNotifications();});
    document.querySelectorAll("[data-close-notifications]").forEach(b=>b.addEventListener("click",()=>$("notificationModal").classList.add("hidden")));
    document.querySelectorAll("[data-close-account]").forEach(b=>b.addEventListener("click",()=>$("accountModal").classList.add("hidden")));
    document.querySelectorAll("[data-auth-mode]").forEach(b=>b.addEventListener("click",()=>{
      state.authMode=b.dataset.authMode;document.querySelectorAll("[data-auth-mode]").forEach(x=>x.classList.toggle("selected",x===b));
      $("authSubmit").textContent=state.authMode==="signup"?"Create account":"Sign in";
      $("authPassword").autocomplete=state.authMode==="signup"?"new-password":"current-password";
      $("authMessage").textContent="";
    }));
    $("authForm").addEventListener("submit",submitAuth);
    $("googleSignIn").addEventListener("click",signInWithGoogle);
    $("syncNow").addEventListener("click",syncNow);$("signOut").addEventListener("click",signOut);
    $("backupJson").addEventListener("click",backupJson);$("restoreJson").addEventListener("change",e=>{if(e.target.files?.[0])restoreJson(e.target.files[0]);e.target.value="";});
    $("monthPicker").addEventListener("change",e=>{state.selectedMonth=e.target.value||monthKey(new Date());renderDashboard();});
    $("reportMonth").value=state.selectedMonth;$("reportMonth").addEventListener("change",renderReports);
    ["searchInput","typeFilter","categoryFilter","fromDate","toDate"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderLogs));
    $("exportCsv").addEventListener("click",exportCsv);
    $("addActivity").addEventListener("click",()=>addPlanItem("activity"));
    $("addBill").addEventListener("click",()=>addPlanItem("bill"));
    $("addOverviewActivity").addEventListener("click",()=>addPlanItem("activity"));
    $("addOverviewBill").addEventListener("click",()=>addPlanItem("bill"));
    $("addOverviewDebt").addEventListener("click",()=>addPlanItem("debt"));
    ["billSearch","billStatusFilter","billMonthFilter"].forEach(id=>$(id)?.addEventListener(id==="billSearch"?"input":"change",renderPlan));
    $("clearBillFilters")?.addEventListener("click",()=>{ $("billSearch").value="";$("billStatusFilter").value="all";$("billMonthFilter").value="";renderPlan(); });
    $("addDebt").addEventListener("click",()=>addPlanItem("debt"));
    $("prevPlanMonth").addEventListener("click",()=>changePlanMonth(-1));
    $("nextPlanMonth").addEventListener("click",()=>changePlanMonth(1));
    $("calendarGrid").addEventListener("click",e=>{const day=e.target.closest("[data-calendar-date]");if(day)openPlanForm("activity",null,day.dataset.calendarDate);});
    $("planForm").addEventListener("submit",submitPlanForm);
    document.querySelectorAll("[data-close-plan-form]").forEach(b=>b.addEventListener("click",closePlanForm));
    document.querySelectorAll("[data-close-plan-detail]").forEach(b=>b.addEventListener("click",()=>$("planDetailModal").classList.add("hidden")));
    document.addEventListener("click",e=>{
      const edit=e.target.closest("[data-edit-tx]");if(edit){const tx=getTx(edit.dataset.editTx);if(tx)openTransactionForm(tx.type,tx);return;}
      const del=e.target.closest("[data-delete-tx]");if(del){deleteTransaction(del.dataset.deleteTx);return;}
      const planTab=e.target.closest("[data-plan-tab]");if(planTab){setPlanTab(planTab.dataset.planTab);return;}
      const debtFilter=e.target.closest("[data-debt-filter]");if(debtFilter){state.debtFilter=debtFilter.dataset.debtFilter;renderPlan();return;}
      const openPlanTab=e.target.closest("[data-open-plan-tab]");if(openPlanTab){setPlanTab(openPlanTab.dataset.openPlanTab);return;}
      const openPlan=e.target.closest("[data-open-plan]");if(openPlan){showPlanDetail(openPlan.dataset.openPlan);return;}
      const editPlan=e.target.closest("[data-edit-plan]");if(editPlan){const item=state.planItems.find(x=>x.id===editPlan.dataset.editPlan);if(item){$("planDetailModal").classList.add("hidden");openPlanForm(item.kind,item);}return;}
      const done=e.target.closest("[data-complete-plan]");if(done){togglePlanComplete(done.dataset.completePlan);showPlanDetail(done.dataset.completePlan);return;}
      const removePlan=e.target.closest("[data-delete-plan]");if(removePlan){deletePlanItem(removePlan.dataset.deletePlan);return;}
      const pay=e.target.closest("[data-pay-bill]");if(pay){payBill(pay.dataset.payBill);return;}
      const cancelPayment=e.target.closest("[data-cancel-payment]");if(cancelPayment){showPlanDetail(cancelPayment.dataset.cancelPayment);return;}
      const hist=e.target.closest("[data-bill-history]");if(hist){showBillHistory(hist.dataset.billHistory);return;}
      const editBillBtn=e.target.closest("[data-edit-bill]");if(editBillBtn){editBill(editBillBtn.dataset.editBill);return;}
      const receipt=e.target.closest("[data-attach-receipt]");if(receipt){attachBillReceipt(receipt.dataset.attachReceipt);return;}
      const viewReceipt=e.target.closest("[data-open-receipt]");if(viewReceipt){openBillReceipt(viewReceipt.dataset.openReceipt);return;}
    });
    window.addEventListener("online",()=>{updateAccountUI();if(state.user)syncNow();});
    window.addEventListener("offline",updateAccountUI);
    window.addEventListener("keydown",e=>{if(e.key==="Escape"){closeTransactionForm();closePlanForm();$("planDetailModal").classList.add("hidden");$("accountModal").classList.add("hidden");$("notificationModal").classList.add("hidden");}});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkDueNotifications();});
    window.setInterval(checkDueNotifications,60000);
  }
  async function init() {
    $("todayLabel").textContent=new Date().toLocaleDateString("en-PH",{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
    $("transactionDate").value=todayKey();
    try{state.transactions=await localGetAll();}catch(e){console.error(e);setToast("Local storage could not start in this browser.");}
    const meta=readMeta();if(meta.customCategories)state.customCategories=meta.customCategories;if(Array.isArray(meta.planItems))state.planItems=meta.planItems;
    initEvents();initSupabase();renderAll();updateAccountUI();checkDueNotifications();
    if("serviceWorker" in navigator && location.protocol!=="file:"){
      navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service worker registration failed:",err));
    }
  }
  document.addEventListener("DOMContentLoaded",init);
})();
