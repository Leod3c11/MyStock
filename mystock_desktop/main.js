const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const path = require("node:path");
const Database = require("./database");

let mainWindow;
let database;

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
    for (const [name, fn] of Object.entries(methods)) {
      ipcMain.on("mystock:" + name, (event, payload) => {
        event.returnValue = serializeResult(fn)(event, payload);
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