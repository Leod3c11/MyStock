const { contextBridge, ipcRenderer } = require("electron");

const methods = [
  "statusAuth", "criarAdminInicial", "login", "logout",
  "listarUsuarios", "salvarUsuario", "alternarUsuario",
  "salvarProduto",
  "salvarEndereco",
  "listarEnderecos",
  "registrarEntrada",
  "consultarEstoque",
  "listarLotes",
  "listarProdutos",
  "listarMovimentacoes",
  "previewSeparacao",
  "confirmarSeparacao"
];

const api = {};
for (const name of methods) {
  api[name] = payload => ipcRenderer.sendSync("mystock:" + name, payload);
}

contextBridge.exposeInMainWorld("MyStock", Object.freeze(api));