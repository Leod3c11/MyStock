const { contextBridge, ipcRenderer } = require("electron");

const methods = [
  "statusAuth", "criarAdminInicial", "login", "logout", "enderecoLan",
  "listarUsuarios", "salvarUsuario", "alternarUsuario", "listarSessoesLan",
  "salvarProduto", "editarProduto", "criarPedido", "listarPedidos", "obterPedido",
  "salvarEndereco",
  "listarEnderecos",
  "registrarEntrada",
  "consultarEstoque",
  "listarLotes",
  "listarProdutos",
  "listarEstoqueMinimo",
  "listarMovimentacoes",
  "listarAuditoriaOperadores",
  "listarAuditoria",
  "previewSeparacao",
  "confirmarSeparacao"
];

const api = {};
for (const name of methods) {
  api[name] = payload => ipcRenderer.sendSync("mystock:" + name, payload);
}

contextBridge.exposeInMainWorld("MyStock", Object.freeze(api));