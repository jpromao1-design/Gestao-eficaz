// =====================================
// SUPABASE
// =====================================

const supabaseUrl = "https://oxwnbjmjpxvjtfvzkdju.supabase.co";
const supabaseKey =
  "sb_publishable_oMN5FVGpCwdlllqynA1IpA_paDrG1fk";

const client = window.supabase.createClient(supabaseUrl, supabaseKey);

// =====================================
// STATE
// =====================================

let tasks = [];
let editingTaskId = null;
let deferredPrompt = null;
let saving = false;
let searchDebounceTimer = null;

const INSTALL_DISMISS_KEY = "gestao-eficaz-install-dismissed";

// =====================================
// HELPERS
// =====================================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showNotify(msg) {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.className = "notification";
  div.textContent = msg;
  document.body.appendChild(div);

  setTimeout(() => div.remove(), 3000);
}

function formatDataBR(iso) {
  if (!iso) return "---";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function isOverdue(task, hoje = todayISO()) {
  return task.status !== "CONCLUIDO" && !!task.end && task.end < hoje;
}

function setBusy(isBusy) {
  saving = isBusy;
  const btnSave = document.getElementById("btn-save");
  const btnCancel = document.getElementById("btn-cancel-edit");
  if (btnSave) btnSave.disabled = isBusy;
  if (btnCancel) btnCancel.disabled = isBusy;
}

function getFilterValues() {
  return {
    busca: document.getElementById("search-input").value.trim().toLowerCase(),
    status: document.getElementById("filter-status").value,
    secao: document.getElementById("filter-secao").value,
    prioridade: document.getElementById("filter-prioridade").value,
    atrasadas: document.getElementById("filter-atrasadas").value,
  };
}

function getFilteredTasks() {
  const { busca, status, secao, prioridade, atrasadas } = getFilterValues();
  const hoje = todayISO();

  return tasks.filter((t) => {
    const matchBusca =
      !busca ||
      t.descricao?.toLowerCase().includes(busca) ||
      t.executor?.toLowerCase().includes(busca) ||
      t.superior?.toLowerCase().includes(busca);

    const matchStatus = status === "TODOS" || t.status === status;
    const matchSecao = secao === "TODAS" || t.secao === secao;
    const matchPrioridade =
      prioridade === "TODAS" || t.prioridade === prioridade;
    const matchAtrasadas =
      atrasadas === "TODAS" ||
      (atrasadas === "SIM" && isOverdue(t, hoje)) ||
      (atrasadas === "NAO" && !isOverdue(t, hoje));

    return (
      matchBusca &&
      matchStatus &&
      matchSecao &&
      matchPrioridade &&
      matchAtrasadas
    );
  });
}

// =====================================
// FORM
// =====================================

function toggleFields() {
  const superior = document.getElementById("task-tem-superior").value;
  const divSuperior = document.getElementById("div-superior");
  const divFeedback = document.getElementById("div-feedback");
  const show = superior === "SIM";

  divSuperior.classList.toggle("field-hidden", !show);
  divFeedback.classList.toggle("field-hidden", !show);

  if (!show) {
    document.getElementById("task-superior").value = "";
    document.getElementById("task-exige-feedback").value = "NAO";
  }
}

function limparFormulario() {
  document.getElementById("task-descricao").value = "";
  document.getElementById("task-executor").value = "";
  document.getElementById("task-superior").value = "";
  document.getElementById("task-deadline").value = "";
  document.getElementById("task-tem-superior").value = "NAO";
  document.getElementById("task-category").value = "PROFISSIONAL";
  document.getElementById("task-secao").value = "NENHUMA";
  document.getElementById("task-prioridade").value = "ALTA";
  document.getElementById("task-exige-feedback").value = "NAO";
  toggleFields();
}

function cancelEdit() {
  editingTaskId = null;
  document.getElementById("btn-save").textContent = "SINCRONIZAR MISSÃO";
  document.getElementById("btn-cancel-edit").style.display = "none";
  limparFormulario();
}

function editTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;

  editingTaskId = id;

  document.getElementById("task-category").value = t.category || "PROFISSIONAL";
  document.getElementById("task-secao").value = t.secao || "NENHUMA";
  document.getElementById("task-prioridade").value = t.prioridade || "ALTA";
  document.getElementById("task-tem-superior").value = t.temSuperior || "NAO";
  document.getElementById("task-superior").value = t.superior || "";
  document.getElementById("task-exige-feedback").value =
    t.exigeFeedbackSup || "NAO";
  document.getElementById("task-descricao").value = t.descricao || "";
  document.getElementById("task-executor").value = t.executor || "";
  document.getElementById("task-deadline").value = t.end || "";

  toggleFields();

  document.getElementById("btn-save").textContent = "ATUALIZAR MISSÃO";
  document.getElementById("btn-cancel-edit").style.display = "block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function buildPayloadFromForm() {
  const descricao = document.getElementById("task-descricao").value.trim();
  const prazo = document.getElementById("task-deadline").value;
  const temSuperior = document.getElementById("task-tem-superior").value;
  const superior = document.getElementById("task-superior").value.trim();
  const executor = document.getElementById("task-executor").value.trim();

  if (!descricao || !prazo) {
    showNotify("Missão e prazo obrigatórios");
    return null;
  }

  if (temSuperior === "SIM" && !superior) {
    showNotify("Informe o nome do superior");
    return null;
  }

  return {
    category: document.getElementById("task-category").value,
    secao: document.getElementById("task-secao").value,
    prioridade: document.getElementById("task-prioridade").value,
    temSuperior,
    superior: temSuperior === "SIM" ? superior : "",
    exigeFeedbackSup:
      temSuperior === "SIM"
        ? document.getElementById("task-exige-feedback").value
        : "NAO",
    descricao,
    executor: executor || "Não definido",
    end: prazo,
  };
}

// =====================================
// DATA
// =====================================

async function fetchTasks() {
  const { data, error } = await client
    .from("tarefas")
    .select("*")
    .order("createdAt", { ascending: false });

  if (error) {
    console.error(error);
    showNotify("Erro ao carregar missões");
    return;
  }

  tasks = data || [];
  updateStats();
  render();
}

function updateStats() {
  const hoje = todayISO();

  document.getElementById("stat-total").textContent = String(tasks.length);

  document.getElementById("stat-atrasada").textContent = String(
    tasks.filter((t) => isOverdue(t, hoje)).length
  );

  document.getElementById("stat-feedback").textContent = String(
    tasks.filter(
      (t) => t.exigeFeedbackSup === "SIM" && t.statusFeedbackSup === "NAO"
    ).length
  );
}

async function addTask() {
  if (saving) return;

  const payload = buildPayloadFromForm();
  if (!payload) return;

  setBusy(true);

  try {
    if (editingTaskId) {
      const { error } = await client
        .from("tarefas")
        .update(payload)
        .eq("id", editingTaskId);

      if (error) {
        console.error(error);
        showNotify("Erro ao atualizar");
        return;
      }

      showNotify("Missão atualizada");
      cancelEdit();
    } else {
      payload.id = crypto.randomUUID();
      payload.start = todayISO();
      payload.status = "PENDENTE";
      payload.feedback = "";
      payload.statusFeedbackSup = "NAO";
      payload.createdAt = new Date().toISOString();

      const { error } = await client.from("tarefas").insert([payload]);

      if (error) {
        console.error(error);
        showNotify("Erro ao salvar");
        return;
      }

      // WhatsApp NÃO abre automaticamente — só sob demanda (botão WA)
      showNotify("Missão salva. Use WA se quiser compartilhar.");
      limparFormulario();
    }

    await fetchTasks();
  } finally {
    setBusy(false);
  }
}

async function deleteTask(id) {
  if (saving) return;

  const task = tasks.find((t) => t.id === id);
  const label = task?.descricao ? `"${task.descricao}"` : "esta missão";

  if (!confirm(`Excluir ${label}?`)) return;

  setBusy(true);

  try {
    const { error } = await client.from("tarefas").delete().eq("id", id);

    if (error) {
      console.error(error);
      showNotify("Erro ao excluir");
      return;
    }

    if (editingTaskId === id) cancelEdit();

    showNotify("Missão excluída");
    await fetchTasks();
  } finally {
    setBusy(false);
  }
}

async function updateField(id, field, value) {
  const { error } = await client
    .from("tarefas")
    .update({ [field]: value })
    .eq("id", id);

  if (error) {
    console.error(error);
    showNotify("Erro ao atualizar");
    await fetchTasks();
    return;
  }

  const local = tasks.find((t) => t.id === id);
  if (local) local[field] = value;

  updateStats();
  render();
}

// =====================================
// WHATSAPP (somente sob demanda)
// =====================================

function openWhatsApp(mensagem) {
  const url = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
  window.open(url, "_blank");
}

function sendWA(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;

  const msg =
    `🚨 ORDEM DE MISSÃO - 8º BAEP\n\n` +
    `📋 Missão: ${t.descricao}\n` +
    `👤 Executor: ${t.executor}\n` +
    `🏢 Seção: ${t.secao}\n` +
    `⚡ Prioridade: ${t.prioridade}\n` +
    `📅 Prazo: ${formatDataBR(t.end)}\n` +
    (t.temSuperior === "SIM" ? `👮 Superior: ${t.superior}\n` : "") +
    `📊 Status: ${t.status}`;

  openWhatsApp(msg);
}

function sendGeneralWhatsApp() {
  const lista = getFilteredTasks();

  if (lista.length === 0) {
    showNotify(
      tasks.length === 0
        ? "Nenhuma missão cadastrada"
        : "Nenhuma missão nos filtros atuais"
    );
    return;
  }

  let mensagem =
    `🚨 *Gestão Eficaz*\n` + `📋 *RELATÓRIO OPERACIONAL*\n\n`;

  lista.forEach((t, index) => {
    mensagem +=
      `----------------------------------\n` +
      `🎯 *MISSÃO ${index + 1}*\n\n` +
      `📌 ${t.descricao}\n` +
      `👤 Executor: ${t.executor}\n` +
      `🏢 Seção: ${t.secao}\n` +
      `⚡ Prioridade: ${t.prioridade}\n` +
      `📅 Prazo: ${formatDataBR(t.end)}\n` +
      (t.temSuperior === "SIM" ? `👮 Superior: ${t.superior}\n` : "") +
      `📊 Status: ${t.status}\n\n`;
  });

  openWhatsApp(mensagem);
}

// =====================================
// RENDER
// =====================================

function render() {
  const tbody = document.getElementById("task-list");
  const empty = document.getElementById("empty-state");
  const filtradas = getFilteredTasks();
  const hoje = todayISO();

  tbody.innerHTML = "";

  if (filtradas.length === 0) {
    empty.hidden = false;
    empty.querySelector("strong").textContent =
      tasks.length === 0
        ? "Nenhuma missão cadastrada"
        : "Nenhuma missão encontrada";
    empty.querySelector("span").textContent =
      tasks.length === 0
        ? "Lance a primeira ordem de missão no formulário acima."
        : "Ajuste a busca ou os filtros para ver resultados.";
    return;
  }

  empty.hidden = true;

  filtradas.forEach((t) => {
    const atrasada = isOverdue(t, hoje);
    const tr = document.createElement("tr");
    tr.dataset.id = t.id;

    const feedbackBlock =
      t.temSuperior === "SIM" && t.exigeFeedbackSup === "SIM"
        ? `
          <div class="feedback-box">
            <label for="feedback-sup-${escapeHtml(t.id)}">Feedback ao superior</label>
            <select
              id="feedback-sup-${escapeHtml(t.id)}"
              data-action="feedback-sup"
              data-id="${escapeHtml(t.id)}"
            >
              <option value="NAO" ${t.statusFeedbackSup === "NAO" ? "selected" : ""}>
                Pendente
              </option>
              <option value="SIM" ${t.statusFeedbackSup === "SIM" ? "selected" : ""}>
                Enviado / respondido
              </option>
            </select>
          </div>
        `
        : "";

    tr.innerHTML = `
      <td>
        <select data-action="status" data-id="${escapeHtml(t.id)}">
          <option value="PENDENTE" ${t.status === "PENDENTE" ? "selected" : ""}>
            ⏳ PENDENTE
          </option>
          <option value="CONCLUIDO" ${t.status === "CONCLUIDO" ? "selected" : ""}>
            ✅ CONCLUÍDO
          </option>
        </select>
      </td>
      <td>
        <span class="badge">${escapeHtml(t.secao)}</span>
        <span class="badge">${escapeHtml(t.prioridade)}</span>
        ${atrasada ? '<span class="badge badge-danger">ATRASADA</span>' : ""}
        ${
          t.exigeFeedbackSup === "SIM" && t.statusFeedbackSup === "NAO"
            ? '<span class="badge badge-info">FEEDBACK PENDENTE</span>'
            : ""
        }
        <div class="mission-title">${escapeHtml(t.descricao)}</div>
        <div class="mission-meta">Responsável: ${escapeHtml(t.executor)}</div>
        ${
          t.temSuperior === "SIM"
            ? `<div class="mission-superior">Superior: ${escapeHtml(t.superior)}</div>`
            : ""
        }
        ${feedbackBlock}
      </td>
      <td class="${atrasada ? "deadline-late" : "deadline-ok"}">
        ${escapeHtml(formatDataBR(t.end))}
      </td>
      <td>
        <textarea
          data-action="feedback"
          data-id="${escapeHtml(t.id)}"
          rows="3"
        >${escapeHtml(t.feedback || "")}</textarea>
      </td>
      <td>
        <div class="action-row">
          <button type="button" class="btn-sm btn-edit" data-action="edit" data-id="${escapeHtml(t.id)}">
            EDIT
          </button>
          <button type="button" class="btn-sm btn-wa" data-action="wa" data-id="${escapeHtml(t.id)}" title="Compartilhar no WhatsApp">
            WA
          </button>
          <button type="button" class="btn-sm btn-del" data-action="del" data-id="${escapeHtml(t.id)}">
            DEL
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// =====================================
// EVENTS
// =====================================

function setupFormEvents() {
  document
    .getElementById("task-tem-superior")
    .addEventListener("change", toggleFields);

  document.getElementById("btn-save").addEventListener("click", addTask);
  document
    .getElementById("btn-cancel-edit")
    .addEventListener("click", cancelEdit);

  document
    .getElementById("mission-form")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      addTask();
    });
}

function setupListEvents() {
  const searchInput = document.getElementById("search-input");

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(render, 200);
  });

  ["filter-status", "filter-secao", "filter-prioridade", "filter-atrasadas"].forEach(
    (id) => {
      document.getElementById(id).addEventListener("change", render);
    }
  );

  document.getElementById("task-list").addEventListener("change", (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (!action || !id) return;

    if (action === "status") updateField(id, "status", el.value);
    if (action === "feedback") updateField(id, "feedback", el.value);
    if (action === "feedback-sup") {
      updateField(id, "statusFeedbackSup", el.value);
    }
  });

  document.getElementById("task-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.tagName === "SELECT" || btn.tagName === "TEXTAREA") return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;

    if (action === "edit") editTask(id);
    if (action === "wa") sendWA(id);
    if (action === "del") deleteTask(id);
  });

  document
    .getElementById("floating-wa")
    .addEventListener("click", sendGeneralWhatsApp);
}

// =====================================
// PWA
// =====================================

function isRunningStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function updatePwaStatus() {
  const chip = document.getElementById("pwa-status-chip");
  if (!chip) return;

  chip.textContent = isRunningStandalone()
    ? "✅ Aplicativo instalado"
    : "📱 Pronto para instalar";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    console.log("Service Worker registrado", registration);
  } catch (err) {
    console.error("Erro SW", err);
  }
}

function setupInstallPrompt() {
  const banner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-btn");
  const dismissBtn = document.getElementById("dismiss-install-btn");
  const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === "1";

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isRunningStandalone() && !dismissed) {
      banner.classList.add("show");
    }
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showNotify("No iPhone: Compartilhar > Adicionar à Tela de Início");
      return;
    }

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome === "accepted") {
      showNotify("Aplicativo instalado com sucesso");
      banner.classList.remove("show");
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    }

    deferredPrompt = null;
  });

  dismissBtn.addEventListener("click", () => {
    banner.classList.remove("show");
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  });

  window.addEventListener("appinstalled", () => {
    showNotify("Gestão Eficaz instalado na tela inicial");
    banner.classList.remove("show");
    deferredPrompt = null;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    updatePwaStatus();
  });
}

function setupRealtime() {
  client
    .channel("tarefas-realtime")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tarefas",
      },
      () => {
        fetchTasks();
      }
    )
    .subscribe();
}

function setupStandaloneMode() {
  if (isRunningStandalone()) {
    document.body.classList.add("standalone-mode");
  }
}

function preventIosZoom() {
  document.addEventListener("gesturestart", (e) => {
    e.preventDefault();
  });
}

// =====================================
// BOOT
// =====================================

document.addEventListener("DOMContentLoaded", () => {
  setupStandaloneMode();
  preventIosZoom();
  toggleFields();
  setupFormEvents();
  setupListEvents();
  setupInstallPrompt();
  updatePwaStatus();
  registerServiceWorker();
  setupRealtime();
  fetchTasks();
});
