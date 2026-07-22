// =====================================
// SUPABASE
// =====================================

const supabaseUrl = "https://oxwnbjmjpxvjtfvzkdju.supabase.co";
const supabaseKey =
  "sb_publishable_oMN5FVGpCwdlllqynA1IpA_paDrG1fk";

if (!window.supabase) {
  console.error("Biblioteca Supabase não carregou (CDN bloqueada ou cache antigo).");
}

const client = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey)
  : null;

// =====================================
// STATE / KEYS
// =====================================

let tasks = [];
let editingTaskId = null;
let deferredPrompt = null;
let saving = false;
let searchDebounceTimer = null;
let connectionState = "loading"; // loading | online | offline | error | cached
let completedAtSupported = true;

const INSTALL_DISMISS_KEY = "gestao-eficaz-install-dismissed";
const TASKS_CACHE_KEY = "gestao-eficaz-tasks-cache";
const SHOW_DONE_KEY = "gestao-eficaz-show-done";
const SORT_KEY = "gestao-eficaz-sort";

const PRIORIDADE_PESO = { ALTA: 1, MEDIA: 2, BAIXA: 3 };

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
  const [a, m, d] = String(iso).split("T")[0].split("-");
  return `${d}/${m}/${a}`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function addDaysISO(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function isOverdue(task, hoje = todayISO()) {
  return task.status !== "CONCLUIDO" && !!task.end && task.end < hoje;
}

function getDeadlineTone(task, hoje = todayISO()) {
  if (task.status === "CONCLUIDO" || !task.end) return "ok";
  if (task.end < hoje) return "late";
  if (task.end === hoje) return "today";
  if (task.end === addDaysISO(1)) return "tomorrow";
  return "ok";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function setBusy(isBusy) {
  saving = isBusy;
  const btnSave = document.getElementById("btn-save");
  const btnCancel = document.getElementById("btn-cancel-edit");
  if (btnSave) btnSave.disabled = isBusy;
  if (btnCancel) btnCancel.disabled = isBusy;
}

function saveTasksCache(list) {
  try {
    localStorage.setItem(
      TASKS_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), tasks: list })
    );
  } catch (err) {
    console.warn("Falha ao salvar cache local", err);
  }
}

function loadTasksCache() {
  try {
    const raw = localStorage.getItem(TASKS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.tasks) ? parsed : null;
  } catch (err) {
    console.warn("Falha ao ler cache local", err);
    return null;
  }
}

function setConnectionStatus(state, detail = "") {
  connectionState = state;
  const el = document.getElementById("connection-status");
  if (!el) return;

  const map = {
    loading: { text: "Sincronizando…", className: "status-loading" },
    online: { text: "Online · sincronizado", className: "status-online" },
    offline: { text: "Offline", className: "status-offline" },
    error: { text: "Erro de conexão", className: "status-error" },
    cached: { text: "Offline · cache local", className: "status-cached" },
  };

  const info = map[state] || map.loading;
  el.textContent = detail ? `${info.text} · ${detail}` : info.text;
  el.className = info.className;
}

function getShowCompleted() {
  return document.getElementById("toggle-show-done")?.checked === true;
}

function getSortMode() {
  return document.getElementById("filter-sort")?.value || "prazo";
}

function getFilterValues() {
  return {
    busca: document.getElementById("search-input").value.trim().toLowerCase(),
    status: document.getElementById("filter-status").value,
    secao: document.getElementById("filter-secao").value,
    prioridade: document.getElementById("filter-prioridade").value,
    atrasadas: document.getElementById("filter-atrasadas").value,
    sort: getSortMode(),
    showDone: getShowCompleted(),
  };
}

function sortTasks(list, sortMode) {
  const copy = [...list];

  copy.sort((a, b) => {
    if (sortMode === "prioridade") {
      const pa = PRIORIDADE_PESO[a.prioridade] ?? 99;
      const pb = PRIORIDADE_PESO[b.prioridade] ?? 99;
      if (pa !== pb) return pa - pb;
      return String(a.end || "").localeCompare(String(b.end || ""));
    }

    if (sortMode === "criacao") {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    }

    // prazo (padrão): pendentes primeiro por prazo, concluídas no fim
    const aDone = a.status === "CONCLUIDO" ? 1 : 0;
    const bDone = b.status === "CONCLUIDO" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return String(a.end || "9999-99-99").localeCompare(
      String(b.end || "9999-99-99")
    );
  });

  return copy;
}

function getFilteredTasks() {
  const { busca, status, secao, prioridade, atrasadas, sort, showDone } =
    getFilterValues();
  const hoje = todayISO();

  const filtradas = tasks.filter((t) => {
    const matchBusca =
      !busca ||
      t.descricao?.toLowerCase().includes(busca) ||
      t.executor?.toLowerCase().includes(busca) ||
      t.superior?.toLowerCase().includes(busca);

    let matchStatus = status === "TODOS" || t.status === status;

    // Ocultar concluídas por padrão (exceto se filtro = Concluídos)
    if (!showDone && status !== "CONCLUIDO" && t.status === "CONCLUIDO") {
      matchStatus = false;
    }

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

  return sortTasks(filtradas, sort);
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
  document.getElementById("task-prioridade").value = "BAIXA";
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
  document.getElementById("task-prioridade").value = t.prioridade || "BAIXA";
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
  setConnectionStatus(navigator.onLine ? "loading" : "offline");

  if (!client) {
    setConnectionStatus("error", "biblioteca");
    showNotify("Falha ao carregar Supabase. Atualize com Ctrl+F5.");
    return;
  }

  if (!navigator.onLine) {
    const cached = loadTasksCache();
    if (cached) {
      tasks = cached.tasks;
      setConnectionStatus("cached", formatDataBR(cached.savedAt));
      updateStats();
      render();
      showNotify("Exibindo última lista salva (offline)");
    } else {
      setConnectionStatus("offline");
      showNotify("Sem conexão e sem cache local");
    }
    return;
  }

  try {
    const { data, error } = await client
      .from("tarefas")
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) {
      console.error(error);
      const cached = loadTasksCache();
      if (cached) {
        tasks = cached.tasks;
        setConnectionStatus("cached", "falha na nuvem");
        updateStats();
        render();
        showNotify("Erro na nuvem · usando cache local");
      } else {
        setConnectionStatus("error");
        showNotify("Erro ao carregar missões");
      }
      return;
    }

    tasks = data || [];
    saveTasksCache(tasks);
    setConnectionStatus("online", `${tasks.length} missão(ões)`);
    updateStats();
    render();
  } catch (err) {
    console.error(err);
    const cached = loadTasksCache();
    if (cached) {
      tasks = cached.tasks;
      setConnectionStatus("cached", "falha na nuvem");
      updateStats();
      render();
      showNotify("Erro na nuvem · usando cache local");
    } else {
      setConnectionStatus("error");
      showNotify("Erro ao carregar missões");
    }
  }
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

  if (!navigator.onLine) {
    showNotify("Sem conexão · não é possível salvar agora");
    return;
  }

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
      if (completedAtSupported) payload.completedAt = null;

      let { error } = await client.from("tarefas").insert([payload]);

      if (error && completedAtSupported && /completedAt/i.test(error.message || "")) {
        completedAtSupported = false;
        delete payload.completedAt;
        ({ error } = await client.from("tarefas").insert([payload]));
      }

      if (error) {
        console.error(error);
        showNotify("Erro ao salvar");
        return;
      }

      showNotify("Missão salva. Use WhatsApp se quiser compartilhar.");
      limparFormulario();
    }

    await fetchTasks();
  } finally {
    setBusy(false);
  }
}

async function deleteTask(id) {
  if (saving) return;

  if (!navigator.onLine) {
    showNotify("Sem conexão · não é possível excluir agora");
    return;
  }

  const task = tasks.find((t) => t.id === id);
  const label = task?.descricao ? `"${task.descricao}"` : "esta missão";
  const prazo = task?.end ? formatDataBR(task.end) : "sem prazo";

  if (
    !confirm(
      `Excluir permanentemente a missão ${label}?\nPrazo: ${prazo}\n\nEsta ação não pode ser desfeita.`
    )
  ) {
    return;
  }

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
  if (!navigator.onLine) {
    showNotify("Sem conexão · alteração não sincronizada");
    await fetchTasks();
    return;
  }

  let patch = { [field]: value };

  if (field === "status") {
    if (value === "CONCLUIDO") {
      patch.completedAt = new Date().toISOString();
    } else if (value === "PENDENTE") {
      patch.completedAt = null;
    }
  }

  let { error } = await client.from("tarefas").update(patch).eq("id", id);

  if (
    error &&
    patch.completedAt !== undefined &&
    /completedAt/i.test(error.message || "")
  ) {
    completedAtSupported = false;
    delete patch.completedAt;
    ({ error } = await client.from("tarefas").update(patch).eq("id", id));
  }

  if (error) {
    console.error(error);
    showNotify("Erro ao atualizar");
    await fetchTasks();
    return;
  }

  const local = tasks.find((t) => t.id === id);
  if (local) {
    Object.assign(local, patch);
  }

  saveTasksCache(tasks);
  updateStats();
  render();
}

// =====================================
// EXPORT
// =====================================

function exportCsv() {
  const lista = getFilteredTasks();

  if (lista.length === 0) {
    showNotify("Nada para exportar com os filtros atuais");
    return;
  }

  const headers = [
    "id",
    "descricao",
    "executor",
    "secao",
    "prioridade",
    "status",
    "prazo",
    "superior",
    "exigeFeedback",
    "statusFeedback",
    "anotacoes",
    "criadoEm",
    "concluidoEm",
  ];

  const rows = lista.map((t) =>
    [
      t.id,
      t.descricao,
      t.executor,
      t.secao,
      t.prioridade,
      t.status,
      t.end,
      t.superior,
      t.exigeFeedbackSup,
      t.statusFeedbackSup,
      t.feedback,
      t.createdAt,
      t.completedAt || "",
    ]
      .map(csvEscape)
      .join(";")
  );

  const csv = `\uFEFF${headers.join(";")}\n${rows.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gestao-eficaz-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showNotify(`Exportadas ${lista.length} missão(ões)`);
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
    `ORDEM DE MISSÃO - 8º BAEP\n\n` +
    `Missão: ${t.descricao}\n` +
    `Executor: ${t.executor}\n` +
    `Seção: ${t.secao}\n` +
    `Prioridade: ${t.prioridade}\n` +
    `Prazo: ${formatDataBR(t.end)}\n` +
    (t.temSuperior === "SIM" ? `Superior: ${t.superior}\n` : "") +
    `Status: ${t.status}`;

  openWhatsApp(msg);
}

// =====================================
// RENDER
// =====================================

function deadlineBadges(tone) {
  if (tone === "late") return '<span class="badge badge-danger">Atrasada</span>';
  if (tone === "today") return '<span class="badge badge-today">Vence hoje</span>';
  if (tone === "tomorrow")
    return '<span class="badge badge-tomorrow">Vence amanhã</span>';
  return "";
}

function render() {
  const tbody = document.getElementById("task-list");
  const empty = document.getElementById("empty-state");
  const filtradas = getFilteredTasks();
  const hoje = todayISO();
  const hiddenDoneCount = getShowCompleted()
    ? 0
    : tasks.filter((t) => t.status === "CONCLUIDO").length;

  tbody.innerHTML = "";

  if (filtradas.length === 0) {
    empty.hidden = false;
    empty.querySelector("strong").textContent =
      tasks.length === 0
        ? "Nenhuma missão cadastrada"
        : "Nenhuma missão encontrada";

    let hint =
      tasks.length === 0
        ? "Lance a primeira ordem de missão no formulário acima."
        : "Ajuste a busca ou os filtros para ver resultados.";

    if (hiddenDoneCount > 0 && !getShowCompleted()) {
      hint += ` Há ${hiddenDoneCount} concluída(s) oculta(s).`;
    }

    empty.querySelector("span").textContent = hint;
    return;
  }

  empty.hidden = true;

  filtradas.forEach((t) => {
    const tone = getDeadlineTone(t, hoje);
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

    const completedInfo =
      t.status === "CONCLUIDO" && t.completedAt
        ? `<div class="mission-completed">Concluída em ${escapeHtml(
            formatDataBR(t.completedAt)
          )}</div>`
        : "";

    tr.innerHTML = `
      <td>
        <select data-action="status" data-id="${escapeHtml(t.id)}" aria-label="Status da missão">
          <option value="PENDENTE" ${t.status === "PENDENTE" ? "selected" : ""}>
            Pendente
          </option>
          <option value="CONCLUIDO" ${t.status === "CONCLUIDO" ? "selected" : ""}>
            Concluído
          </option>
        </select>
      </td>
      <td>
        <span class="badge">${escapeHtml(t.secao)}</span>
        <span class="badge">${escapeHtml(t.prioridade)}</span>
        ${deadlineBadges(tone)}
        ${
          t.exigeFeedbackSup === "SIM" && t.statusFeedbackSup === "NAO"
            ? '<span class="badge badge-info">Feedback pendente</span>'
            : ""
        }
        <div class="mission-title">${escapeHtml(t.descricao)}</div>
        <div class="mission-meta">Responsável: ${escapeHtml(t.executor)}</div>
        ${
          t.temSuperior === "SIM"
            ? `<div class="mission-superior">Superior: ${escapeHtml(t.superior)}</div>`
            : ""
        }
        ${completedInfo}
        ${feedbackBlock}
      </td>
      <td class="deadline-${tone}">
        ${escapeHtml(formatDataBR(t.end))}
      </td>
      <td>
        <textarea
          data-action="feedback"
          data-id="${escapeHtml(t.id)}"
          rows="3"
          aria-label="Anotações"
        >${escapeHtml(t.feedback || "")}</textarea>
      </td>
      <td>
        <div class="action-row">
          <button type="button" class="btn-sm btn-edit" data-action="edit" data-id="${escapeHtml(t.id)}">
            Editar
          </button>
          <button type="button" class="btn-sm btn-wa" data-action="wa" data-id="${escapeHtml(t.id)}" title="Compartilhar no WhatsApp">
            WhatsApp
          </button>
          <button type="button" class="btn-sm btn-del" data-action="del" data-id="${escapeHtml(t.id)}">
            Excluir
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

function persistListPrefs() {
  localStorage.setItem(SHOW_DONE_KEY, getShowCompleted() ? "1" : "0");
  localStorage.setItem(SORT_KEY, getSortMode());
}

function restoreListPrefs() {
  const showDone = localStorage.getItem(SHOW_DONE_KEY) === "1";
  const sort = localStorage.getItem(SORT_KEY) || "prazo";
  const toggle = document.getElementById("toggle-show-done");
  const sortEl = document.getElementById("filter-sort");
  if (toggle) toggle.checked = showDone;
  if (sortEl) sortEl.value = sort;
}

function setupFormEvents() {
  document
    .getElementById("task-tem-superior")
    .addEventListener("change", toggleFields);

  document.getElementById("btn-save").addEventListener("click", addTask);
  document
    .getElementById("btn-cancel-edit")
    .addEventListener("click", cancelEdit);

  document.getElementById("mission-form").addEventListener("submit", (e) => {
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

  [
    "filter-status",
    "filter-secao",
    "filter-prioridade",
    "filter-atrasadas",
    "filter-sort",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      persistListPrefs();
      render();
    });
  });

  document.getElementById("toggle-show-done").addEventListener("change", () => {
    persistListPrefs();
    render();
  });

  document.getElementById("btn-export-csv").addEventListener("click", exportCsv);

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
}

function setupConnectionWatchers() {
  window.addEventListener("online", () => {
    showNotify("Conexão restabelecida");
    fetchTasks();
  });

  window.addEventListener("offline", () => {
    setConnectionStatus(tasks.length ? "cached" : "offline");
    showNotify("Você está offline");
  });
}

// =====================================
// PWA
// =====================================

function exitApp() {
  if (!confirm("Deseja sair do Gestão Eficaz?")) return;

  // Em modo app (PWA), tenta fechar a janela
  window.close();

  // Navegadores bloqueiam close() em abas normais
  setTimeout(() => {
    if (!window.closed) {
      showNotify("Feche esta aba ou use o gerenciador de apps do celular.");
    }
  }, 150);
}

function setupExitButton() {
  const btn = document.getElementById("btn-sair");
  if (!btn) return;
  btn.addEventListener("click", exitApp);
}

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
    ? "Aplicativo instalado"
    : "Pronto para instalar";
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
  if (!client) return;

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
  try {
    setupStandaloneMode();
    preventIosZoom();
    restoreListPrefs();
    toggleFields();
    setupFormEvents();
    setupListEvents();
    setupExitButton();
    setupConnectionWatchers();
    setupInstallPrompt();
    updatePwaStatus();
    registerServiceWorker();
    setupRealtime();

    const cached = loadTasksCache();
    if (cached?.tasks?.length) {
      tasks = cached.tasks;
      updateStats();
      render();
      setConnectionStatus("loading", "atualizando…");
    }

    fetchTasks();
  } catch (err) {
    console.error("Falha na inicialização", err);
    setConnectionStatus("error", "app");
    showNotify("Erro ao iniciar o app. Atualize com Ctrl+F5.");
  }
});
