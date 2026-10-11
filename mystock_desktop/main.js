const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const path = require("node:path");
const http = require("node:http");
const dgram = require("node:dgram");
const os = require("node:os");
const crypto = require("node:crypto");

const LAN_PORT = 8765;
const DISCOVERY_PORT = 8766;
const lanSessions = new Map();
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let lanServer = null;
let discoverySocket = null;

function loginLockState(key) {
  const now = Date.now();
  const state = loginFailures.get(key);
  if (!state) return { locked: false, remaining: LOGIN_MAX_FAILURES };
  if (state.lockedUntil > now) return { locked: true, waitMs: state.lockedUntil - now, remaining: 0 };
  if (now - state.windowStart >= LOGIN_WINDOW_MS || state.lockedUntil) {
    loginFailures.delete(key);
    return { locked: false, remaining: LOGIN_MAX_FAILURES };
  }
  return { locked: false, remaining: Math.max(0, LOGIN_MAX_FAILURES - state.count) };
}

function loginFailed(key) {
  const now = Date.now();
  let state = loginFailures.get(key);
  if (!state || now - state.windowStart >= LOGIN_WINDOW_MS || state.lockedUntil) state = { count: 0, windowStart: now, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= LOGIN_MAX_FAILURES) state.lockedUntil = now + LOGIN_WINDOW_MS;
  loginFailures.set(key, state);
  return loginLockState(key);
}

function loginSucceeded(key) {
  loginFailures.delete(key);
}

function startLanServer(db) {
  const methods = {
    salvarProduto: value => db.saveProduct(JSON.parse(value || "{}")),
    salvarCliente: value => db.saveClient(JSON.parse(value || "{}")),
    listarClientes: value => db.listClients(String(value || "")),
    editarProduto: value => db.editProduct(JSON.parse(value || "{}")),
    criarPedido: value => db.createOrder(JSON.parse(value || "{}")),
    listarPedidos: value => db.listOrders(String(value || "")),
    obterPedido: value => db.getOrder(JSON.parse(value || "{}").numero),
    salvarEndereco: value => db.saveAddress(JSON.parse(value || "{}")),
    listarEnderecos: value => db.listAddresses(String(value) === "true"),
    registrarEntrada: value => db.registerEntry(JSON.parse(value || "{}")),
    moverEstoque: value => db.moveStock(JSON.parse(value || "{}")),
    criarTarefaMovimentacao: value => db.createMoveTask(JSON.parse(value || "{}"), "ADMIN_SESSION"),
    listarTarefasMovimentacao: value => db.listMoveTasks(String(value || ""), "operador"),
    executarTarefaMovimentacao: value => db.executeMoveTask(JSON.parse(value || "{}"), "OPERATOR_SESSION"),
    cancelarTarefaMovimentacao: value => db.cancelMoveTask(JSON.parse(value || "{}").id, "ADMIN_SESSION"),
    criarTarefaMovimentacao: value => db.createMoveTask(JSON.parse(value || "{}"), "ADMIN_SESSION"),
    listarTarefasMovimentacao: value => db.listMoveTasks(String(value || ""), "operador"),
    executarTarefaMovimentacao: value => db.executeMoveTask(JSON.parse(value || "{}"), "OPERATOR_SESSION"),
    cancelarTarefaMovimentacao: value => db.cancelMoveTask(JSON.parse(value || "{}").id, "ADMIN_SESSION"),
    consultarEstoque: value => db.listStock(String(value || "")),
    listarLotes: value => db.listLots(String(value || "")),
    listarProdutos: value => db.listProducts(String(value || "")),
    listarEstoqueMinimo: () => db.listLowStock(),
    listarMovimentacoes: value => db.listMovements(String(value || "")),
    listarAuditoriaOperadores: () => db.listAuditOperators(),
    listarAuditoria: value => db.listAudit(JSON.parse(value || "{}")),
    previewSeparacao: value => db.previewSeparation(JSON.parse(value || "{}")),
    confirmarSeparacao: value => db.confirmSeparation(JSON.parse(value || "{}"))
  };
  const permissionByMethod = {
    salvarProduto:"cadastro", editarProduto:"cadastro", listarProdutos:"produtos", salvarCliente:"separacao", listarClientes:"separacao", criarPedido:"separacao", listarPedidos:"separacao", obterPedido:"separacao", registrarEntrada:"entrada",
    listarLotes:"entrada", moverEstoque:"produtos", salvarEndereco:"enderecos", listarEnderecos:"enderecos", listarEstoqueMinimo:"produtos",
    consultarEstoque:"consulta_estoque", previewSeparacao:"separacao",
    confirmarSeparacao:"separacao", listarMovimentacoes:"movimentacoes"
  };
  const send = (res, status, data) => {
    res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
    res.end(JSON.stringify(data));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { reject(new Error("Requisição muito grande.")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/status") {
      return send(res, 200, db.authStatus());
    }
    if (req.method !== "POST") return send(res, 405, {ok:false,error:"Método não permitido."});
    let body;
    try { body = await readBody(req); }
    catch (error) { return send(res, 400, {ok:false,error:error.message || "Requisição inválida."}); }
    try {
      if (req.url === "/api/login") {
        const username = String(body.username || "").trim().toLowerCase().slice(0,80);
        const clientIp = String(req.socket.remoteAddress || "desconhecido").replace(/^::ffff:/, "");
        const key = "lan:" + clientIp + ":" + username;
        const lock = loginLockState(key);
        if (lock.locked) return send(res, 429, {ok:false,error:"Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente."});
        let result;
        try { result = db.loginUser(body); }
        catch (loginError) {
          const state = loginFailed(key);
          return send(res, state.locked ? 429 : 401, {ok:false,error:state.locked?"Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.":"Usuário ou senha inválidos, ou conta desativada."});
        }
        loginSucceeded(key);
        const token = crypto.randomBytes(32).toString("hex");
        if (!result || !result.ok || !result.user) return send(res, 401, result || {ok:false,error:"Login inválido."});
        const now = Date.now();
        lanSessions.set(token, {
          userId: result.user.id,
          nome: result.user.nome,
          username: result.user.username,
          role: result.user.role,
          ip: req.socket.remoteAddress || "",
          createdAt: now,
          lastSeen: now,
          lastActivity: now
        });
        return send(res, 200, {...result, token});
      }
      if (req.url === "/api/logout") {
        lanSessions.delete(String(body.token || ""));
        return send(res, 200, {ok:true});
      }
      if (req.url !== "/api/call" && req.url !== "/api/heartbeat") return send(res, 404, {ok:false,error:"Rota não encontrada."});
      const tokenValue = String(body.token || "");
      const sessionData = lanSessions.get(tokenValue);
      if (!sessionData) return send(res, 401, {ok:false,error:"Sessão encerrada. Entre novamente."});
      if (Date.now() - sessionData.createdAt > 12 * 60 * 60 * 1000) {
        lanSessions.delete(String(body.token || ""));
        return send(res, 401, {ok:false,error:"Sessão expirada. Entre novamente."});
      }
      if (Date.now() - Number(sessionData.lastActivity || sessionData.createdAt) > SESSION_IDLE_TIMEOUT_MS) {
        lanSessions.delete(tokenValue);
        return send(res, 401, {ok:false,error:"Sessão encerrada por 30 minutos de inatividade. Entre novamente."});
      }
      const user = db.getUserById(sessionData.userId);
      if (!user || !user.ativo) {
        lanSessions.delete(tokenValue);
        return send(res, 401, {ok:false,error:"Conta desativada. Entre novamente com uma conta ativa."});
      }
      sessionData.lastSeen = Date.now();
      sessionData.nome = user.nome;
      sessionData.username = user.username;
      sessionData.role = user.role;
      sessionData.ip = req.socket.remoteAddress || sessionData.ip;
      if (req.url === "/api/heartbeat") return send(res, 200, {ok:true,serverTime:Date.now()});
      sessionData.lastActivity = Date.now();
      const name = String(body.method || "");
      const method = methods[name];
      if (!method) return send(res, 400, {ok:false,error:"Operação desconhecida."});
      if (name==="moverEstoque" && user.role!=="admin")
        return send(res,403,{ok:false,error:"Somente o administrador pode mover estoque entre endereços."});
      if ((name==="listarAuditoriaOperadores"||name==="listarAuditoria") && user.role!=="admin")
        return send(res,403,{ok:false,error:"Apenas o administrador pode consultar a auditoria dos operadores."});
      if(name==="criarTarefaMovimentacao" && user.role!=="admin") return send(res,403,{ok:false,error:"Somente o administrador pode criar tarefas."});
       if(name==="cancelarTarefaMovimentacao" && user.role!=="admin") return send(res,403,{ok:false,error:"Somente o administrador pode cancelar tarefas."});
       const permission = permissionByMethod[name];
      if (permission && user.role !== "admin" && user.permissoes?.[permission] !== true)
        return send(res, 403, {ok:false,error:"Seu usuário não tem permissão para esta operação."});
      let payload = body.payload ?? "";
      if (typeof payload !== "string") payload = JSON.stringify(payload);
      try { payload = JSON.parse(payload); } catch {}
      let result;
      try {
        if(name==="criarTarefaMovimentacao") result=db.createMoveTask(payload,sessionData.nome);
        else if(name==="executarTarefaMovimentacao") result=db.executeMoveTask(payload,sessionData.nome);
        else if(name==="cancelarTarefaMovimentacao") result=db.cancelMoveTask(payload.id,sessionData.nome);
        else if(name==="criarTarefaMovimentacao") result=db.createMoveTask(payload,sessionData.nome);
        else if(name==="executarTarefaMovimentacao") result=db.executeMoveTask(payload,sessionData.nome);
        else if(name==="cancelarTarefaMovimentacao") result=db.cancelMoveTask(payload.id,sessionData.nome);
        else result = method(typeof payload === "object" && payload !== null ? JSON.stringify(payload) : String(payload));
      } catch (operationError) {
        if (user.role === "operador" && !["listarAuditoria","listarAuditoriaOperadores"].includes(name)) {
          try { db.recordAudit({usuario_id:user.id,operador_nome:user.nome,operador_username:user.username,dispositivo:"Android",endereco_ip:sessionData.ip,acao:name,sucesso:false,detalhes:{erro:String(operationError.message||"Falha na operação").slice(0,300)}}); } catch {}
        }
        throw operationError;
      }
      if(user.role==="operador" && result && result.ok && !["listarAuditoria","listarAuditoriaOperadores"].includes(name)){
        try{db.recordAudit({usuario_id:user.id,operador_nome:user.nome,operador_username:user.username,dispositivo:"Android",endereco_ip:sessionData.ip,acao:name,detalhes:typeof payload==="object"&&payload!==null?payload:{filtro:String(payload||"")}});}catch{}
      } else if (user.role === "operador" && result && result.ok === false && !["listarAuditoria","listarAuditoriaOperadores"].includes(name)) {
        try { db.recordAudit({usuario_id:user.id,operador_nome:user.nome,operador_username:user.username,dispositivo:"Android",endereco_ip:sessionData.ip,acao:name,sucesso:false,detalhes:{erro:String(result.error||"Operação não concluída").slice(0,300)}}); } catch {}
      }
      return send(res, 200, result);
    } catch (error) {
      return send(res, 400, {ok:false,error:error && error.message ? error.message : "Falha interna."});
    }
  });
  server.on("error", error => {
    dialog.showErrorBox("Servidor LAN do MyStock", "Não foi possível iniciar o servidor na porta " + LAN_PORT + ".\n" + (error.message || error) + "\nVerifique se outro programa está usando essa porta.");
  });
  server.listen(LAN_PORT, "0.0.0.0");
  lanServer = server;

  // Descoberta local por UDP: o Android pergunta na rede e o PC responde com os IPs disponíveis.
  try {
    discoverySocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    discoverySocket.on("message", (message, remote) => {
      if (message.toString("utf8").trim() !== "MYSTOCK_DISCOVER_V1") return;
      const reply = Buffer.from(JSON.stringify({
        service: "MyStock",
        port: LAN_PORT,
        ips: getLanIPv4Addresses()
      }), "utf8");
      discoverySocket.send(reply, remote.port, remote.address, () => {});
    });
    discoverySocket.on("error", error => {
      if (error && error.code !== "EADDRINUSE") {
        try { discoverySocket.close(); } catch {}
        discoverySocket = null;
      }
    });
    discoverySocket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      try { discoverySocket.setBroadcast(true); } catch {}
    });
  } catch {
    discoverySocket = null;
  }
  return server;
}

function getLanSessions() {
  const now = Date.now();
  const sessions = [];
  for (const [token, sessionData] of lanSessions.entries()) {
    const user = database ? database.getUserById(sessionData.userId) : null;
    if (!user || !user.ativo || now - sessionData.createdAt > 12 * 60 * 60 * 1000) {
      lanSessions.delete(token);
      continue;
    }
    sessions.push({
      nome: user.nome,
      username: user.username,
      role: user.role,
      ip: String(sessionData.ip || "").replace(/^::ffff:/, ""),
      connected: now - sessionData.lastSeen <= 45000,
      active: now - sessionData.lastActivity <= 5 * 60 * 1000,
      lastSeen: sessionData.lastSeen,
      lastActivity: sessionData.lastActivity,
      connectedFor: Math.max(0, now - sessionData.createdAt)
    });
  }
  return {ok:true,itens:sessions.sort((a,b)=>Number(b.connected)-Number(a.connected)||b.lastSeen-a.lastSeen)};
}

function getLanIPv4Addresses() {
  const found = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) found.push(item.address);
    }
  }
  return found;
}

const Database = require("./database");

let mainWindow;
let database;
let currentUser = null;
let currentUserLastActivity = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    title: "MyStock",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function serializeResult(fn) {
  return (_event, payload) => {
    try {
      return JSON.stringify(fn(payload));
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : "Falha interna."
      });
    }
  };
}

app.whenReady().then(() => {
  // No instalador do Windows, iniciar o MyStock junto com a sessão do usuário.
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false }); } catch {}
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });
  try {
    database = new Database(app.getPath("userData"));
    startLanServer(database);
    const methods = {
      statusAuth: () => database.authStatus(),
      enderecoLan: () => ({ok:true,port:LAN_PORT,ips:getLanIPv4Addresses()}),
      listarSessoesLan: () => {
        const data=getLanSessions();
        if(currentUser) data.itens.unshift({
          nome:currentUser.nome, username:currentUser.username, role:currentUser.role,
          device:"Windows", ip:"Este computador", connected:true,
          active:Date.now()-currentUserLastActivity<=5*60*1000,
          lastSeen:Date.now(), lastActivity:currentUserLastActivity,
          connectedFor:0
        });
        return data;
      },
      criarAdminInicial: value => database.createInitialAdmin(JSON.parse(value || "{}")),
      login: value => {
        const credentials=JSON.parse(value||"{}");
        const key="desktop:"+String(credentials.username||"").trim().toLowerCase().slice(0,80);
        const lock=loginLockState(key);
        if(lock.locked)throw new Error("Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.");
        try {
          const result=database.loginUser(credentials);
          loginSucceeded(key);
          if(result.ok){currentUser=result.user;currentUserLastActivity=Date.now();}
          return result;
        } catch(error) {
          const state=loginFailed(key);
          if(state.locked)throw new Error("Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.");
          throw error;
        }
      },
      logout: () => { currentUser=null;currentUserLastActivity=0; return {ok:true}; },
      listarUsuarios: () => database.listUsers(),
      salvarUsuario: value => database.saveUser(JSON.parse(value||"{}")),
      alternarUsuario: value => { const data=JSON.parse(value||"{}"); if(currentUser&&Number(data.id)===Number(currentUser.id))throw new Error("Não é permitido desativar a própria conta."); return database.toggleUser(data); },
      salvarProduto: value => database.saveProduct(JSON.parse(value || "{}")),
      salvarCliente: value => database.saveClient(JSON.parse(value || "{}")),
      listarClientes: value => database.listClients(String(value || "")),
      editarProduto: value => database.editProduct(JSON.parse(value || "{}")),
      criarPedido: value => database.createOrder(JSON.parse(value || "{}")),
      listarPedidos: value => database.listOrders(String(value || "")),
      obterPedido: value => database.getOrder(JSON.parse(value || "{}").numero),
      salvarEndereco: value => database.saveAddress(JSON.parse(value || "{}")),
      listarEnderecos: value => database.listAddresses(String(value) === "true"),
      registrarEntrada: value => database.registerEntry(JSON.parse(value || "{}")),
      moverEstoque: value => { if(!currentUser||currentUser.role!=="admin") throw new Error("Somente o administrador pode mover estoque entre endereços."); return database.moveStock(JSON.parse(value||"{}")); },
      criarTarefaMovimentacao: value => { if(!currentUser||currentUser.role!=="admin") throw new Error("Somente o administrador pode criar tarefas."); return database.createMoveTask(JSON.parse(value||"{}"),currentUser.nome); },
      listarTarefasMovimentacao: value => database.listMoveTasks(String(value||""),currentUser?.role||"operador"),
      executarTarefaMovimentacao: value => database.executeMoveTask(JSON.parse(value||"{}"),currentUser?.nome||"Operador"),
      cancelarTarefaMovimentacao: value => { if(!currentUser||currentUser.role!=="admin") throw new Error("Somente o administrador pode cancelar tarefas."); return database.cancelMoveTask(JSON.parse(value||"{}").id,currentUser.nome); },
      criarTarefaMovimentacao: value => { if(!currentUser||currentUser.role!=="admin") throw new Error("Somente o administrador pode criar tarefas."); return database.createMoveTask(JSON.parse(value||"{}"),currentUser.nome); },
      listarTarefasMovimentacao: value => database.listMoveTasks(String(value||""),currentUser?.role||"operador"),
      executarTarefaMovimentacao: value => database.executeMoveTask(JSON.parse(value||"{}"),currentUser?.nome||"Operador"),
      cancelarTarefaMovimentacao: value => { if(!currentUser||currentUser.role!=="admin") throw new Error("Somente o administrador pode cancelar tarefas."); return database.cancelMoveTask(JSON.parse(value||"{}").id,currentUser.nome); },
      consultarEstoque: value => database.listStock(String(value || "")),
      listarLotes: value => database.listLots(String(value || "")),
      listarProdutos: value => database.listProducts(String(value || "")),
      listarEstoqueMinimo: () => database.listLowStock(),
      listarMovimentacoes: value => database.listMovements(String(value || "")),
      listarAuditoriaOperadores: () => database.listAuditOperators(),
      listarAuditoria: value => database.listAudit(JSON.parse(value || "{}")),
      previewSeparacao: value => database.previewSeparation(JSON.parse(value || "{}")),
      confirmarSeparacao: value => database.confirmSeparation(JSON.parse(value || "{}"))
    };
    const permissionByMethod={salvarProduto:"cadastro",editarProduto:"cadastro",listarProdutos:"produtos",salvarCliente:"separacao",listarClientes:"separacao",listarEstoqueMinimo:"produtos",criarPedido:"separacao",listarPedidos:"separacao",obterPedido:"separacao",registrarEntrada:"entrada",listarLotes:"entrada",salvarEndereco:"enderecos",listarEnderecos:"enderecos",consultarEstoque:"consulta_estoque",previewSeparacao:"separacao",confirmarSeparacao:"separacao",listarMovimentacoes:"movimentacoes"};
    const adminOnly=new Set(["listarUsuarios","salvarUsuario","alternarUsuario","listarSessoesLan","listarAuditoriaOperadores","listarAuditoria"]);
    const publicMethods=new Set(["statusAuth","criarAdminInicial","login","logout","enderecoLan"]);
    for(const [name,fn] of Object.entries(methods)){
      ipcMain.on("mystock:"+name,(event,payload)=>{
        try{
          if(!publicMethods.has(name)){
            if(!currentUser)throw new Error("Faça login para continuar.");
             if(Date.now()-currentUserLastActivity>SESSION_IDLE_TIMEOUT_MS){currentUser=null;currentUserLastActivity=0;throw new Error("Sessão encerrada por 30 minutos de inatividade. Entre novamente.");}
            const fresh=database.getUserById(currentUser.id);
            if(!fresh||!fresh.ativo){currentUser=null;throw new Error("Sua conta foi desativada. Faça login com uma conta ativa.");}
            currentUser=fresh;
            if(name!=="listarSessoesLan")currentUserLastActivity=Date.now();
            if(adminOnly.has(name)&&currentUser.role!=="admin")throw new Error("Apenas o administrador pode gerenciar usuários.");
            const permission=permissionByMethod[name];
            if(permission&&currentUser.role!=="admin"&&currentUser.permissoes?.[permission]!==true)throw new Error("Seu usuário não tem permissão para esta operação.");
          }
          const result=fn(payload);
          const auditedMethods=new Set(["salvarProduto","editarProduto","criarPedido","listarPedidos","obterPedido","salvarEndereco","listarEnderecos","registrarEntrada","consultarEstoque","listarLotes","listarProdutos","listarEstoqueMinimo","listarMovimentacoes","previewSeparacao","confirmarSeparacao"]);
          if(currentUser?.role==="operador"&&auditedMethods.has(name)&&result?.ok){
            let details={};try{details=typeof payload==="string"?JSON.parse(payload||"{}"):payload||{};}catch{details={filtro:String(payload||"")};}
            try{database.recordAudit({usuario_id:currentUser.id,operador_nome:currentUser.nome,operador_username:currentUser.username,dispositivo:"Windows",endereco_ip:"Este computador",acao:name,detalhes:details});}catch{}
          }
          event.returnValue=JSON.stringify(result);
        }catch(error){
          const auditMethods=new Set(["salvarProduto","editarProduto","criarPedido","listarPedidos","obterPedido","salvarEndereco","listarEnderecos","registrarEntrada","consultarEstoque","listarLotes","listarProdutos","listarEstoqueMinimo","listarMovimentacoes","previewSeparacao","confirmarSeparacao"]);
          if(currentUser?.role==="operador"&&auditMethods.has(name)){
            let details={};try{details=typeof payload==="string"?JSON.parse(payload||"{}"):payload||{};}catch{details={};}
            details={...details,erro:String(error&&error.message?error.message:"Falha interna.").slice(0,300)};
            try{database.recordAudit({usuario_id:currentUser.id,operador_nome:currentUser.nome,operador_username:currentUser.username,dispositivo:"Windows",endereco_ip:"Este computador",acao:name,sucesso:false,detalhes:details});}catch{}
          }
          event.returnValue=JSON.stringify({ok:false,error:error&&error.message?error.message:"Falha interna."});
        }
      });
    }
    ipcMain.handle("mystock:backupDatabase", async (event) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Solicitação não autorizada.");
      if (!currentUser) throw new Error("Faça login para continuar.");
      const fresh = database.getUserById(currentUser.id);
      if (!fresh || !fresh.ativo || fresh.role !== "admin") throw new Error("Somente o administrador pode criar cópias de segurança.");
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: "Criar cópia de segurança do MyStock",
        defaultPath: "MyStock-backup-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0,19) + ".db",
        buttonLabel: "Salvar cópia",
        filters: [{ name: "Banco de dados SQLite", extensions: ["db"] }]
      });
      if (choice.canceled || !choice.filePath) return {ok:false,canceled:true,message:"Cópia cancelada."};
      await database.db.backup(choice.filePath);
      return {ok:true,message:"Cópia de segurança criada com sucesso.",path:choice.filePath};
    });

    createWindow();
  } catch (error) {
    dialog.showErrorBox("MyStock - erro ao iniciar", error.message || String(error));
    app.quit();
  }
});

app.on("before-quit", () => {
  if (discoverySocket) { try { discoverySocket.close(); } catch {} discoverySocket = null; }
  if (lanServer) lanServer.close();
  if (database) database.close();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});