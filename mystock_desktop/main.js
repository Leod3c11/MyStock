const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const path = require("node:path");
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
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });
  try {
    database = new Database(app.getPath("userData"));
    const methods = {
      statusAuth: () => database.authStatus(),
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
    const publicMethods=new Set(["statusAuth","criarAdminInicial","login","logout"]);
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
  if (database) database.close();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});