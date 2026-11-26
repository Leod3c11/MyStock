(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
  const fmtNum = n => Number(n || 0).toLocaleString("pt-BR");

  /* ===================== STATE ===================== */
  const state = {
    screen: "dashboard",
    config: {
      operador: "Operador 01",
      deposito: "CD Principal · Standalone",
      dias_alerta: 30,
      som_ativo: true,
      vibracao_ativa: true
    },
    endFilter: "todos",
    enderecosCache: [],
    endDetalheAtual: null,
    produtosCache: [],
    entCurrentQc: 0,
    ordDraft: [],
    ordAtualNumero: null,
    sepPreview: null,
    sepOrderContext: null, // { pedido_id, pedido_item_id, pedido_numero }
    chkNumeroAtual: null,
    taskStatusFilter: "",
    alertFilter: "TODOS",
    alertsCache: [],
    movTypeFilter: "TODOS",
    scanner: null,
    scannerActive: false,
    scannerOnResult: null,
    pendingCameraRetry: null,
    confirmCallback: null
  };

  const ROOT_TABS = new Set(["dashboard", "operacoes", "estoque", "catalogo", "gestao"]);
  const PARENT_MAP = {
    cadastro: "catalogo",
    enderecos: "catalogo",
    "endereco-detalhe": "enderecos",
    entrada: "operacoes",
    pedidos: "operacoes",
    "ordem-detalhe": "pedidos",
    separacao: "operacoes",
    checkout: "operacoes",
    transferencia: "operacoes",
    inventario: "operacoes",
    alertas: "dashboard",
    movimentacoes: "gestao"
  };

  /* ===================== NATIVE BRIDGE ===================== */
  function call(method, payload = "") {
    if (!window.MyStock || typeof window.MyStock[method] !== "function") {
      throw new Error("Ambiente Android MyStock indisponível (" + method + ").");
    }
    let raw;
    if (arguments.length === 1) {
      raw = window.MyStock[method]();
    } else {
      const arg = typeof payload === "string" ? payload : JSON.stringify(payload);
      raw = window.MyStock[method](arg);
    }
    const data = JSON.parse(raw);
    if (!data.ok) throw new Error(data.error || "Falha na operação.");
    return data;
  }

  function vibrate(ms = 35) {
    try {
      if (state.config.vibracao_ativa && window.MyStock && typeof window.MyStock.vibrar === "function") {
        window.MyStock.vibrar(ms);
      }
    } catch (_) {}
  }

  /* ===================== AUDIO FEEDBACK ===================== */
  let audioCtx = null;
  function prepareAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (_) {}
  }

  function playBeep(freq = 1850, dur = 0.11) {
    if (!state.config.som_ativo) return;
    try {
      prepareAudio();
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.85, audioCtx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + dur + 0.01);
    } catch (_) {}
  }

  /* ===================== TOAST & MESSAGES ===================== */
  let toastTimer = null;
  function toast(text, type = "ok") {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast show " + type;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3100);
  }

  function setMsg(id, text, type = "ok") {
    const el = $(id);
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.className = "msg";
      return;
    }
    el.textContent = text;
    el.className = "msg " + type;
  }

  /* ===================== MODALS & DIALOGS ===================== */
  function openConfirm({ title, body, okLabel = "Confirmar", danger = false, promptLabel = null, promptValue = "", onConfirm }) {
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    const okBtn = $("btnConfirmOk");
    okBtn.textContent = okLabel;
    okBtn.className = danger ? "btn btn-danger" : "btn";
    if (promptLabel) {
      $("confirmPromptWrap").style.display = "block";
      $("confirmPromptLabel").textContent = promptLabel;
      $("confirmPromptInput").value = promptValue;
    } else {
      $("confirmPromptWrap").style.display = "none";
      $("confirmPromptInput").value = "";
    }
    state.confirmCallback = onConfirm;
    $("confirmModal").classList.add("open");
    if (promptLabel) setTimeout(() => $("confirmPromptInput").focus(), 100);
  }

  function closeConfirm() {
    $("confirmModal").classList.remove("open");
    state.confirmCallback = null;
  }

  function openPicker(title, html, onBind) {
    $("pickerTitle").textContent = title;
    $("pickerBody").innerHTML = html;
    $("pickerModal").classList.add("open");
    if (onBind) onBind($("pickerBody"));
  }

  function closePicker() {
    $("pickerModal").classList.remove("open");
  }

  /* ===================== UNIFIED OFFLINE SCANNER ===================== */
  function supportedFormats() {
    if (!window.Html5QrcodeSupportedFormats) return undefined;
    const F = window.Html5QrcodeSupportedFormats;
    return [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.DATA_MATRIX];
  }

  async function stopScanner() {
    state.scannerActive = false;
    const sc = state.scanner;
    state.scanner = null;
    if (sc) {
      try { await sc.stop(); } catch (_) {}
      try { sc.clear(); } catch (_) {}
    }
    $("scannerReader").innerHTML = "";
    $("scannerModal").classList.remove("open");
  }

  async function openScanner(title, onResult) {
    prepareAudio();
    state.scannerOnResult = onResult;
    $("scannerTitle").textContent = title || "Leitor de Código / QR";
    setMsg("scannerStatusMsg", "", "ok");
    $("scannerReader").innerHTML = "";
    $("scannerModal").classList.add("open");

    if (window.MyStock && typeof window.MyStock.temPermissaoCamera === "function" && !window.MyStock.temPermissaoCamera()) {
      setMsg("scannerStatusMsg", "Solicitando permissão da câmera...", "info");
      state.pendingCameraRetry = () => startScannerStream();
      window.MyStock.solicitarPermissaoCamera();
      return;
    }
    await startScannerStream();
  }

  async function startScannerStream() {
    if (!window.Html5Qrcode) {
      setMsg("scannerStatusMsg", "Módulo de leitura indisponível.", "err");
      return;
    }
    try {
      const sc = new Html5Qrcode("scannerReader");
      state.scanner = sc;
      state.scannerActive = true;
      await sc.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 250, height: 170 }, formatsToSupport: supportedFormats() },
        async decodedText => {
          if (!state.scannerActive) return;
          const code = String(decodedText || "").trim();
          playBeep(1900, 0.11);
          vibrate(45);
          const cb = state.scannerOnResult;
          await stopScanner();
          if (cb) cb(code);
        }
      );
    } catch (err) {
      setMsg("scannerStatusMsg", "Não foi possível abrir a câmera. Verifique as permissões do aplicativo.", "err");
      state.scannerActive = false;
      state.scanner = null;
    }
  }

  window.onCameraPermissionResult = function (granted) {
    if (granted && state.pendingCameraRetry) {
      const fn = state.pendingCameraRetry;
      state.pendingCameraRetry = null;
      fn();
    } else if (!granted && $("scannerModal").classList.contains("open")) {
      state.pendingCameraRetry = null;
      setMsg("scannerStatusMsg", "Permissão de câmera negada. Libere o acesso nas configurações do Android.", "err");
    }
  };

  /* ===================== NAVIGATION ===================== */
  function navigate(target, opts = {}) {
    if (state.scannerActive) stopScanner();
    closePicker();

    const destEl = $("screen-" + target);
    if (!destEl) return;

    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    destEl.classList.add("active");
    state.screen = target;

    // Highlight active bottom nav tab
    let navTab = target;
    while (!ROOT_TABS.has(navTab) && PARENT_MAP[navTab]) {
      navTab = PARENT_MAP[navTab];
    }
    document.querySelectorAll(".nav-item").forEach(n => {
      n.classList.toggle("active", n.dataset.nav === navTab);
    });

    window.scrollTo(0, 0);

    // Load data for target screen
    if (target === "dashboard") loadDashboard();
    else if (target === "estoque") loadStock();
    else if (target === "catalogo") loadCatalog();
    else if (target === "enderecos") loadAddresses();
    else if (target === "pedidos") loadOrders();
    else if (target === "checkout") loadCheckoutOrders();
    else if (target === "transferencia") {
      if (opts.tab === "tarefas") switchTransferTab("tarefas");
      else loadMoveTasks();
    }
    else if (target === "alertas") loadAlerts();
    else if (target === "movimentacoes") loadMovements();
    else if (target === "gestao") loadConfigScreen();
    else if (target === "separacao" && !opts.keepContext) {
      resetSeparationContext();
    }
  }

  window.handleAndroidBack = function () {
    if ($("scannerModal").classList.contains("open")) {
      stopScanner();
      return "handled";
    }
    if ($("confirmModal").classList.contains("open")) {
      closeConfirm();
      return "handled";
    }
    if ($("editProdModal").classList.contains("open")) {
      $("editProdModal").classList.remove("open");
      return "handled";
    }
    if ($("pickerModal").classList.contains("open")) {
      closePicker();
      return "handled";
    }
    if (state.screen === "separacao" && state.sepOrderContext) {
      const ordNo = state.sepOrderContext.pedido_numero;
      resetSeparationContext();
      openOrderDetail(ordNo);
      return "handled";
    }
    if (PARENT_MAP[state.screen]) {
      navigate(PARENT_MAP[state.screen]);
      return "handled";
    }
    if (state.screen !== "dashboard") {
      navigate("dashboard");
      return "handled";
    }
    return "exit";
  };

  /* ===================== THEMES & CONFIG ===================== */
  const THEMES = [
    {
      id: "light",
      name: "Corporativo Claro",
      desc: "Cabeçalho navy executivo com superfícies claras",
      swatchTop: "#0F172A",
      swatchBottom: "#F1F5F9",
      accent: "#1D4ED8",
      native: { header: "#0F172A", nav: "#FFFFFF", bg: "#F1F5F9", lightNav: true }
    },
    {
      id: "dark",
      name: "Noturno Executivo",
      desc: "Alto contraste escuro ideal para galpões e turnos noturnos",
      swatchTop: "#0B1120",
      swatchBottom: "#111827",
      accent: "#3B82F6",
      native: { header: "#0B1120", nav: "#0F172A", bg: "#090E1A", lightNav: false }
    },
    {
      id: "system",
      name: "Automático (Android)",
      desc: "Alterna entre Claro e Escuro conforme o sistema",
      swatchTop: "#0F172A",
      swatchBottom: "#334155",
      accent: "#38BDF8",
      native: null
    },
    {
      id: "emerald",
      name: "Industrial Esmeralda",
      desc: "Paleta verde-floresta para logística e saúde",
      swatchTop: "#064E3B",
      swatchBottom: "#ECFDF5",
      accent: "#059669",
      native: { header: "#064E3B", nav: "#FFFFFF", bg: "#F1F5F9", lightNav: true }
    },
    {
      id: "graphite",
      name: "Executivo Grafite",
      desc: "Visual monocromático de alto contraste",
      swatchTop: "#18181B",
      swatchBottom: "#F4F4F5",
      accent: "#0284C7",
      native: { header: "#18181B", nav: "#FFFFFF", bg: "#F4F4F5", lightNav: true }
    }
  ];

  const darkMediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function resolveThemeDef(themeId) {
    if (themeId === "system") {
      const prefersDark = darkMediaQuery && darkMediaQuery.matches;
      return THEMES.find(t => t.id === (prefersDark ? "dark" : "light")) || THEMES[0];
    }
    return THEMES.find(t => t.id === themeId) || THEMES[0];
  }

  function applyTheme(themeId, persist = false) {
    const selectedId = THEMES.some(t => t.id === themeId) ? themeId : "light";
    state.config.tema = selectedId;
    const effective = resolveThemeDef(selectedId);
    document.documentElement.setAttribute("data-theme", effective.id);

    // Update header sun/moon icon
    const themeBtn = $("headerThemeBtn");
    if (themeBtn) {
      themeBtn.innerHTML = effective.id === "dark"
        ? `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`
        : `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
    }

    // Sync Android native status bar & navigation bar colors
    try {
      if (window.MyStock && typeof window.MyStock.aplicarTemaNativo === "function" && effective.native) {
        window.MyStock.aplicarTemaNativo(
          effective.native.header,
          effective.native.nav,
          effective.native.bg,
          !!effective.native.lightNav
        );
      }
      if (persist && window.MyStock && typeof window.MyStock.salvarTema === "function") {
        call("salvarTema", selectedId);
      }
    } catch (_) {}

    const badge = $("gestaoThemeBadge");
    const meta = THEMES.find(t => t.id === selectedId) || THEMES[0];
    if (badge) badge.textContent = meta.name;
    renderThemeGrid($("gestaoThemeGrid"));
  }

  function buildThemeOptionsHtml() {
    const activeId = state.config.tema || "light";
    return `<div class="theme-grid">` + THEMES.map(t => {
      const active = t.id === activeId;
      return `<button type="button" class="theme-option${active ? " active" : ""}" data-select-theme="${t.id}">
        <div class="theme-swatch">
          <div style="background:${t.swatchTop}"></div>
          <div style="background:${t.swatchBottom};border-top:3px solid ${t.accent}"></div>
        </div>
        <div class="theme-option-body">
          <strong>${esc(t.name)}</strong>
          <span>${esc(t.desc)}</span>
        </div>
        <div class="theme-check">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
      </button>`;
    }).join("") + `</div>`;
  }

  function renderThemeGrid(container) {
    if (!container) return;
    container.innerHTML = buildThemeOptionsHtml();
    container.querySelectorAll("[data-select-theme]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.selectTheme;
        applyTheme(id, true);
        vibrate(25);
        const t = THEMES.find(x => x.id === id);
        toast("Tema alterado: " + (t ? t.name : id), "ok");
      };
    });
  }

  function openThemeModal() {
    openPicker("Tema do Aplicativo", buildThemeOptionsHtml(), body => {
      body.querySelectorAll("[data-select-theme]").forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.selectTheme;
          applyTheme(id, true);
          vibrate(25);
          closePicker();
          const t = THEMES.find(x => x.id === id);
          toast("Tema alterado: " + (t ? t.name : id), "ok");
        };
      });
    });
  }

  if (darkMediaQuery && darkMediaQuery.addEventListener) {
    darkMediaQuery.addEventListener("change", () => {
      if (state.config.tema === "system") applyTheme("system", false);
    });
  }

  function computeInitials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w));
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return "OP";
  }

  function loadConfig() {
    try {
      const cfg = call("obterConfig");
      state.config = cfg;
      $("headerDeposito").textContent = cfg.deposito || "CD Principal · Standalone";
      $("dashOperadorTag").textContent = cfg.operador || "Operador 01";
      $("headerOperatorBtn").textContent = computeInitials(cfg.operador);
      applyTheme(cfg.tema || "light", false);
    } catch (_) {
      applyTheme("light", false);
    }
  }

  function loadConfigScreen() {
    loadConfig();
    $("cfgOperador").value = state.config.operador || "";
    $("cfgDeposito").value = state.config.deposito || "";
    $("cfgDiasAlerta").value = state.config.dias_alerta || 30;
    $("cfgSom").checked = !!state.config.som_ativo;
    $("cfgVibracao").checked = !!state.config.vibracao_ativa;
    renderThemeGrid($("gestaoThemeGrid"));
    try {
      const a = call("listarAlertas");
      const n = (a.itens || []).length;
      $("gestaoAlertBadge").textContent = String(n);
      $("gestaoAlertBadge").className = n > 0 ? "badge danger" : "badge ok";
    } catch (_) {}
  }

  function saveConfig() {
    try {
      const res = call("salvarConfig", {
        operador: $("cfgOperador").value.trim(),
        deposito: $("cfgDeposito").value.trim(),
        dias_alerta: parseInt($("cfgDiasAlerta").value, 10) || 30,
        som_ativo: $("cfgSom").checked,
        vibracao_ativa: $("cfgVibracao").checked,
        tema: state.config.tema || "light"
      });
      loadConfig();
      vibrate(30);
      toast(res.message, "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  }

  /* ===================== DASHBOARD ===================== */
  function loadDashboard() {
    try {
      const d = call("resumoDashboard");
      $("dashOcupacao").textContent = d.taxa_ocupacao + "%";
      $("dashOcupacaoDetalhe").textContent = fmtNum(d.total_ocupado) + " / " + fmtNum(d.total_capacidade) + " unidades alocadas";
      const bar = $("dashOcupacaoBar");
      bar.style.width = d.taxa_ocupacao + "%";
      bar.className = "progress-fill " + (d.taxa_ocupacao >= 90 ? "danger" : d.taxa_ocupacao >= 75 ? "warn" : "");

      $("dashEndLivres").textContent = fmtNum(d.enderecos_disponiveis);
      $("dashEndTotal").textContent = fmtNum(d.total_enderecos);
      $("dashSkus").textContent = fmtNum(d.total_produtos);
      $("dashLotes").textContent = fmtNum(d.total_lotes);

      $("kpiPedidosPend").textContent = fmtNum(d.pedidos_pendentes);
      $("kpiCheckoutWait").textContent = fmtNum(d.pedidos_aguardando_checkout) + " aguardando checkout";
      $("kpiAlertasTotal").textContent = fmtNum(d.alertas_total);
      $("kpiTarefasPend").textContent = fmtNum(d.tarefas_pendentes);
      $("kpiTotalMovs").textContent = fmtNum(d.total_movimentacoes);

      // Alert styling & badges
      const alertTile = $("kpiAlertasTile");
      const alertTag = $("kpiAlertasTag");
      const navBadge = $("navAlertBadge");
      const banner = $("dashAlertBanner");

      if (d.alertas_total > 0) {
        alertTile.classList.add("alert-active");
        alertTag.textContent = d.alertas_vencidos > 0 ? "Crítico" : "Atenção";
        alertTag.className = d.alertas_vencidos > 0 ? "badge danger" : "badge warn";
        navBadge.textContent = d.alertas_total > 99 ? "99+" : String(d.alertas_total);
        navBadge.classList.add("visible");

        banner.className = "alert-banner visible" + (d.alertas_vencidos > 0 ? " critical" : "");
        $("dashAlertBannerTitle").textContent = d.alertas_total + " alerta(s) operacional(is) requerem atenção";
        const parts = [];
        if (d.alertas_vencidos > 0) parts.push(d.alertas_vencidos + " vencido(s)");
        if (d.alertas_vencendo > 0) parts.push(d.alertas_vencendo + " vencendo em breve");
        if (d.alertas_estoque_minimo > 0) parts.push(d.alertas_estoque_minimo + " abaixo do mínimo");
        $("dashAlertBannerSub").textContent = parts.join(" · ");
      } else {
        alertTile.classList.remove("alert-active");
        alertTag.textContent = "OK";
        alertTag.className = "badge ok";
        navBadge.classList.remove("visible");
        banner.className = "alert-banner";
      }

      // Recent movements
      const rec = d.recentes || [];
      const recEl = $("dashRecentList");
      if (!rec.length) {
        recEl.innerHTML = `<div style="text-align:center;padding:12px 4px;color:var(--muted);font-size:12.5px">
          Nenhuma movimentação registrada ainda.<br>
          <span style="font-size:11.5px">Cadastre endereços e produtos ou carregue os dados de demonstração em <b>Gestão</b>.</span>
        </div>`;
      } else {
        recEl.innerHTML = rec.map(m => {
          const isOut = m.tipo === "SAIDA" || m.tipo === "SAIDA_TRANSFERENCIA" || m.tipo === "AJUSTE_INVENTARIO_SAIDA";
          const isMove = m.tipo.includes("TRANSFERENCIA");
          const cls = isMove ? "move" : (isOut ? "out" : "in");
          const sign = isOut && m.quantidade > 0 ? "-" : (m.quantidade > 0 ? "+" : "");
          return `<div class="activity-row">
            <div class="activity-left">
              <div class="activity-title">${esc(m.produto_numero)} · ${esc(m.produto_nome)}</div>
              <div class="activity-sub">${esc(friendlyMovType(m.tipo))} · End. ${esc(m.endereco)} · Lote ${esc(m.lote)}</div>
            </div>
            <div class="activity-right">
              <div class="activity-qty num ${cls}">${sign}${fmtNum(m.quantidade)} un.</div>
              <div class="activity-sub num">${esc(m.data_hora.split(" ")[1] || m.data_hora)}</div>
            </div>
          </div>`;
        }).join("");
      }
    } catch (e) {
      toast(e.message, "err");
    }
  }

  function friendlyMovType(t) {
    const map = {
      ENTRADA: "Entrada",
      SAIDA: "Separação",
      ENTRADA_TRANSFERENCIA: "Transf. (Entrada)",
      SAIDA_TRANSFERENCIA: "Transf. (Saída)",
      AJUSTE_INVENTARIO_ENTRADA: "Inventário (+)",
      AJUSTE_INVENTARIO_SAIDA: "Inventário (-)"
    };
    return map[t] || t;
  }

  function expiryBadge(dias, vencimento) {
    if (dias < 0) return `<span class="badge danger">Vencido (${esc(vencimento)})</span>`;
    if (dias <= (state.config.dias_alerta || 30)) return `<span class="badge warn">Vence em ${dias}d</span>`;
    return `<span class="badge ok">${esc(vencimento)}</span>`;
  }

  /* ===================== ESTOQUE ===================== */
  function loadStock() {
    try {
      const filtro = $("estFiltro").value.trim();
      const data = call("consultarEstoque", filtro);
      const itens = data.itens || [];
      $("estoqueCountBadge").textContent = itens.length + (itens.length === 1 ? " posição" : " posições");
      const box = $("estoqueResultado");
      if (!itens.length) {
        box.innerHTML = `<div class="empty-state"><strong>Nenhum saldo encontrado</strong><p>Ajuste o filtro ou registre uma nova entrada de estoque.</p><button class="btn btn-sm" onclick="window._msGo('entrada')">Registrar Entrada</button></div>`;
        return;
      }
      box.innerHTML = itens.map((it, idx) => {
        const cx = Math.floor(it.quantidade / Math.max(1, it.unidades_por_caixa));
        const rem = it.quantidade % Math.max(1, it.unidades_por_caixa);
        const cxText = cx > 0 ? `${fmtNum(cx)} cx` + (rem > 0 ? ` + ${fmtNum(rem)} un.` : "") : `${fmtNum(rem)} un.`;
        return `<div class="data-card">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">${esc(it.numero)}${it.codigo_barras ? " · " + esc(it.codigo_barras) : ""}</div>
              <div class="data-card-title">${esc(it.nome)}</div>
            </div>
            ${expiryBadge(it.dias_vencimento, it.vencimento)}
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Endereço</span><strong style="font-family:ui-monospace,monospace">${esc(it.endereco)}</strong></div>
            <div class="meta-cell"><span>Saldo</span><strong class="num" style="color:var(--ok)">${fmtNum(it.quantidade)} un.</strong></div>
            <div class="meta-cell"><span>Lote</span><strong>${esc(it.lote)}</strong></div>
            <div class="meta-cell"><span>Embalagem (QC ${it.unidades_por_caixa})</span><strong class="num">${cxText}</strong></div>
          </div>
          <div class="data-card-actions">
            <button class="btn btn-outline btn-sm" data-stock-act="trans" data-idx="${idx}">Transferir</button>
            <button class="btn btn-outline btn-sm" data-stock-act="inv" data-idx="${idx}">Inventariar</button>
            <button class="btn btn-outline btn-sm" data-stock-act="sep" data-idx="${idx}">Separar</button>
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("[data-stock-act]").forEach(btn => {
        btn.onclick = () => {
          const item = itens[parseInt(btn.dataset.idx, 10)];
          const act = btn.dataset.stockAct;
          if (act === "trans") {
            $("trNumero").value = item.numero;
            $("trLote").value = item.lote;
            $("trOrigem").value = item.endereco;
            $("trDestino").value = "";
            $("trQuantidade").value = "";
            navigate("transferencia");
            switchTransferTab("direta");
          } else if (act === "inv") {
            $("invNumero").value = item.numero;
            $("invLote").value = item.lote;
            $("invEndereco").value = item.endereco;
            $("invQtd").value = "";
            navigate("inventario");
            updateInvSystemPreview();
          } else if (act === "sep") {
            resetSeparationContext();
            $("sepProduto").value = item.numero;
            $("sepQuantidade").value = "";
            navigate("separacao", { keepContext: true });
          }
        };
      });
    } catch (e) {
      $("estoqueResultado").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  /* ===================== CATÁLOGO & CADASTRO ===================== */
  function loadCatalog() {
    try {
      const filtro = $("prodFiltro").value.trim();
      const data = call("listarProdutos", filtro);
      const itens = data.itens || [];
      state.produtosCache = itens;
      $("prodCountBadge").textContent = itens.length + (itens.length === 1 ? " lote" : " lotes");
      const box = $("produtosResultado");
      if (!itens.length) {
        box.innerHTML = `<div class="empty-state"><strong>Catálogo vazio</strong><p>Cadastre produtos e lotes para iniciar a operação.</p><button class="btn btn-sm" onclick="window._msGo('cadastro')">Cadastrar Produto</button></div>`;
        return;
      }
      box.innerHTML = itens.map((it, idx) => {
        const low = it.estoque_minimo > 0 && it.saldo_produto <= it.estoque_minimo;
        return `<div class="data-card">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">${esc(it.numero)}${it.codigo_barras ? " · " + esc(it.codigo_barras) : ""}</div>
              <div class="data-card-title">${esc(it.nome)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              ${expiryBadge(it.dias_vencimento, it.vencimento)}
              ${low ? `<span class="badge danger">Abaixo do mín. (${it.estoque_minimo})</span>` : ""}
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Lote</span><strong>${esc(it.lote)}</strong></div>
            <div class="meta-cell"><span>Saldo do Lote</span><strong class="num">${fmtNum(it.saldo_total)} un.</strong></div>
            <div class="meta-cell"><span>QC / Fabricação</span><strong>${it.unidades_por_caixa} un/cx · ${esc(it.fabricacao)}</strong></div>
            <div class="meta-cell"><span>Est. Mínimo</span><strong class="num">${fmtNum(it.estoque_minimo)} un.</strong></div>
          </div>
          <div class="data-card-actions">
            <button class="btn btn-outline btn-sm" data-prod-act="entry" data-idx="${idx}">+ Entrada</button>
            <button class="btn btn-outline btn-sm" data-prod-act="edit" data-idx="${idx}">Editar</button>
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("[data-prod-act]").forEach(btn => {
        btn.onclick = () => {
          const it = state.produtosCache[parseInt(btn.dataset.idx, 10)];
          if (btn.dataset.prodAct === "entry") {
            $("entNumero").value = it.numero;
            $("entLote").value = it.lote;
            state.entCurrentQc = it.unidades_por_caixa;
            updateEntCalc();
            navigate("entrada");
          } else {
            openEditProduct(it);
          }
        };
      });
    } catch (e) {
      $("produtosResultado").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  function saveProduct() {
    setMsg("cadMsg", "");
    try {
      const res = call("salvarProduto", {
        numero: $("cadNumero").value.trim(),
        codigo_barras: $("cadCodigoBarras").value.trim(),
        nome: $("cadNome").value.trim(),
        lote: $("cadLote").value.trim(),
        unidades_por_caixa: parseInt($("cadQc").value, 10) || 0,
        estoque_minimo: parseInt($("cadEstoqueMin").value, 10) || 0,
        fabricacao: $("cadFabricacao").value.trim(),
        vencimento: $("cadVencimento").value.trim(),
        endereco: $("cadEndereco").value.trim().toUpperCase(),
        quantidade_entrada: parseInt($("cadQtdInicial").value, 10) || 0
      });
      vibrate(35);
      toast(res.message, "ok");
      setMsg("cadMsg", res.message, "ok");
      ["cadNumero", "cadCodigoBarras", "cadNome", "cadLote", "cadQc", "cadEstoqueMin", "cadFabricacao", "cadVencimento", "cadQtdInicial", "cadEndereco"].forEach(id => $(id).value = "");
    } catch (e) {
      setMsg("cadMsg", e.message, "err");
    }
  }

  function openEditProduct(it) {
    $("editProdId").value = it.produto_id;
    $("editLoteId").value = it.lote_id;
    $("editNumero").value = it.numero || "";
    $("editEstoqueMin").value = it.estoque_minimo || 0;
    $("editCodigoBarras").value = it.codigo_barras || "";
    $("editNome").value = it.nome || "";
    $("editLote").value = it.lote || "";
    $("editQc").value = it.unidades_por_caixa || "";
    $("editFab").value = it.fabricacao || "";
    $("editVenc").value = it.vencimento || "";
    setMsg("editProdMsg", "");
    $("editProdModal").classList.add("open");
  }

  function saveEditProduct() {
    setMsg("editProdMsg", "");
    try {
      const res = call("editarProduto", {
        produto_id: parseInt($("editProdId").value, 10),
        lote_id: parseInt($("editLoteId").value, 10),
        numero: $("editNumero").value.trim(),
        codigo_barras: $("editCodigoBarras").value.trim(),
        nome: $("editNome").value.trim(),
        estoque_minimo: parseInt($("editEstoqueMin").value, 10) || 0,
        lote: $("editLote").value.trim(),
        unidades_por_caixa: parseInt($("editQc").value, 10) || 0,
        fabricacao: $("editFab").value.trim(),
        vencimento: $("editVenc").value.trim()
      });
      $("editProdModal").classList.remove("open");
      vibrate(30);
      toast(res.message, "ok");
      loadCatalog();
    } catch (e) {
      setMsg("editProdMsg", e.message, "err");
    }
  }

  /* ===================== ENDEREÇOS ===================== */
  function loadAddresses() {
    try {
      const data = call("listarEnderecos", "false");
      state.enderecosCache = data.itens || [];
      renderAddressesList();
    } catch (e) {
      $("enderecosLista").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  function renderAddressesList() {
    const f = state.endFilter;
    const list = state.enderecosCache.filter(it => {
      if (f === "disponiveis") return it.disponivel > 0;
      if (f === "lotados") return it.disponivel <= 0;
      if (f === "vazios") return it.ocupado === 0;
      return true;
    });
    const box = $("enderecosLista");
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><strong>Nenhum endereço neste filtro</strong><p>Cadastre endereços acima (ex.: A01-R01-N01) para mapear o armazém.</p></div>`;
      return;
    }
    box.innerHTML = list.map(it => {
      const pct = it.capacidade_maxima > 0 ? Math.min(100, Math.round((it.ocupado * 100) / it.capacidade_maxima)) : 0;
      const barCls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
      const badgeCls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
      return `<div class="data-card" data-open-addr="${esc(it.codigo)}" style="cursor:pointer">
        <div class="data-card-top">
          <div>
            <div class="data-card-title" style="font-family:ui-monospace,monospace">${esc(it.codigo)}</div>
            <div style="font-size:12px;color:var(--muted)" class="num">${fmtNum(it.ocupado)} / ${fmtNum(it.capacidade_maxima)} un. · ${it.total_itens || 0} lote(s)</div>
          </div>
          <span class="badge ${badgeCls} num">${pct}% ocupado</span>
        </div>
        <div class="progress-track light"><div class="progress-fill ${barCls}" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px">
          <span style="color:var(--muted)">Livre: <strong class="num" style="color:var(--text)">${fmtNum(it.disponivel)} un.</strong></span>
          <span style="color:var(--brand);font-weight:700">Abrir detalhe &rsaquo;</span>
        </div>
      </div>`;
    }).join("");

    box.querySelectorAll("[data-open-addr]").forEach(el => {
      el.onclick = () => {
        const found = state.enderecosCache.find(x => x.codigo === el.dataset.openAddr);
        if (found) openAddressDetail(found);
      };
    });
  }

  function saveAddress() {
    setMsg("endMsg", "");
    try {
      const res = call("salvarEndereco", {
        codigo: $("endCodigo").value.trim().toUpperCase(),
        capacidade_maxima: parseInt($("endCapacidade").value, 10) || 0
      });
      $("endCodigo").value = "";
      $("endCapacidade").value = "";
      vibrate(30);
      toast(res.message, "ok");
      loadAddresses();
    } catch (e) {
      setMsg("endMsg", e.message, "err");
    }
  }

  function openAddressDetail(item) {
    state.endDetalheAtual = item;
    $("endDetTitulo").textContent = item.codigo;
    $("endDetCapInput").value = item.capacidade_maxima;
    setMsg("endDetMsg", "");
    const pct = item.capacidade_maxima > 0 ? Math.min(100, Math.round((item.ocupado * 100) / item.capacidade_maxima)) : 0;
    const barCls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
    $("endDetResumo").innerHTML = `
      <div class="data-card-top">
        <div><span style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase">Ocupação Atual</span>
        <div style="font-size:22px;font-weight:800" class="num">${pct}%</div></div>
        <span class="badge ${barCls} num">${fmtNum(item.disponivel)} un. livres</span>
      </div>
      <div class="progress-track light"><div class="progress-fill ${barCls}" style="width:${pct}%"></div></div>
      <div class="meta-grid">
        <div class="meta-cell"><span>Ocupado</span><strong class="num">${fmtNum(item.ocupado)} un.</strong></div>
        <div class="meta-cell"><span>Capacidade Máxima</span><strong class="num">${fmtNum(item.capacidade_maxima)} un.</strong></div>
      </div>`;

    try {
      const res = call("itensDoEndereco", item.codigo);
      const itens = res.itens || [];
      $("endDetItens").innerHTML = itens.length ? itens.map(x => `
        <div class="data-card">
          <div class="data-card-top">
            <div><div class="data-card-code">${esc(x.numero)}</div><div class="data-card-title">${esc(x.nome)}</div></div>
            <span class="badge ok num">${fmtNum(x.quantidade)} un.</span>
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Lote</span><strong>${esc(x.lote)}</strong></div>
            <div class="meta-cell"><span>Vencimento</span><strong>${esc(x.vencimento)}</strong></div>
          </div>
        </div>`).join("") : `<div class="empty-state"><strong>Endereço vazio</strong><p>Nenhum produto armazenado nesta posição.</p></div>`;
    } catch (e) {
      $("endDetItens").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
    navigate("endereco-detalhe");
  }

  function saveAddressDetail() {
    if (!state.endDetalheAtual) return;
    setMsg("endDetMsg", "");
    try {
      const cap = parseInt($("endDetCapInput").value, 10) || 0;
      const res = call("salvarEndereco", { codigo: state.endDetalheAtual.codigo, capacidade_maxima: cap });
      vibrate(30);
      toast(res.message, "ok");
      const updated = call("listarEnderecos", "false").itens.find(x => x.codigo === state.endDetalheAtual.codigo);
      if (updated) openAddressDetail(updated);
    } catch (e) {
      setMsg("endDetMsg", e.message, "err");
    }
  }

  function deleteAddressDetail() {
    if (!state.endDetalheAtual) return;
    const cod = state.endDetalheAtual.codigo;
    openConfirm({
      title: "Remover endereço " + cod + "?",
      body: "Somente endereços sem saldo em estoque podem ser removidos.",
      okLabel: "Remover",
      danger: true,
      onConfirm: () => {
        try {
          const res = call("excluirEndereco", cod);
          toast(res.message, "ok");
          navigate("enderecos");
        } catch (e) {
          setMsg("endDetMsg", e.message, "err");
        }
      }
    });
  }

  function pickAvailableAddress(onSelect) {
    try {
      const itens = call("listarEnderecos", "true").itens || [];
      if (!itens.length) {
        openPicker("Endereços Disponíveis", `<div class="empty-state"><strong>Sem endereços com espaço</strong><p>Cadastre um novo endereço ou amplie a capacidade.</p></div>`);
        return;
      }
      const html = `<div class="data-list" style="margin-top:0">` + itens.map(it => {
        const pct = it.capacidade_maxima > 0 ? Math.min(100, Math.round((it.ocupado * 100) / it.capacidade_maxima)) : 0;
        return `<div class="data-card" data-pick-addr="${esc(it.codigo)}" style="cursor:pointer">
          <div class="data-card-top">
            <strong style="font-family:ui-monospace,monospace;font-size:15px">${esc(it.codigo)}</strong>
            <span class="badge ok num">${fmtNum(it.disponivel)} un. livres</span>
          </div>
          <div class="progress-track light"><div class="progress-fill ${pct >= 80 ? "warn" : "ok"}" style="width:${pct}%"></div></div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:5px" class="num">Ocupado: ${fmtNum(it.ocupado)} / ${fmtNum(it.capacidade_maxima)} un.</div>
        </div>`;
      }).join("") + `</div>`;
      openPicker("Selecionar Endereço Disponível", html, body => {
        body.querySelectorAll("[data-pick-addr]").forEach(el => {
          el.onclick = () => {
            closePicker();
            onSelect(el.dataset.pickAddr);
          };
        });
      });
    } catch (e) {
      toast(e.message, "err");
    }
  }

  function pickLotForProduct(prodCode, onSelect) {
    const code = String(prodCode || "").trim();
    if (!code) {
      toast("Informe ou bipe o código do produto primeiro.", "err");
      return;
    }
    try {
      const itens = call("listarLotes", code).itens || [];
      if (!itens.length) {
        openPicker("Lotes do Produto", `<div class="empty-state"><strong>Nenhum lote cadastrado</strong><p>Cadastre o produto/lote no Catálogo primeiro.</p></div>`);
        return;
      }
      const html = `<div class="data-list" style="margin-top:0">` + itens.map((it, idx) => `
        <div class="data-card" data-pick-lot="${idx}" style="cursor:pointer">
          <div class="data-card-top">
            <div><div class="data-card-code">${esc(it.numero)} · ${esc(it.nome)}</div><div class="data-card-title">Lote: ${esc(it.lote)}</div></div>
            <span class="badge slate num">QC ${it.unidades_por_caixa}</span>
          </div>
          <div style="font-size:12px;color:var(--muted)">Venc.: <b>${esc(it.vencimento)}</b> · Saldo atual: <b class="num">${fmtNum(it.saldo_total)} un.</b></div>
        </div>`).join("") + `</div>`;
      openPicker("Selecionar Lote", html, body => {
        body.querySelectorAll("[data-pick-lot]").forEach(el => {
          el.onclick = () => {
            const chosen = itens[parseInt(el.dataset.pickLot, 10)];
            closePicker();
            onSelect(chosen);
          };
        });
      });
    } catch (e) {
      toast(e.message, "err");
    }
  }

  /* ===================== ENTRADA (PUTAWAY) ===================== */
  function updateEntCalc() {
    const qc = state.entCurrentQc;
    if (qc > 0) {
      $("entCalcStrip").style.display = "flex";
      $("entQcInfo").textContent = String(qc);
      const qty = parseInt($("entQuantidade").value, 10) || 0;
      const cx = Math.floor(qty / qc);
      const rem = qty % qc;
      $("entCaixasPreview").textContent = qty > 0 ? (cx + " cx" + (rem ? " + " + rem + " un." : "")) : "0 cx";
    } else {
      $("entCalcStrip").style.display = "none";
    }
  }

  function saveEntry() {
    setMsg("entMsg", "");
    try {
      const res = call("registrarEntrada", {
        numero: $("entNumero").value.trim(),
        lote: $("entLote").value.trim(),
        endereco: $("entEndereco").value.trim().toUpperCase(),
        quantidade: parseInt($("entQuantidade").value, 10) || 0
      });
      vibrate(40);
      playBeep(1600, 0.09);
      toast(res.message, "ok");
      setMsg("entMsg", res.message, "ok");
      $("entCaixas").value = "";
      $("entQuantidade").value = "";
      updateEntCalc();
    } catch (e) {
      setMsg("entMsg", e.message, "err");
    }
  }

  /* ===================== PEDIDOS / ORDENS ===================== */
  function loadOrders() {
    try {
      const filtro = $("ordFiltro").value.trim();
      const itens = call("listarPedidos", filtro).itens || [];
      const box = $("ordensLista");
      if (!itens.length) {
        box.innerHTML = `<div class="empty-state"><strong>Nenhuma ordem cadastrada</strong><p>Crie uma ordem de separação para organizar entregas e conferência física.</p></div>`;
        return;
      }
      box.innerHTML = itens.map(o => {
        const stCls = o.status === "EXPEDIDO" ? "ok" : o.status === "CONCLUIDO" ? "brand" : o.status === "CANCELADO" ? "danger" : "warn";
        return `<div class="data-card" data-open-order="${esc(o.numero)}" style="cursor:pointer">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">${esc(o.numero)}</div>
              <div class="data-card-title">${esc(o.cliente || "Sem cliente informado")}</div>
            </div>
            <span class="badge ${stCls}">${esc(o.status)}</span>
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Progresso</span><strong class="num">${o.itens_concluidos || 0} / ${o.total_itens} item(ns)</strong></div>
            <div class="meta-cell"><span>Volume Total</span><strong class="num">${fmtNum(o.total_unidades)} un.</strong></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11.5px;color:var(--muted)">
            <span>${esc(o.criado_em)}</span>
            <span style="color:var(--brand);font-weight:700">Abrir ordem &rsaquo;</span>
          </div>
        </div>`;
      }).join("");

      box.querySelectorAll("[data-open-order]").forEach(el => {
        el.onclick = () => openOrderDetail(el.dataset.openOrder);
      });
    } catch (e) {
      $("ordensLista").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  function populateOrderProducts() {
    try {
      const prods = call("listarProdutosUnicos", "").itens || [];
      const sel = $("ordProdSelect");
      if (!prods.length) {
        sel.innerHTML = `<option value="">Cadastre produtos primeiro</option>`;
        return;
      }
      sel.innerHTML = prods.map(p =>
        `<option value="${p.produto_id}" data-label="${esc(p.numero + " - " + p.nome)}">${esc(p.numero)} · ${esc(p.nome)} (Disp: ${fmtNum(p.saldo_total)})</option>`
      ).join("");
    } catch (_) {}
  }

  function renderOrderDraft() {
    const box = $("ordDraftItens");
    if (!state.ordDraft.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = state.ordDraft.map((d, idx) => `
      <div class="data-card" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong style="font-size:13px">${esc(d.label)}</strong>
          <div style="font-size:12px;color:var(--brand)" class="num">${fmtNum(d.quantidade)} unidade(s)</div>
        </div>
        <button class="btn btn-danger-outline btn-sm" data-rm-draft="${idx}">&times;</button>
      </div>`).join("");
    box.querySelectorAll("[data-rm-draft]").forEach(b => {
      b.onclick = () => {
        state.ordDraft.splice(parseInt(b.dataset.rmDraft, 10), 1);
        renderOrderDraft();
      };
    });
  }

  function openOrderDetail(numero) {
    try {
      const data = call("obterPedido", numero);
      const p = data.pedido;
      const itens = data.itens || [];
      state.ordAtualNumero = p.numero;

      $("ordDetNumero").textContent = p.numero;
      $("ordDetCliente").textContent = p.cliente || "Sem cliente informado";
      const stCls = p.status === "EXPEDIDO" ? "ok" : p.status === "CONCLUIDO" ? "" : p.status === "CANCELADO" ? "danger" : "warn";
      $("ordDetStatus").className = "badge " + stCls;
      $("ordDetStatus").textContent = p.status;

      $("ordDetResumo").innerHTML = `<div class="meta-grid" style="margin-top:0;padding-top:0;border-top:0">
        <div class="meta-cell"><span>Criado em</span><strong>${esc(p.criado_em)}</strong></div>
        <div class="meta-cell"><span>Responsável</span><strong>${esc(p.criado_por)}</strong></div>
      </div>`;

      $("ordDetItens").innerHTML = itens.map(it => {
        const done = it.status === "CONCLUIDO";
        return `<div class="data-card">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">${esc(it.produto_numero)}</div>
              <div class="data-card-title">${esc(it.nome)}</div>
            </div>
            <span class="badge ${done ? "ok" : "warn"}">${done ? "Separado" : "Pendente"}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
            <span class="num" style="font-size:13.5px;font-weight:800">${fmtNum(it.quantidade)} unidade(s)</span>
            ${!done && p.status === "PENDENTE"
              ? `<button class="btn btn-sm" data-pick-order-item="${it.item_id}" data-prod="${esc(it.produto_numero)}" data-qty="${it.quantidade}">Separar (FEFO)</button>`
              : ""}
          </div>
        </div>`;
      }).join("");

      $("ordDetItens").querySelectorAll("[data-pick-order-item]").forEach(btn => {
        btn.onclick = () => {
          state.sepOrderContext = {
            pedido_id: p.id,
            pedido_item_id: parseInt(btn.dataset.pickOrderItem, 10),
            pedido_numero: p.numero
          };
          $("sepOrderBanner").textContent = `Atendendo Ordem ${p.numero} · Produto ${btn.dataset.prod} (${btn.dataset.qty} un.)`;
          $("sepOrderBanner").className = "msg info";
          $("sepContextSub").textContent = "Vinculada à ordem " + p.numero;
          $("sepProduto").value = btn.dataset.prod;
          $("sepQuantidade").value = btn.dataset.qty;
          $("sepConfirmBox").style.display = "none";
          setMsg("sepErro", "");
          setMsg("sepConfirmMsg", "");
          navigate("separacao", { keepContext: true });
          generateSeparationPreview();
        };
      });

      let footer = "";
      if (p.status === "CONCLUIDO") {
        footer = `<button class="btn btn-ok" id="btnOrdGoCheckout">Iniciar Checkout de Expedição</button>`;
      } else if (p.status === "PENDENTE") {
        footer = `<button class="btn btn-danger-outline" id="btnOrdCancel">Cancelar Ordem</button>`;
      }
      $("ordDetFooterActions").innerHTML = footer;
      if ($("btnOrdGoCheckout")) {
        $("btnOrdGoCheckout").onclick = () => {
          navigate("checkout");
          $("chkOrdemSelect").value = p.numero;
          loadCheckoutOrder(p.numero);
        };
      }
      if ($("btnOrdCancel")) {
        $("btnOrdCancel").onclick = () => {
          openConfirm({
            title: "Cancelar ordem " + p.numero + "?",
            body: "A ordem será marcada como CANCELADA.",
            okLabel: "Cancelar Ordem",
            danger: true,
            onConfirm: () => {
              try {
                const r = call("cancelarPedido", p.numero);
                toast(r.message, "ok");
                navigate("pedidos");
              } catch (e) { toast(e.message, "err"); }
            }
          });
        };
      }
      navigate("ordem-detalhe");
    } catch (e) {
      toast(e.message, "err");
    }
  }

  /* ===================== SEPARAÇÃO FEFO ===================== */
  function resetSeparationContext() {
    state.sepOrderContext = null;
    state.sepPreview = null;
    $("sepOrderBanner").className = "msg";
    $("sepOrderBanner").textContent = "";
    $("sepContextSub").textContent = "Prioridade automática por vencimento";
    $("sepConfirmBox").style.display = "none";
    setMsg("sepErro", "");
    setMsg("sepConfirmMsg", "");
  }

  function generateSeparationPreview() {
    setMsg("sepErro", "");
    setMsg("sepConfirmMsg", "");
    $("sepConfirmBox").style.display = "none";
    try {
      const prev = call("previewSeparacao", {
        numero: $("sepProduto").value.trim(),
        quantidade: parseInt($("sepQuantidade").value, 10) || 0
      });
      state.sepPreview = prev;
      $("sepSummaryCard").innerHTML = `
        <div class="data-card-code">${esc(prev.produto)}</div>
        <div class="data-card-title">${esc(prev.nome)}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px">Total solicitado: <strong class="num" style="color:var(--text)">${fmtNum(prev.quantidade_pedida)} unidade(s)</strong> · ${prev.orientacoes.length} retirada(s)</div>`;

      $("sepItensContainer").innerHTML = prev.orientacoes.map((o, idx) => `
        <div class="pick-step">
          <div class="pick-address-box">
            <div><span style="font-size:10px;color:#94A3B8;display:block;text-transform:uppercase">Vá até o endereço</span><span class="addr">${esc(o.endereco)}</span></div>
            <span class="badge navy">Etapa ${idx + 1}/${prev.orientacoes.length}</span>
          </div>
          <div class="meta-grid" style="margin-top:0;padding-top:0;border-top:0">
            <div class="meta-cell"><span>Lote</span><strong>${esc(o.lote)}</strong></div>
            <div class="meta-cell"><span>Vencimento (FEFO)</span><strong>${esc(o.vencimento)}</strong></div>
          </div>
          <div class="pick-qty-banner">
            <span>Retirar: ${fmtNum(o.qtd_operador)} ${esc(o.unidade_operador)}</span>
            <span style="font-size:11.5px;font-weight:700" class="num">(${fmtNum(o.quantidade_baixa)} un.)</span>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Confirme a quantidade de ${esc(o.unidade_operador)} retirada</label>
            <input class="sepConfirmInput" type="number" inputmode="numeric" data-idx="${idx}" placeholder="Digite ${o.qtd_operador}">
          </div>
        </div>`).join("");

      $("sepConfirmBox").style.display = "block";
      $("btnConfirmarSep").disabled = false;
    } catch (e) {
      setMsg("sepErro", e.message, "err");
    }
  }

  function confirmSeparation() {
    if (!state.sepPreview) return;
    setMsg("sepConfirmMsg", "");
    try {
      const inputs = [...document.querySelectorAll(".sepConfirmInput")];
      const confirmacoes = inputs.map(i => ({
        index: parseInt(i.dataset.idx, 10),
        quantidade_confirmada: parseInt(i.value, 10)
      }));
      const payload = {
        token: state.sepPreview.token,
        confirmacoes
      };
      if (state.sepOrderContext) {
        payload.pedido_id = state.sepOrderContext.pedido_id;
        payload.pedido_item_id = state.sepOrderContext.pedido_item_id;
      }
      const res = call("confirmarSeparacao", payload);
      vibrate(50);
      playBeep(1700, 0.12);
      toast(res.message, "ok");
      setMsg("sepConfirmMsg", res.message, "ok");
      $("btnConfirmarSep").disabled = true;

      if (state.sepOrderContext) {
        const ordNo = state.sepOrderContext.pedido_numero;
        setTimeout(() => {
          resetSeparationContext();
          openOrderDetail(ordNo);
        }, 700);
      }
    } catch (e) {
      vibrate(120);
      setMsg("sepConfirmMsg", e.message, "err");
    }
  }

  /* ===================== CHECKOUT FÍSICO ===================== */
  function loadCheckoutOrders() {
    setMsg("chkMsg", "");
    $("chkWorkspace").style.display = "none";
    state.chkNumeroAtual = null;
    try {
      const orders = (call("listarPedidos", "").itens || []).filter(o => o.status === "CONCLUIDO" || o.status === "EXPEDIDO");
      const sel = $("chkOrdemSelect");
      if (!orders.length) {
        sel.innerHTML = `<option value="">Nenhuma ordem concluída para checkout</option>`;
        return;
      }
      sel.innerHTML = orders.map(o =>
        `<option value="${esc(o.numero)}">${esc(o.numero)} · ${esc(o.cliente || "Sem cliente")} [${esc(o.status)}]</option>`
      ).join("");
    } catch (e) {
      setMsg("chkMsg", e.message, "err");
    }
  }

  function loadCheckoutOrder(numero) {
    setMsg("chkMsg", "");
    if (!numero) {
      setMsg("chkMsg", "Selecione uma ordem concluída.", "err");
      return;
    }
    try {
      const st = call("statusCheckout", numero);
      state.chkNumeroAtual = numero;
      renderCheckoutWorkspace(st);
    } catch (e) {
      setMsg("chkMsg", e.message, "err");
    }
  }

  function renderCheckoutWorkspace(st) {
    $("chkWorkspace").style.display = "block";
    const p = st.pedido;
    const conf = st.conferencia;
    const inProgress = conf && conf.status === "EM_CONFERENCIA";
    const done = p.status === "EXPEDIDO";

    $("chkHeaderCard").innerHTML = `
      <div class="data-card-top">
        <div>
          <div class="data-card-code">${esc(p.numero)}</div>
          <div class="data-card-title">${esc(p.cliente || "Sem cliente")}</div>
        </div>
        <span class="badge ${done ? "ok" : inProgress ? "" : "warn"}">${done ? "EXPEDIDO" : inProgress ? "EM CONFERÊNCIA" : "AGUARDANDO INÍCIO"}</span>
      </div>
      ${!conf && !done ? `<button class="btn" id="btnIniciarConfFisica">Iniciar Conferência Física</button>` : ""}`;

    if ($("btnIniciarConfFisica")) {
      $("btnIniciarConfFisica").onclick = () => {
        try {
          const updated = call("iniciarCheckoutFisico", { numero: p.numero });
          vibrate(35);
          renderCheckoutWorkspace(updated);
          toast("Conferência física iniciada.", "ok");
        } catch (e) { setMsg("chkMsg", e.message, "err"); }
      };
    }

    $("chkScanCard").style.display = inProgress ? "block" : "none";

    const prog = st.progresso || [];
    let allComplete = prog.length > 0;
    $("chkProgressoLista").innerHTML = prog.map(item => {
      const pct = item.quantidade > 0 ? Math.min(100, Math.round((item.confirmado * 100) / item.quantidade)) : 0;
      const okItem = item.confirmado === item.quantidade;
      if (!okItem) allComplete = false;
      return `<div class="data-card">
        <div class="data-card-top">
          <div><div class="data-card-code">${esc(item.produto_numero)}</div><div class="data-card-title">${esc(item.nome)}</div></div>
          <span class="badge ${okItem ? "ok" : "warn"} num">${fmtNum(item.confirmado)} / ${fmtNum(item.quantidade)} un.</span>
        </div>
        <div class="progress-track light"><div class="progress-fill ${okItem ? "ok" : "brand"}" style="width:${pct}%"></div></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px" class="num">
          Caixas bipadas: <b>${item.caixas}</b> (${fmtNum(item.unidades_caixa)} un.) · Avulsas: <b>${fmtNum(item.avulsas)}</b> un.
        </div>
        ${inProgress ? `<div class="data-card-actions">
          <button class="btn btn-outline btn-sm" data-chk-avulsa="${item.item_id}" data-cur="${item.avulsas}" data-max="${item.quantidade - item.unidades_caixa}">Ajustar Avulsas</button>
        </div>` : ""}
      </div>`;
    }).join("");

    $("chkProgressoLista").querySelectorAll("[data-chk-avulsa]").forEach(btn => {
      btn.onclick = () => {
        const itemId = parseInt(btn.dataset.chkAvulsa, 10);
        const cur = btn.dataset.cur;
        openConfirm({
          title: "Unidades Avulsas",
          body: "Informe a quantidade total de unidades avulsas conferidas para este item (máx. " + btn.dataset.max + ").",
          okLabel: "Salvar",
          promptLabel: "Quantidade avulsa (un.)",
          promptValue: cur,
          onConfirm: val => {
            try {
              const updated = call("registrarAvulsasCheckout", {
                numero: p.numero,
                item_id: itemId,
                quantidade: parseInt(val, 10)
              });
              renderCheckoutWorkspace(updated);
              toast("Unidades avulsas atualizadas.", "ok");
            } catch (e) { toast(e.message, "err"); }
          }
        });
      };
    });

    $("chkFooterBox").innerHTML = inProgress
      ? `<button class="btn btn-ok" id="btnFinalizarCheckout" ${allComplete ? "" : "disabled"}>Finalizar Conferência e Expedir Ordem</button>`
      : "";
    if ($("btnFinalizarCheckout")) {
      $("btnFinalizarCheckout").onclick = () => {
        try {
          const res = call("finalizarCheckoutFisico", { numero: p.numero });
          vibrate(55);
          playBeep(1750, 0.14);
          toast(res.message, "ok");
          loadCheckoutOrder(p.numero);
        } catch (e) { setMsg("chkMsg", e.message, "err"); }
      };
    }
  }

  function submitCheckoutBox() {
    if (!state.chkNumeroAtual) return;
    setMsg("chkMsg", "");
    try {
      const code = $("chkCodigoCaixa").value.trim();
      const updated = call("biparCaixaCheckout", { numero: state.chkNumeroAtual, codigo: code });
      $("chkCodigoCaixa").value = "";
      vibrate(35);
      playBeep(1900, 0.1);
      renderCheckoutWorkspace(updated);
      toast("Caixa conferida com sucesso!", "ok");
    } catch (e) {
      vibrate(120);
      setMsg("chkMsg", e.message, "err");
    }
  }

  /* ===================== TRANSFERÊNCIAS & TAREFAS ===================== */
  function switchTransferTab(tab) {
    document.querySelectorAll("#transModeChips .chip").forEach(c => c.classList.toggle("active", c.dataset.transTab === tab));
    $("transTabDireta").style.display = tab === "direta" ? "block" : "none";
    $("transTabTarefas").style.display = tab === "tarefas" ? "block" : "none";
    if (tab === "tarefas") loadMoveTasks();
  }

  function executeDirectTransfer() {
    setMsg("trMsg", "");
    try {
      const res = call("transferirEstoque", {
        numero: $("trNumero").value.trim(),
        lote: $("trLote").value.trim(),
        origem: $("trOrigem").value.trim().toUpperCase(),
        destino: $("trDestino").value.trim().toUpperCase(),
        quantidade: parseInt($("trQuantidade").value, 10) || 0
      });
      vibrate(40);
      toast(res.message, "ok");
      setMsg("trMsg", res.message, "ok");
      $("trQuantidade").value = "";
    } catch (e) {
      setMsg("trMsg", e.message, "err");
    }
  }

  function createMoveTask() {
    setMsg("trMsg", "");
    try {
      const res = call("criarTarefaMovimentacao", {
        numero: $("trNumero").value.trim(),
        lote: $("trLote").value.trim(),
        origem: $("trOrigem").value.trim().toUpperCase(),
        destino: $("trDestino").value.trim().toUpperCase(),
        quantidade: parseInt($("trQuantidade").value, 10) || 0
      });
      vibrate(35);
      toast(res.message, "ok");
      setMsg("trMsg", res.message, "ok");
      $("trQuantidade").value = "";
      loadMoveTasks();
    } catch (e) {
      setMsg("trMsg", e.message, "err");
    }
  }

  function loadMoveTasks() {
    try {
      const itens = call("listarTarefasMovimentacao", state.taskStatusFilter).itens || [];
      const box = $("tarefasLista");
      if (!itens.length) {
        box.innerHTML = `<div class="empty-state"><strong>Nenhuma tarefa encontrada</strong><p>Crie tarefas programadas na aba Transferência Direta.</p></div>`;
        return;
      }
      box.innerHTML = itens.map(t => {
        const cls = t.status === "CONCLUIDA" ? "ok" : t.status === "CANCELADA" ? "danger" : "warn";
        return `<div class="data-card">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">Tarefa #${t.id} · ${esc(t.produto_numero)}</div>
              <div class="data-card-title">${esc(t.produto_nome)}</div>
            </div>
            <span class="badge ${cls}">${esc(t.status)}</span>
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Rota</span><strong style="font-family:ui-monospace,monospace">${esc(t.origem)} &rarr; ${esc(t.destino)}</strong></div>
            <div class="meta-cell"><span>Quantidade</span><strong class="num">${fmtNum(t.quantidade)} un.</strong></div>
            <div class="meta-cell"><span>Lote</span><strong>${esc(t.lote)}</strong></div>
            <div class="meta-cell"><span>Criado em</span><strong>${esc(t.criado_em)}</strong></div>
          </div>
          ${t.status === "PENDENTE" ? `<div class="data-card-actions">
            <button class="btn btn-ok btn-sm" data-exec-task="${t.id}" data-qty="${t.quantidade}">Executar Tarefa</button>
            <button class="btn btn-danger-outline btn-sm" data-cancel-task="${t.id}">Cancelar</button>
          </div>` : ""}
        </div>`;
      }).join("");

      box.querySelectorAll("[data-exec-task]").forEach(btn => {
        btn.onclick = () => {
          const id = parseInt(btn.dataset.execTask, 10);
          const qty = btn.dataset.qty;
          openConfirm({
            title: "Executar Tarefa #" + id,
            body: "Confirme a quantidade fisicamente movimentada para concluir a transferência.",
            okLabel: "Concluir",
            promptLabel: "Quantidade movimentada (esperado: " + qty + " un.)",
            promptValue: qty,
            onConfirm: val => {
              try {
                const res = call("executarTarefaMovimentacao", { id, quantidade_confirmada: parseInt(val, 10) });
                vibrate(45);
                toast(res.message, "ok");
                loadMoveTasks();
              } catch (e) { toast(e.message, "err"); }
            }
          });
        };
      });

      box.querySelectorAll("[data-cancel-task]").forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.cancelTask;
          openConfirm({
            title: "Cancelar Tarefa #" + id + "?",
            body: "Esta tarefa pendente será cancelada sem alterar o estoque.",
            okLabel: "Cancelar Tarefa",
            danger: true,
            onConfirm: () => {
              try {
                const res = call("cancelarTarefaMovimentacao", String(id));
                toast(res.message, "ok");
                loadMoveTasks();
              } catch (e) { toast(e.message, "err"); }
            }
          });
        };
      });
    } catch (e) {
      $("tarefasLista").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  /* ===================== INVENTÁRIO FÍSICO ===================== */
  function updateInvSystemPreview() {
    const num = $("invNumero").value.trim();
    const lot = $("invLote").value.trim().toUpperCase();
    const end = $("invEndereco").value.trim().toUpperCase();
    const box = $("invSystemPreview");
    if (!num || !lot || !end) {
      box.style.display = "none";
      return;
    }
    try {
      const stock = call("consultarEstoque", num).itens || [];
      const match = stock.find(s => s.lote.toUpperCase() === lot && s.endereco.toUpperCase() === end);
      const sysQty = match ? match.quantidade : 0;
      $("invSysQty").textContent = fmtNum(sysQty);
      const countedStr = $("invQtd").value.trim();
      box.style.display = "flex";
      if (countedStr !== "") {
        const diff = (parseInt(countedStr, 10) || 0) - sysQty;
        if (diff === 0) {
          box.className = "delta-box";
          $("invDeltaLabel").textContent = "Sem divergência";
        } else if (diff > 0) {
          box.className = "delta-box pos";
          $("invDeltaLabel").textContent = "+" + fmtNum(diff) + " un.";
        } else {
          box.className = "delta-box neg";
          $("invDeltaLabel").textContent = fmtNum(diff) + " un.";
        }
      } else {
        box.className = "delta-box";
        $("invDeltaLabel").textContent = "Aguardando contagem";
      }
    } catch (_) {
      box.style.display = "none";
    }
  }

  function saveInventoryCount() {
    setMsg("invMsg", "");
    try {
      const qStr = $("invQtd").value.trim();
      if (qStr === "") throw new Error("Informe a quantidade física contada.");
      const res = call("registrarInventario", {
        numero: $("invNumero").value.trim(),
        lote: $("invLote").value.trim(),
        endereco: $("invEndereco").value.trim().toUpperCase(),
        quantidade_contada: parseInt(qStr, 10)
      });
      vibrate(40);
      toast(res.message, "ok");
      setMsg("invMsg", res.message, "ok");
      updateInvSystemPreview();
    } catch (e) {
      setMsg("invMsg", e.message, "err");
    }
  }

  /* ===================== ALERTAS ===================== */
  function loadAlerts() {
    try {
      const data = call("listarAlertas");
      state.alertsCache = data.itens || [];
      renderAlerts();
    } catch (e) {
      $("alertasLista").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  function renderAlerts() {
    const f = state.alertFilter;
    const itens = state.alertsCache.filter(a => f === "TODOS" || a.tipo === f);
    const box = $("alertasLista");
    if (!itens.length) {
      box.innerHTML = `<div class="empty-state"><strong>Nenhum alerta ativo</strong><p>Operação dentro dos parâmetros de validade e estoque mínimo.</p></div>`;
      return;
    }
    const labelMap = {
      VENCIDO: { txt: "Vencido", cls: "danger" },
      VENCIMENTO_PROXIMO: { txt: "Venc. Próximo", cls: "warn" },
      ESTOQUE_MINIMO: { txt: "Estoque Mínimo", cls: "danger" }
    };
    box.innerHTML = itens.map(a => {
      const meta = labelMap[a.tipo] || { txt: a.tipo, cls: "warn" };
      return `<div class="data-card">
        <div class="data-card-top">
          <div>
            <div class="data-card-code">${esc(a.produto)} · Lote ${esc(a.lote)}</div>
            <div class="data-card-title">${esc(a.nome)}</div>
          </div>
          <span class="badge ${meta.cls}">${meta.txt}</span>
        </div>
        <div style="font-size:12.5px;color:var(--slate-700);margin-top:4px">${esc(a.detalhe)}</div>
      </div>`;
    }).join("");
  }

  /* ===================== MOVIMENTAÇÕES ===================== */
  function loadMovements() {
    try {
      const data = call("listarMovimentacoes", {
        filtro: $("movFiltro").value.trim(),
        tipo: state.movTypeFilter
      });
      const itens = data.itens || [];
      const box = $("movLista");
      if (!itens.length) {
        box.innerHTML = `<div class="empty-state"><strong>Sem registros no histórico</strong><p>Todas as entradas, saídas, transferências e inventários serão auditados aqui.</p></div>`;
        return;
      }
      box.innerHTML = itens.map(m => {
        const isOut = m.tipo === "SAIDA" || m.tipo === "SAIDA_TRANSFERENCIA" || m.tipo === "AJUSTE_INVENTARIO_SAIDA";
        const isMove = m.tipo.includes("TRANSFERENCIA");
        const badgeCls = isMove ? "" : isOut ? "danger" : "ok";
        const sign = isOut && m.quantidade > 0 ? "-" : (m.quantidade > 0 ? "+" : "");
        return `<div class="data-card">
          <div class="data-card-top">
            <div>
              <div class="data-card-code">${esc(m.produto_numero)} · ${esc(m.data_hora)}</div>
              <div class="data-card-title">${esc(m.produto_nome)}</div>
            </div>
            <span class="badge ${badgeCls}">${esc(friendlyMovType(m.tipo))}</span>
          </div>
          <div class="meta-grid">
            <div class="meta-cell"><span>Lote / Endereço</span><strong>${esc(m.lote)} · ${esc(m.endereco)}</strong></div>
            <div class="meta-cell"><span>Movimento / Saldo</span><strong class="num">${sign}${fmtNum(m.quantidade)} un. &rarr; ${fmtNum(m.saldo_apos)} un.</strong></div>
          </div>
        </div>`;
      }).join("");
    } catch (e) {
      $("movLista").innerHTML = `<div class="msg err" style="display:block">${esc(e.message)}</div>`;
    }
  }

  /* ===================== NATIVE FILE CALLBACKS ===================== */
  window.onNativeFileResult = function (res) {
    if (!res) return;
    toast(res.message || (res.ok ? "Operação concluída." : "Falha na operação."), res.ok ? "ok" : "err");
    if (res.ok) {
      vibrate(40);
      loadDashboard();
    }
  };

  /* ===================== DATE MASK ===================== */
  function attachDateMask(id) {
    $(id).addEventListener("input", () => {
      const d = $(id).value.replace(/\D/g, "").slice(0, 8);
      if (d.length <= 2) $(id).value = d;
      else if (d.length <= 4) $(id).value = d.slice(0, 2) + "/" + d.slice(2);
      else $(id).value = d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
    });
  }

  /* ===================== EVENT BINDINGS ===================== */
  window._msGo = navigate;

  function bindAll() {
    // Bottom nav
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.nav);
    });
    // Shortcuts & menu cards
    document.querySelectorAll("[data-go]").forEach(el => {
      el.onclick = () => navigate(el.dataset.go);
    });
    // Back buttons
    document.querySelectorAll("[data-back]").forEach(btn => {
      btn.onclick = () => {
        if (state.screen === "separacao" && state.sepOrderContext) {
          const ordNo = state.sepOrderContext.pedido_numero;
          resetSeparationContext();
          openOrderDetail(ordNo);
        } else {
          navigate(btn.dataset.back);
        }
      };
    });

    $("brandHomeBtn").onclick = () => navigate("dashboard");
    $("headerThemeBtn").onclick = openThemeModal;
    $("headerOperatorBtn").onclick = () => navigate("gestao");
    $("dashSeeAllMovs").onclick = e => { e.preventDefault(); navigate("movimentacoes"); };
    $("dashQuickScanStock").onclick = () => openScanner("Bipar Produto no Estoque", code => {
      $("estFiltro").value = code;
      navigate("estoque");
    });

    // Modals close
    $("btnCloseScanner").onclick = stopScanner;
    $("scannerModal").onclick = e => { if (e.target.id === "scannerModal") stopScanner(); };
    $("btnClosePicker").onclick = closePicker;
    $("pickerModal").onclick = e => { if (e.target.id === "pickerModal") closePicker(); };
    $("btnCloseEditProd").onclick = () => $("editProdModal").classList.remove("open");
    $("editProdModal").onclick = e => { if (e.target.id === "editProdModal") $("editProdModal").classList.remove("open"); };
    $("btnCloseConfirm").onclick = closeConfirm;
    $("btnConfirmCancel").onclick = closeConfirm;
    $("btnConfirmOk").onclick = () => {
      const cb = state.confirmCallback;
      const val = $("confirmPromptInput").value;
      closeConfirm();
      if (cb) cb(val);
    };

    // Stock & Catalog live search
    $("estFiltro").addEventListener("input", loadStock);
    $("btnScanEstoque").onclick = () => openScanner("Consultar Estoque", code => {
      $("estFiltro").value = code;
      loadStock();
    });

    $("prodFiltro").addEventListener("input", loadCatalog);
    $("btnScanProd").onclick = () => openScanner("Buscar no Catálogo", code => {
      $("prodFiltro").value = code;
      loadCatalog();
    });

    // Cadastro & Edit Product
    attachDateMask("cadFabricacao");
    attachDateMask("cadVencimento");
    attachDateMask("editFab");
    attachDateMask("editVenc");
    $("btnScanCadastro").onclick = () => openScanner("Código de Barras / QR", code => { $("cadCodigoBarras").value = code; });
    $("btnPickEndCad").onclick = () => pickAvailableAddress(addr => { $("cadEndereco").value = addr; });
    $("btnSalvarCadastro").onclick = saveProduct;
    $("btnSalvarEditProd").onclick = saveEditProduct;

    // Endereços
    $("btnSalvarEndereco").onclick = saveAddress;
    $("btnSalvarEndDet").onclick = saveAddressDetail;
    $("btnExcluirEndDet").onclick = deleteAddressDetail;
    document.querySelectorAll("#endFilterChips .chip").forEach(chip => {
      chip.onclick = () => {
        document.querySelectorAll("#endFilterChips .chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        state.endFilter = chip.dataset.endFilter;
        renderAddressesList();
      };
    });

    // Entrada
    $("btnScanEntrada").onclick = () => openScanner("Ler Produto (Entrada)", code => {
      $("entNumero").value = code;
      try {
        const lots = call("listarLotes", code).itens || [];
        if (lots.length === 1) {
          $("entLote").value = lots[0].lote;
          state.entCurrentQc = lots[0].unidades_por_caixa;
          updateEntCalc();
        }
      } catch (_) {}
    });
    $("btnPickLoteEnt").onclick = () => pickLotForProduct($("entNumero").value, lot => {
      $("entLote").value = lot.lote;
      state.entCurrentQc = lot.unidades_por_caixa;
      updateEntCalc();
    });
    $("btnPickEndEnt").onclick = () => pickAvailableAddress(addr => { $("entEndereco").value = addr; });
    $("entCaixas").addEventListener("input", () => {
      const cx = parseInt($("entCaixas").value, 10) || 0;
      if (state.entCurrentQc > 0 && cx > 0) {
        $("entQuantidade").value = cx * state.entCurrentQc;
      }
      updateEntCalc();
    });
    $("entQuantidade").addEventListener("input", updateEntCalc);
    $("btnSalvarEntrada").onclick = saveEntry;

    // Pedidos
    $("ordFiltro").addEventListener("input", loadOrders);
    $("btnNovaOrdemToggle").onclick = () => {
      state.ordDraft = [];
      renderOrderDraft();
      $("ordCliente").value = "";
      $("ordProdQty").value = "";
      setMsg("ordMsg", "");
      populateOrderProducts();
      $("novaOrdemCard").style.display = "block";
    };
    $("btnFecharNovaOrdem").onclick = () => { $("novaOrdemCard").style.display = "none"; };
    $("btnAddOrdItem").onclick = () => {
      const sel = $("ordProdSelect");
      const pid = parseInt(sel.value, 10);
      const qty = parseInt($("ordProdQty").value, 10) || 0;
      if (!pid || qty <= 0) { toast("Selecione um produto e informe a quantidade.", "err"); return; }
      const label = sel.options[sel.selectedIndex].dataset.label || sel.options[sel.selectedIndex].text;
      const existing = state.ordDraft.find(x => x.produto_id === pid);
      if (existing) existing.quantidade += qty;
      else state.ordDraft.push({ produto_id: pid, quantidade: qty, label });
      $("ordProdQty").value = "";
      renderOrderDraft();
    };
    $("btnCriarOrdem").onclick = () => {
      setMsg("ordMsg", "");
      try {
        const res = call("criarPedido", {
          cliente: $("ordCliente").value.trim(),
          itens: state.ordDraft.map(x => ({ produto_id: x.produto_id, quantidade: x.quantidade }))
        });
        vibrate(40);
        toast(res.message, "ok");
        $("novaOrdemCard").style.display = "none";
        loadOrders();
      } catch (e) { setMsg("ordMsg", e.message, "err"); }
    };

    // Separação
    $("btnScanSep").onclick = () => openScanner("Ler Produto (Separação)", code => { $("sepProduto").value = code; });
    $("btnGerarOrientacao").onclick = generateSeparationPreview;
    $("btnConfirmarSep").onclick = confirmSeparation;
    $("btnCancelarSep").onclick = () => {
      $("sepConfirmBox").style.display = "none";
      state.sepPreview = null;
      setMsg("sepConfirmMsg", "");
    };

    // Checkout
    $("btnCarregarCheckout").onclick = () => loadCheckoutOrder($("chkOrdemSelect").value);
    $("btnScanCheckout").onclick = () => openScanner("Bipar Caixa (produto|lote)", code => {
      $("chkCodigoCaixa").value = code;
      submitCheckoutBox();
    });
    $("btnBiparCaixa").onclick = submitCheckoutBox;

    // Transferências & Tarefas
    document.querySelectorAll("#transModeChips .chip").forEach(c => {
      c.onclick = () => switchTransferTab(c.dataset.transTab);
    });
    document.querySelectorAll("#taskFilterChips .chip").forEach(c => {
      c.onclick = () => {
        document.querySelectorAll("#taskFilterChips .chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
        state.taskStatusFilter = c.dataset.taskStatus;
        loadMoveTasks();
      };
    });
    $("btnScanTrans").onclick = () => openScanner("Ler Produto (Transferência)", code => { $("trNumero").value = code; });
    $("btnPickLoteTrans").onclick = () => pickLotForProduct($("trNumero").value, lot => { $("trLote").value = lot.lote; });
    $("btnPickEndDestTrans").onclick = () => pickAvailableAddress(addr => { $("trDestino").value = addr; });
    $("btnExecutarTransDireta").onclick = executeDirectTransfer;
    $("btnAgendarTarefa").onclick = createMoveTask;

    // Inventário
    $("btnScanInv").onclick = () => openScanner("Ler Produto (Inventário)", code => {
      $("invNumero").value = code;
      updateInvSystemPreview();
    });
    ["invNumero", "invLote", "invEndereco", "invQtd"].forEach(id => $(id).addEventListener("input", updateInvSystemPreview));
    $("btnSalvarInventario").onclick = saveInventoryCount;

    // Alertas
    $("btnAtualizarAlertas").onclick = () => { loadAlerts(); toast("Alertas atualizados.", "info"); };
    document.querySelectorAll("#alertFilterChips .chip").forEach(c => {
      c.onclick = () => {
        document.querySelectorAll("#alertFilterChips .chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
        state.alertFilter = c.dataset.alertFilter;
        renderAlerts();
      };
    });

    // Movimentações
    $("movFiltro").addEventListener("input", loadMovements);
    document.querySelectorAll("#movFilterChips .chip").forEach(c => {
      c.onclick = () => {
        document.querySelectorAll("#movFilterChips .chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
        state.movTypeFilter = c.dataset.movType;
        loadMovements();
      };
    });

    // Gestão / Backup / Config
    $("btnSalvarConfig").onclick = saveConfig;
    $("btnExportBackup").onclick = () => {
      try { call("exportarBackupArquivo"); } catch (e) { toast(e.message, "err"); }
    };
    $("btnImportBackup").onclick = () => {
      openConfirm({
        title: "Restaurar Backup Local?",
        body: "Os dados atuais do aplicativo serão substituídos pelos registros do arquivo JSON selecionado.",
        okLabel: "Selecionar Arquivo",
        onConfirm: () => {
          try { call("importarBackupArquivo"); } catch (e) { toast(e.message, "err"); }
        }
      });
    };
    $("btnExportCsv").onclick = () => {
      try { call("exportarEstoqueCsvArquivo"); } catch (e) { toast(e.message, "err"); }
    };
    $("btnSeedDemo").onclick = () => {
      try {
        const res = call("carregarDemonstracao");
        vibrate(40);
        toast(res.message, "ok");
        navigate("dashboard");
      } catch (e) { toast(e.message, "err"); }
    };
    $("btnClearDb").onclick = () => {
      openConfirm({
        title: "Zerar toda a base local?",
        body: "Esta ação apagará permanentemente produtos, lotes, endereços, saldos, ordens e histórico deste aparelho. Faça um backup antes se desejar preservar os dados.",
        okLabel: "Apagar Tudo",
        danger: true,
        onConfirm: () => {
          try {
            const res = call("limparBaseLocal");
            toast(res.message, "info");
            navigate("dashboard");
          } catch (e) { toast(e.message, "err"); }
        }
      });
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindAll();
    loadConfig();
    loadDashboard();
  });
})();
