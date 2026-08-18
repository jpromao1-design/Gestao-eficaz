const supabaseUrl = "https://oxwnbjmjpxvjtfvzkdju.supabase.co";
const supabaseKey =
  "sb_publishable_oMN5FVGpCwdlllqynA1IpA_paDrG1fk";

if (!window.supabase) {
  console.error("Biblioteca Supabase não carregou (CDN bloqueada ou cache antigo).");
}

const client = window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey)
  : null;

let tasks = [];
let deferredPrompt = null;
let saving = false;
let currentSession = null;
let completedAtSupported = true;
let fetchingTasks = false;
let realtimeReady = false;
let realtimeTimer = null;

const formState = {
  secao: "NENHUMA",
  tipo: "PROFISSIONAL",
};

const INSTALL_DISMISS_KEY = "gestao-eficaz-install-dismissed";
const TASKS_CACHE_KEY = "gestao-eficaz-tasks-cache";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showNotify(msg, type = "info") {
  const host = document.getElementById("toast-host");
  if (!host) return;

  const div = document.createElement("div");
  div.className = `notification toast-${type}`;
  div.textContent = msg;
  host.appendChild(div);

  setTimeout(() => {
    div.classList.add("toast-out");
    setTimeout(() => div.remove(), 220);
  }, 2800);
}

function formatDataBR(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).split("T")[0].split("-");
  return `${d}/${m}/${a}`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function activeTasks() {
  return tasks
    .filter((t) => t.status !== "CONCLUIDO")
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function setBusy(isBusy) {
  saving = isBusy;
  const btnSave = document.getElementById("btn-save");
  const authSubmit = document.getElementById("auth-submit");

  if (btnSave) {
    btnSave.disabled = isBusy;
    btnSave.textContent = isBusy ? "Salvando…" : "Salvar";
  }
  if (authSubmit) {
    authSubmit.disabled = isBusy;
    authSubmit.textContent = isBusy ? "Entrando…" : "Entrar";
  }
}

function setChipValue(group, value) {
  formState[group] = value;
  document.querySelectorAll(`[data-chip-group="${group}"] .chip`).forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.value === value);
  });
}

function resetForm() {
  const input = document.getElementById("task-descricao");
  const deadline = document.getElementById("task-deadline");
  if (input) input.value = "";
  if (deadline) deadline.value = "";
  setChipValue("secao", "NENHUMA");
  setChipValue("tipo", "PROFISSIONAL");
}

function pulseSaveButton() {
  const btn = document.getElementById("btn-save");
  if (!btn) return;
  btn.classList.remove("is-saved");
  void btn.offsetWidth;
  btn.classList.add("is-saved");
}

function updateOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  banner.hidden = navigator.onLine;
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
  const el = document.getElementById("connection-status");
  if (!el) return;

  const map = {
    loading: { text: "Sincronizando…", className: "status-loading" },
    online: { text: "Online", className: "status-online" },
    offline: { text: "Offline", className: "status-offline" },
    error: { text: "Erro de conexão", className: "status-error" },
    cached: { text: "Cache local", className: "status-cached" },
  };

  const info = map[state] || map.loading;
  el.textContent = detail ? `${info.text} · ${detail}` : info.text;
  el.className = info.className;
}

function updateListMeta() {
  const meta = document.getElementById("list-meta");
  if (!meta) return;
  const count = activeTasks().length;
  meta.textContent = count ? `${count}` : "";
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function setAuthUI(session) {
  currentSession = session;
  const authScreen = document.getElementById("auth-screen");
  const appShell = document.getElementById("app-shell");

  if (session) {
    authScreen.hidden = true;
    appShell.hidden = false;
    setTimeout(() => document.getElementById("task-descricao")?.focus(), 80);
  } else {
    appShell.hidden = true;
    authScreen.hidden = false;
    const password = document.getElementById("auth-password");
    if (password) password.value = "";
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (!client || saving) return;

  showAuthError("");
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;

  if (!email || !password) {
    showAuthError("Informe e-mail e senha.");
    return;
  }

  setBusy(true);
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(error);
      showAuthError(
        error.message?.includes("Invalid login")
          ? "E-mail ou senha inválidos."
          : "Não foi possível entrar. Verifique as credenciais."
      );
      return;
    }

    setAuthUI(data.session);
    showNotify("Sessão iniciada", "success");
    await bootAuthenticatedApp();
  } finally {
    setBusy(false);
  }
}

async function handleLogout() {
  if (!confirm("Encerrar sessão e sair?")) return;

  if (client) {
    await client.auth.signOut();
  }

  tasks = [];
  setAuthUI(null);
  showNotify("Sessão encerrada", "info");
}

function togglePasswordVisibility() {
  const input = document.getElementById("auth-password");
  const btn = document.getElementById("btn-toggle-password");
  const icon = document.getElementById("toggle-password-icon");
  if (!input || !btn || !icon) return;

  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  icon.textContent = showing ? "👁" : "🙈";
  btn.setAttribute("aria-label", showing ? "Mostrar senha" : "Ocultar senha");
  btn.title = showing ? "Mostrar senha" : "Ocultar senha";
}

function setupAuth() {
  document.getElementById("auth-form").addEventListener("submit", handleLogin);
  document.getElementById("btn-sair").addEventListener("click", handleLogout);
  document
    .getElementById("btn-toggle-password")
    .addEventListener("click", togglePasswordVisibility);

  if (!client) {
    showAuthError("Biblioteca Supabase não carregou. Atualize com Ctrl+F5.");
    setAuthUI(null);
    return;
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") setAuthUI(null);
    if (event === "TOKEN_REFRESHED") currentSession = session;
  });
}

async function resolveInitialSession() {
  if (!client) {
    setAuthUI(null);
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error(error);
    setAuthUI(null);
    return null;
  }

  setAuthUI(data.session);
  return data.session;
}

async function fetchTasks({ silent = false } = {}) {
  if (fetchingTasks) return;
  fetchingTasks = true;

  updateOfflineBanner();
  setConnectionStatus(navigator.onLine ? "loading" : "offline");

  try {
    if (!client) {
      setConnectionStatus("error", "biblioteca");
      showNotify("Falha ao carregar Supabase. Atualize com Ctrl+F5.", "error");
      render();
      return;
    }

    if (!navigator.onLine) {
      const cached = loadTasksCache();
      if (cached) {
        tasks = cached.tasks;
        setConnectionStatus("cached", formatDataBR(cached.savedAt));
        render();
      } else {
        setConnectionStatus("offline");
        if (!silent) showNotify("Sem conexão e sem cache local", "error");
        render();
      }
      return;
    }

    const { data, error } = await client
      .from("tarefas")
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) {
      console.error(error);

      if (error.code === "PGRST301" || /JWT|auth/i.test(error.message || "")) {
        showNotify("Sessão expirada. Entre novamente.", "error");
        await client.auth.signOut();
        setAuthUI(null);
        return;
      }

      const cached = loadTasksCache();
      if (cached) {
        tasks = cached.tasks;
        setConnectionStatus("cached", "falha na nuvem");
        render();
        showNotify("Erro na nuvem · usando cache local", "error");
      } else {
        setConnectionStatus("error");
        showNotify("Erro ao carregar missões", "error");
        render();
      }
      return;
    }

    tasks = data || [];
    saveTasksCache(tasks);
    setConnectionStatus("online");
    render();
  } catch (err) {
    console.error(err);
    const cached = loadTasksCache();
    if (cached) {
      tasks = cached.tasks;
      setConnectionStatus("cached");
      render();
      showNotify("Erro na nuvem · usando cache local", "error");
    } else {
      setConnectionStatus("error");
      showNotify("Erro ao carregar missões", "error");
      render();
    }
  } finally {
    fetchingTasks = false;
  }
}

async function addTask() {
  if (saving) return;

  if (!navigator.onLine) {
    showNotify("Sem conexão · não é possível salvar agora", "error");
    return;
  }

  const input = document.getElementById("task-descricao");
  const descricao = input.value.trim();
  if (!descricao) {
    input.focus();
    return;
  }

  setBusy(true);

  try {
    const prazo = document.getElementById("task-deadline").value || todayISO();
    const payload = {
      id: crypto.randomUUID(),
      descricao,
      category: formState.tipo,
      secao: formState.secao,
      prioridade: "BAIXA",
      temSuperior: "NAO",
      superior: "",
      exigeFeedbackSup: "NAO",
      executor: "Não definido",
      start: todayISO(),
      end: prazo,
      status: "PENDENTE",
      feedback: "",
      statusFeedbackSup: "NAO",
      createdAt: new Date().toISOString(),
    };

    if (completedAtSupported) {
      payload.completedAt = null;
    }

    let { error } = await client.from("tarefas").insert([payload]);

    if (error && completedAtSupported && /completedAt/i.test(error.message || "")) {
      completedAtSupported = false;
      delete payload.completedAt;
      ({ error } = await client.from("tarefas").insert([payload]));
    }

    if (error) {
      console.error(error);
      showNotify("Erro ao salvar", "error");
      return;
    }

    resetForm();
    pulseSaveButton();
    input.focus();
    showNotify("Missão cadastrada", "success");
    await fetchTasks({ silent: true });
  } finally {
    setBusy(false);
  }
}

async function completeTask(id) {
  if (!navigator.onLine) {
    showNotify("Sem conexão · não é possível concluir agora", "error");
    return;
  }

  const item = document.querySelector(`.mission-item[data-id="${id}"]`);
  if (item) item.classList.add("is-done");

  const patch = { status: "CONCLUIDO" };
  if (completedAtSupported) patch.completedAt = new Date().toISOString();

  let { error } = await client.from("tarefas").update(patch).eq("id", id);

  if (error && /completedAt/i.test(error.message || "")) {
    completedAtSupported = false;
    delete patch.completedAt;
    ({ error } = await client.from("tarefas").update(patch).eq("id", id));
  }

  if (error) {
    console.error(error);
    if (item) item.classList.remove("is-done");
    showNotify("Erro ao concluir", "error");
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 260));
  tasks = tasks.filter((t) => t.id !== id);
  saveTasksCache(tasks);
  render();
  showNotify("Missão cumprida", "success");
}

function render() {
  const list = document.getElementById("task-list");
  if (!list) return;

  const items = activeTasks();
  updateListMeta();
  list.innerHTML = "";

  items.forEach((t) => {
    const li = document.createElement("li");
    li.className = "mission-item";
    li.dataset.id = t.id;
    const isPro = t.category !== "PESSOAL";
    li.className = `mission-item ${isPro ? "is-pro" : "is-pes"}`;
    const secaoLabel = t.secao && t.secao !== "NENHUMA" ? t.secao : "Geral";
    const prazoLabel = t.end ? formatDataBR(t.end) : "";
    li.innerHTML = `
      <div class="mission-body">
        <div class="mission-title">${escapeHtml(t.descricao)}</div>
        <div class="mission-meta">
          <span class="meta-chip ${isPro ? "is-pro" : "is-pes"}">${isPro ? "Profissional" : "Pessoal"}</span>
          <span class="meta-chip">${escapeHtml(secaoLabel)}</span>
          ${prazoLabel ? `<span class="meta-chip">${escapeHtml(prazoLabel)}</span>` : ""}
        </div>
      </div>
      <button
        type="button"
        class="btn-done"
        data-action="done"
        data-id="${escapeHtml(t.id)}"
        title="Concluir e remover"
        aria-label="Concluir missão"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </button>
    `;
    list.appendChild(li);
  });
}

function setupFormEvents() {
  document.getElementById("mission-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addTask();
  });

  document.querySelectorAll("[data-chip-group]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      setChipValue(group.dataset.chipGroup, chip.dataset.value);
    });
  });
}

function setupListEvents() {
  document.getElementById("task-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='done']");
    if (!btn) return;
    completeTask(btn.dataset.id);
  });
}

function setupConnectionWatchers() {
  window.addEventListener("online", () => {
    updateOfflineBanner();
    showNotify("Conexão restabelecida", "success");
    if (currentSession) fetchTasks({ silent: true });
  });

  window.addEventListener("offline", () => {
    updateOfflineBanner();
    setConnectionStatus(tasks.length ? "cached" : "offline");
    showNotify("Você está offline", "info");
  });
}

function isRunningStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (err) {
    console.error("Erro SW", err);
  }
}

function setupInstallPrompt() {
  const banner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-btn");
  const dismissBtn = document.getElementById("dismiss-install-btn");
  if (!banner || !installBtn || !dismissBtn) return;

  const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === "1";

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isRunningStandalone() && !dismissed) banner.classList.add("show");
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showNotify("No iPhone: Compartilhar > Adicionar à Tela de Início", "info");
      return;
    }

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      showNotify("Aplicativo instalado", "success");
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
    banner.classList.remove("show");
    deferredPrompt = null;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
  });
}

function setupRealtime() {
  if (!client || realtimeReady) return;
  realtimeReady = true;

  client
    .channel("tarefas-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tarefas" },
      () => {
        if (!currentSession) return;
        clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(() => fetchTasks({ silent: true }), 250);
      }
    )
    .subscribe();
}

function setupStandaloneMode() {
  if (isRunningStandalone()) document.body.classList.add("standalone-mode");
}

function preventIosZoom() {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

async function bootAuthenticatedApp() {
  updateOfflineBanner();
  setupRealtime();

  const cached = loadTasksCache();
  if (cached?.tasks?.length) {
    tasks = cached.tasks;
    render();
    setConnectionStatus("loading", "atualizando…");
  }

  await fetchTasks();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    setupStandaloneMode();
    preventIosZoom();
    setupAuth();
    setupFormEvents();
    setupListEvents();
    setupConnectionWatchers();
    setupInstallPrompt();
    registerServiceWorker();

    const session = await resolveInitialSession();
    if (session) await bootAuthenticatedApp();
  } catch (err) {
    console.error("Falha na inicialização", err);
    showNotify("Erro ao iniciar o app. Atualize com Ctrl+F5.", "error");
    setAuthUI(null);
  }
});
