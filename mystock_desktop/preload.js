const { contextBridge, ipcRenderer } = require("electron");

const methods = [
  "statusAuth", "criarAdminInicial", "login", "logout", "enderecoLan",
  "listarUsuarios", "salvarUsuario", "alternarUsuario", "listarSessoesLan",
  "salvarProduto", "editarProduto", "salvarCliente", "listarClientes", "criarPedido", "listarPedidos", "obterPedido",
  "salvarEndereco",
  "listarEnderecos",
  "registrarEntrada",
  "consultarEstoque",
  "moverEstoque",
  "criarTarefaMovimentacao",
  "listarTarefasMovimentacao",
  "executarTarefaMovimentacao",
  "cancelarTarefaMovimentacao",
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

api.backupDatabase = () => ipcRenderer.invoke("mystock:backupDatabase");

contextBridge.exposeInMainWorld("MyStock", Object.freeze(api));