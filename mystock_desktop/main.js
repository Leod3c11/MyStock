const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const path = require("node:path");
const http = require("node:http");
const dgram = require("node:dgram");
const os = require("node:os");
const crypto = require("node:crypto");

const LAN_PORT = 8765;
const DISCOVERY_PORT = 8766;
const lanSessions = new Map();
let lanServer = null;
let discoverySocket = null;

function startLanServer(db) {
  const methods = {
    salvarProduto: value => db.saveProduct(JSON.parse(value || "{}")),
    salvarEndereco: value => db.saveAddress(JSON.parse(value || "{}")),
    listarEnderecos: value => db.listAddresses(String(value) === "true"),
    registrarEntrada: value => db.registerEntry(JSON.parse(value || "{}")),
    consultarEstoque: value => db.listStock(String(value || "")),
    listarLotes: value => db.listLots(String(value || "")),
    listarProdutos: value => db.listProducts(String(value || "")),
    listarMovimentacoes: value => db.listMovements(String(value || "")),
    previewSeparacao: value => db.previewSeparation(JSON.parse(value || "{}")),
    confirmarSeparacao: value => db.confirmSeparation(JSON.parse(value || "{}"))
  };
  const permissionByMethod = {
    salvarProduto:"cadastro", listarProdutos:"produtos", registrarEntrada:"entrada",
    listarLotes:"entrada", salvarEndereco:"enderecos", listarEnderecos:"enderecos",
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
        const result = db.loginUser(body);
        const token = crypto.randomBytes(32).toString("hex");
        lanSessions.set(token, { userId: result.user.id, createdAt: Date.now() });
        return send(res, 200, {...result, token});
      }
      if (req.url === "/api/logout") {
        lanSessions.delete(String(body.token || ""));
        return send(res, 200, {ok:true});
      }
      if (req.url !== "/api/call") return send(res, 404, {ok:false,error:"Rota não encontrada."});
      const sessionData = lanSessions.get(String(body.token || ""));
      if (!sessionData) return send(res, 401, {ok:false,error:"Sessão encerrada. Entre novamente."});
      if (Date.now() - sessionData.createdAt > 12 * 60 * 60 * 1000) {
        lanSessions.delete(String(body.token || ""));
        return send(res, 401, {ok:false,error:"Sessão expirada. Entre novamente."});
      }
      const user = db.getUserById(sessionData.userId);
      if (!user || !user.ativo) {
        lanSessions.delete(String(body.token || ""));
        return send(res, 401, {ok:false,error:"Conta desativada. Entre novamente com uma conta ativa."});
      }
      const name = String(body.method || "");
      const method = methods[name];
      if (!method) return send(res, 400, {ok:false,error:"Operação desconhecida."});
      const permission = permissionByMethod[name];
      if (permission && user.role !== "admin" && user.permissoes?.[permission] !== true)
        return send(res, 403, {ok:false,error:"Seu usuário não tem permissão para esta operação."});
      let payload = body.payload ?? "";
      if (typeof payload !== "string") payload = JSON.stringify(payload);
      try { payload = JSON.parse(payload); } catch {}
      const result = method(typeof payload === "object" && payload !== null ? JSON.stringify(payload) : String(payload));
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
      criarAdminInicial: value => database.createInitialAdmin(JSON.parse(value || "{}")),
      login: value => { const result=database.loginUser(JSON.parse(value||"{}")); if(result.ok)currentUser=result.user; return result; },
      logout: () => { currentUser=null; return {ok:true}; },
      listarUsuarios: () => database.listUsers(),
      salvarUsuario: value => database.saveUser(JSON.parse(value||"{}")),
      alternarUsuario: value => { const data=JSON.parse(value||"{}"); if(currentUser&&Number(data.id)===Number(currentUser.id))throw new Error("Não é permitido desativar a própria conta."); return database.toggleUser(data); },
      salvarProduto: value => database.saveProduct(JSON.parse(value || "{}")),
      salvarEndereco: value => database.saveAddress(JSON.parse(value || "{}")),
      listarEnderecos: value => database.listAddresses(String(value) === "true"),
      registrarEntrada: value => database.registerEntry(JSON.parse(value || "{}")),
      consultarEstoque: value => database.listStock(String(value || "")),
      listarLotes: value => database.listLots(String(value || "")),
      listarProdutos: value => database.listProducts(String(value || "")),
      listarMovimentacoes: value => database.listMovements(String(value || "")),
      previewSeparacao: value => database.previewSeparation(JSON.parse(value || "{}")),
      confirmarSeparacao: value => database.confirmSeparation(JSON.parse(value || "{}"))
    };
    const permissionByMethod={salvarProduto:"cadastro",listarProdutos:"produtos",registrarEntrada:"entrada",listarLotes:"entrada",salvarEndereco:"enderecos",listarEnderecos:"enderecos",consultarEstoque:"consulta_estoque",previewSeparacao:"separacao",confirmarSeparacao:"separacao",listarMovimentacoes:"movimentacoes"};
    const adminOnly=new Set(["listarUsuarios","salvarUsuario","alternarUsuario"]);
    const publicMethods=new Set(["statusAuth","criarAdminInicial","login","logout","enderecoLan"]);
    for(const [name,fn] of Object.entries(methods)){
      ipcMain.on("mystock:"+name,(event,payload)=>{
        try{
          if(!publicMethods.has(name)){
            if(!currentUser)throw new Error("Faça login para continuar.");
            const fresh=database.getUserById(currentUser.id);
            if(!fresh||!fresh.ativo){currentUser=null;throw new Error("Sua conta foi desativada. Faça login com uma conta ativa.");}
            currentUser=fresh;
            if(adminOnly.has(name)&&currentUser.role!=="admin")throw new Error("Apenas o administrador pode gerenciar usuários.");
            const permission=permissionByMethod[name];
            if(permission&&currentUser.role!=="admin"&&currentUser.permissoes?.[permission]!==true)throw new Error("Seu usuário não tem permissão para esta operação.");
          }
          event.returnValue=JSON.stringify(fn(payload));
        }catch(error){event.returnValue=JSON.stringify({ok:false,error:error&&error.message?error.message:"Falha interna."});}
      });
    }
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