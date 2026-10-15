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
    return settings;
  }

  function isDirty() {
    if (!saved) return false;
    return JSON.stringify(readForm()) !== JSON.stringify(saved);
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

  function renderMethodChips(s) {
    const chips = [
      ["Email", s.email.enabled],
      ["SMS", s.phone.enabled && s.phone.sms],
      ["WhatsApp", s.phone.enabled && s.phone.whatsapp],
      ["Google", s.sso.google.enabled],
      ["Apple", s.sso.apple.enabled],
      ["Facebook", s.sso.facebook.enabled],
    ];
    const root = $("#method-chips");
    root.textContent = "";
    for (const [label, on] of chips) {
      const chip = document.createElement("span");
      chip.className = `chip ${on ? "on" : "off"}`;
      chip.textContent = `${label} ${on ? "on" : "off"}`;
      root.appendChild(chip);
    }
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
    fillForm(saved);
    renderMethodChips(saved);
    renderWarnings(view.warnings);
    updateSavebar();
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
    $("#login-form [name=email]").focus();
  }

  async function showApp() {
    try {
      const { data } = await api("GET", "/api/admin/auth/me");
      $("#admin-email").textContent = data.admin.email;
      await loadSettings();
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
        email: form.email.value,
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
