"use strict";

(() => {
  const TOKEN_KEY = "adminToken";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Last saved settings from the server (secrets blank) and which secrets are set. */
  let saved = null;
  let secretsSet = {};
  /** Secret edits: path -> new value, or null to clear. */
  let secretEdits = {};
  /** Env variable sources as saved: path -> variable name, and how each resolved on the server. */
  let savedEnvRefs = {};
  let envState = {};
  let envSuggestions = {};
  let envControlsReady = false;
  let lastStatus = null;

  // ======================= Storage & API =======================

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable: token lives only in memory for this page */ }
    memoryToken = token;
  }
  let memoryToken = getToken();

  async function api(method, url, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && url !== "/api/admin/auth/login") {
      setToken(null);
      showLogin("Your session expired. Please sign in again.");
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const err = new Error(json?.message || `Request failed (${res.status})`);
      err.details = json?.details;
      throw err;
    }
    return json;
  }

  // ======================= Toast =======================

  let toastTimer;
  function toast(message, kind = "ok", details) {
    const el = $("#toast");
    el.className = `toast ${kind}`;
    el.textContent = message;
    const extra = (details || []).map((d) => d.message).filter((m) => m && m !== message);
    if (extra.length) {
      const ul = document.createElement("ul");
      for (const m of extra) {
        const li = document.createElement("li");
        li.textContent = m;
        ul.appendChild(li);
      }
      el.appendChild(ul);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 8000 : 3500);
  }

  // ======================= Path helpers =======================

  function getPath(obj, path) {
    return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let cur = obj;
    for (const k of keys.slice(0, -1)) {
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
  }

  // ======================= Form <-> settings =======================

  function fillForm(settings) {
    for (const el of $$("[data-path]")) {
      const value = getPath(settings, el.dataset.path);
      if (el.type === "checkbox") el.checked = !!value;
      else if (el.dataset.type === "lines") el.value = (value || []).join("\n");
      else el.value = value ?? "";
    }
    for (const el of $$("[data-secret]")) {
      el.value = "";
    }
    secretEdits = {};
    for (const path of Object.keys(envSuggestions)) setEnvMode(path, savedEnvRefs[path]);
    renderSecretStates();
    renderTestAccounts(settings.testAccounts || []);
    updateConditionals();
  }

  function readForm() {
    const settings = structuredClone(saved);
    for (const el of $$("[data-path]")) {
      let value;
      if (el.type === "checkbox") value = el.checked;
      else if (el.dataset.type === "number") value = el.value === "" ? undefined : Number(el.value);
      else if (el.dataset.type === "lines") value = el.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      else value = el.value.trim();
      setPath(settings, el.dataset.path, value);
    }
    settings.testAccounts = $$("#test-accounts .row")
      .map((row) => ({
        identifier: $(".ta-identifier", row).value.trim(),
        code: $(".ta-code", row).value.trim(),
      }))
      .filter((t) => t.identifier || t.code);
    // Secrets: blank keeps the saved value server-side, null clears it
    for (const el of $$("[data-secret]")) setPath(settings, el.dataset.secret, "");
    for (const [path, value] of Object.entries(secretEdits)) setPath(settings, path, value);
    settings.envRefs = readEnvRefs();
    return settings;
  }

  function sortedRefs(refs) {
    return Object.fromEntries(Object.entries(refs).sort(([a], [b]) => a.localeCompare(b)));
  }

  function isDirty() {
    if (!saved) return false;
    const current = readForm();
    current.envRefs = sortedRefs(current.envRefs);
    return JSON.stringify(current) !== JSON.stringify({ ...saved, envRefs: sortedRefs(savedEnvRefs) });
  }

  // ======================= Env variable sources =======================

  const envControls = new Map(); // path -> { toggle, row, input, badge, controls[] }

  /** Adds an "Env" toggle next to every setting the server says can come from an env variable. */
  function setupEnvControls() {
    if (envControlsReady) return;
    envControlsReady = true;
    for (const path of Object.keys(envSuggestions)) {
      const controls = $$(`[data-path="${path}"], [data-secret="${path}"]`);
      if (controls.length === 0) continue;
      const control = controls[0];

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "env-toggle";
      toggle.textContent = "Env";
      toggle.setAttribute("aria-pressed", "false");
      toggle.title = "Read this setting from a server environment variable";
      const fieldName = (control.closest(".field")?.querySelector("span")?.firstChild?.textContent ||
        control.closest(".card-row")?.querySelector("h3")?.textContent ||
        control.closest(".check")?.textContent || path).trim();
      toggle.setAttribute("aria-label", `Read ${fieldName} from an environment variable`);

      const row = document.createElement("div");
      row.className = "env-row";
      row.hidden = true;
      const prefix = document.createElement("span");
      prefix.className = "env-prefix";
      prefix.textContent = "$";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "env-name";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Environment variable for ${path}`);
      const badge = document.createElement("span");
      badge.className = "env-badge";
      badge.setAttribute("aria-live", "polite");
      row.append(prefix, input, badge);

      const field = control.closest(".field");
      const sw = control.closest(".switch");
      const check = control.closest(".check");
      if (field) {
        $("span", field).appendChild(toggle);
        field.appendChild(row);
      } else if (sw) {
        const wrap = document.createElement("div");
        wrap.className = "switch-wrap";
        sw.replaceWith(wrap);
        wrap.append(toggle, sw);
        row.classList.add("block");
        wrap.closest(".card-row").after(row);
      } else if (check) {
        const wrap = document.createElement("span");
        wrap.className = "check-wrap";
        check.replaceWith(wrap);
        wrap.append(check, toggle, row);
      } else {
        continue;
      }

      toggle.addEventListener("click", () => {
        const on = toggle.getAttribute("aria-pressed") !== "true";
        setEnvMode(path, on ? savedEnvRefs[path] || envSuggestions[path] : undefined);
        if (on) {
          input.focus();
          input.select(); // typing replaces the suggested name
        }
        updateConditionals();
        updateSavebar();
      });
      input.addEventListener("input", () => {
        input.value = input.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        renderEnvBadge(path);
      });
      envControls.set(path, { toggle, row, input, badge, controls });
    }
  }

  /** name: env variable to read, or undefined for a value saved in the panel. */
  function setEnvMode(path, name) {
    const c = envControls.get(path);
    if (!c) return;
    const on = name !== undefined;
    c.toggle.setAttribute("aria-pressed", String(on));
    c.row.hidden = !on;
    c.input.value = on ? name : "";
    for (const el of c.controls) {
      el.disabled = on;
      (el.closest(".switch") || el).classList.toggle("is-env-sourced", on);
    }
    renderEnvBadge(path);
  }

  function readEnvRefs() {
    const refs = {};
    for (const [path, c] of envControls) {
      if (c.toggle.getAttribute("aria-pressed") === "true") refs[path] = c.input.value.trim();
    }
    return refs;
  }

  function renderEnvBadge(path) {
    const c = envControls.get(path);
    if (!c || c.row.hidden) return;
    const name = c.input.value.trim();
    const state = envState[path];
    c.badge.className = "env-badge";
    if (!/^AUTH_[A-Z0-9_]{1,100}$/.test(name)) {
      c.badge.textContent = "Must start with AUTH_";
      c.badge.classList.add("invalid");
    } else if (savedEnvRefs[path] !== name || !state) {
      c.badge.textContent = "Save to check it on the server";
    } else if (!state.isSet) {
      c.badge.textContent = "✕ Not set on the server: the saved value below is used";
      c.badge.classList.add("missing");
    } else if (state.invalid) {
      c.badge.textContent = `✕ Invalid value (${state.invalid}): the saved value is used`;
      c.badge.classList.add("invalid");
    } else {
      c.badge.textContent = "✓ Set on the server, in use";
      c.badge.classList.add("set");
    }
  }

  function updateSavebar() {
    $("#savebar").hidden = !isDirty();
  }

  /** data-show-if="a.b=x|c.d=y": visible when any condition matches the current form values. */
  function updateConditionals() {
    const current = saved ? readForm() : {};
    for (const el of $$("[data-show-if]")) {
      const show = el.dataset.showIf.split("|").some((cond) => {
        const [path, expected] = cond.split("=");
        return String(getPath(current, path)) === expected;
      });
      el.hidden = !show;
    }
  }

  function renderSecretStates() {
    for (const el of $$("[data-secret-state]")) {
      const path = el.dataset.secretState;
      el.textContent = "";
      el.classList.remove("is-set");
      const edit = secretEdits[path];
      if (edit === null) {
        el.textContent = "Will be cleared on save. ";
      } else if (typeof edit === "string" && edit) {
        el.textContent = "New value will be saved. ";
      } else if (secretsSet[path]) {
        el.textContent = "Saved. Leave blank to keep it. ";
        el.classList.add("is-set");
      } else {
        el.textContent = "Not set.";
      }
      if (secretsSet[path] && edit !== null) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "btn ghost small";
        clear.textContent = "Clear";
        clear.addEventListener("click", () => {
          secretEdits[path] = null;
          $(`[data-secret="${path}"]`).value = "";
          renderSecretStates();
          updateSavebar();
        });
        el.appendChild(clear);
      }
    }
  }

  function renderTestAccounts(accounts) {
    const list = $("#test-accounts");
    list.textContent = "";
    for (const account of accounts) addTestAccountRow(account);
  }

  function addTestAccountRow(account = { identifier: "", code: "" }) {
    const row = $("#test-account-row").content.firstElementChild.cloneNode(true);
    $(".ta-identifier", row).value = account.identifier;
    $(".ta-code", row).value = account.code;
    $(".ta-remove", row).addEventListener("click", () => {
      row.remove();
      updateSavebar();
    });
    $("#test-accounts").appendChild(row);
    return row;
  }

  // ======================= Overview =======================

  function stat(value, label) {
    const div = document.createElement("div");
    div.className = "stat";
    const b = document.createElement("b");
    b.textContent = Number(value).toLocaleString();
    const span = document.createElement("span");
    span.textContent = label;
    div.append(b, span);
    return div;
  }

  function renderWarnings(warnings) {
    const root = $("#warnings");
    root.textContent = "";
    for (const w of warnings || []) {
      const div = document.createElement("div");
      div.className = "callout";
      div.textContent = w;
      root.appendChild(div);
    }
  }

  async function loadOverview() {
    try {
      const { data } = await api("GET", "/api/admin/overview");
      const u = $("#stats-users");
      u.replaceChildren(
        stat(data.users.total, "Total users"),
        stat(data.users.newLast24h, "New in 24h"),
        stat(data.activeSessions, "Active sessions"),
        stat(data.users.withPhone, "With phone"),
        stat(data.users.withVerifiedEmail, "With verified email"),
        stat(data.users.google, "Google linked"),
        stat(data.users.apple, "Apple linked"),
        stat(data.users.facebook, "Facebook linked"),
      );
      $("#stats-codes").replaceChildren(
        stat(data.codesSentLast24h.sms, "SMS"),
        stat(data.codesSentLast24h.whatsapp, "WhatsApp"),
        stat(data.codesSentLast24h.email, "Email"),
      );
    } catch (err) {
      if (err.message !== "Unauthorized") toast(err.message, "error");
    }
  }

  // ======================= Settings load/save =======================

  function applyServerView(view) {
    saved = view.settings;
    secretsSet = view.secrets || {};
    savedEnvRefs = view.envRefs || {};
    envState = view.envState || {};
    envSuggestions = view.envSuggestions || {};
    setupEnvControls();
    fillForm(saved);
    renderWarnings(view.warnings);
    updateSavebar();
  }

  // ======================= Status =======================

  const LEVEL_TEXT = { ok: "Working", warning: "Working, with warnings", error: "Not working", off: "Off" };

  function problemList(problems) {
    const ul = document.createElement("ul");
    for (const p of problems) {
      const li = document.createElement("li");
      li.className = p.level;
      li.textContent = p.message;
      ul.appendChild(li);
    }
    return ul;
  }

  function renderStatus(data) {
    lastStatus = data;
    const list = $("#status-list");
    list.textContent = "";
    for (const m of data.methods) {
      const item = document.createElement("div");
      item.className = "status-item";
      const head = document.createElement("div");
      head.className = "status-head";
      const dot = document.createElement("span");
      dot.className = `dot ${m.level}`;
      const name = document.createElement("b");
      name.textContent = m.label;
      const state = document.createElement("span");
      state.textContent = LEVEL_TEXT[m.level];
      head.append(dot, name, state);
      const summary = document.createElement("div");
      summary.className = "status-summary";
      summary.textContent = m.summary;
      item.append(head, summary);
      const extra = m.problems.filter((p) => !m.summary.includes(p.message));
      if (extra.length) item.appendChild(problemList(extra));
      list.appendChild(item);
    }
    const when = new Date(data.checkedAt).toLocaleTimeString();
    $("#status-meta").textContent = data.live
      ? `Live check at ${when}: providers were contacted to test the credentials.`
      : `Configuration check at ${when}. Run a live check to test credentials with each provider.`;
    renderWarnings(data.warnings);

    // The same status on each method's own card
    for (const line of $$("[data-status]")) {
      const m = data.methods.find((x) => x.key === line.dataset.status);
      line.className = "status-line";
      line.textContent = "";
      if (!m || m.level === "off" && m.problems.length === 0) continue;
      line.classList.add("shown", m.level === "off" ? "warning" : m.level);
      const dot = document.createElement("span");
      dot.className = `dot ${m.level}`;
      const text = document.createElement("span");
      text.textContent = `${m.label}: ${m.summary}`;
      line.append(dot, text);
      const rest = m.problems.filter((p) => !m.summary.includes(p.message));
      if (rest.length) line.appendChild(problemList(rest));
    }
  }

  let statusRequest = 0;
  async function loadStatus(live = false) {
    const id = ++statusRequest;
    const btn = $("#live-check-btn");
    if (live) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    try {
      const { data } = await api("GET", `/api/admin/settings/auth/status${live ? "?live=true" : ""}`);
      if (id === statusRequest) renderStatus(data);
    } catch (err) {
      if (err.message !== "Unauthorized") toast(err.message, "error");
    } finally {
      if (live) {
        btn.disabled = false;
        btn.textContent = "Run live check";
      }
    }
  }

  async function loadSettings() {
    const { data } = await api("GET", "/api/admin/settings/auth");
    applyServerView(data);
  }

  async function save() {
    const btn = $("#save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const { data } = await api("PUT", "/api/admin/settings/auth", readForm());
      applyServerView(data);
      toast("Settings saved");
      loadOverview();
      loadStatus(true);
    } catch (err) {
      if (err.message !== "Unauthorized") toast(err.message, "error", err.details);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }

  async function sendTest(channel, button) {
    const input = $(`[data-test-to="${channel}"]`);
    const to = input.value.trim();
    if (!to) {
      input.focus();
      toast("Enter a recipient first", "error");
      return;
    }
    if (isDirty()) {
      toast("Save your changes first: test messages use the saved settings.", "error");
      return;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      const res = await api("POST", "/api/admin/settings/auth/test-delivery", { channel, to });
      toast(res.message);
    } catch (err) {
      if (err.message !== "Unauthorized") toast(err.message, "error", err.details);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  // ======================= Navigation =======================

  function showSection() {
    const id = (location.hash || "#overview").slice(1);
    const sections = $$(".panel");
    const target = sections.find((s) => s.dataset.section === id) ? id : "overview";
    for (const s of sections) s.hidden = s.dataset.section !== target;
    for (const a of $$(".nav a")) a.classList.toggle("active", a.dataset.section === target);
    if (target === "overview") loadOverview();
    window.scrollTo(0, 0);
  }

  // ======================= Views =======================

  function showLogin(message) {
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
    const err = $("#login-error");
    err.hidden = !message;
    err.textContent = message || "";
    $("#login-form [name=username]").focus();
  }

  async function showApp() {
    try {
      const { data } = await api("GET", "/api/admin/auth/me");
      $("#admin-email").textContent = data.admin.username;
      await loadSettings();
      loadStatus(true);
    } catch (err) {
      if (err.message !== "Unauthorized") showLogin(err.message);
      return;
    }
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    showSection();
  }

  // ======================= Events =======================

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    $("#login-error").hidden = true;
    try {
      const { data } = await api("POST", "/api/admin/auth/login", {
        username: form.username.value,
        password: form.password.value,
      });
      setToken(data.token);
      form.password.value = "";
      await showApp();
    } catch (err) {
      showLogin(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("#logout-btn").addEventListener("click", () => {
    if (isDirty() && !confirm("Discard unsaved changes and sign out?")) return;
    setToken(null);
    saved = null;
    showLogin();
  });

  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api("POST", "/api/admin/auth/change-password", {
        currentPassword: form.currentPassword.value,
        newPassword: form.newPassword.value,
      });
      form.reset();
      toast("Password updated");
    } catch (err) {
      if (err.message !== "Unauthorized") toast(err.message, "error", err.details);
    }
  });

  const content = $(".content");
  const onEdit = (e) => {
    const secret = e.target.closest("[data-secret]");
    if (secret) {
      if (secret.value) secretEdits[secret.dataset.secret] = secret.value;
      else delete secretEdits[secret.dataset.secret];
      renderSecretStates();
    }
    updateConditionals();
    updateSavebar();
  };
  content.addEventListener("input", onEdit);
  content.addEventListener("change", onEdit);

  $("#add-test-account").addEventListener("click", () => {
    $(".ta-identifier", addTestAccountRow()).focus();
    updateSavebar();
  });
  $("#save-btn").addEventListener("click", save);
  $("#live-check-btn").addEventListener("click", () => loadStatus(true));
  $("#discard-btn").addEventListener("click", () => {
    fillForm(saved);
    updateSavebar();
  });
  for (const btn of $$("[data-test-channel]")) {
    btn.addEventListener("click", () => sendTest(btn.dataset.testChannel, btn));
  }

  window.addEventListener("hashchange", showSection);
  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) e.preventDefault();
  });

  if (memoryToken) showApp();
  else showLogin();
})();
