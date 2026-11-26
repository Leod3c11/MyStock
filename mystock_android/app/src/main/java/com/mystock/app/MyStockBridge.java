package com.mystock.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

public class MyStockBridge {
    private final MainActivity activity;
    private final MyStockDbHelper db;
    private final SharedPreferences prefs;

    public MyStockBridge(MainActivity activity, MyStockDbHelper db) {
        this.activity = activity;
        this.db = db;
        this.prefs = activity.getSharedPreferences("mystock_standalone_prefs", Context.MODE_PRIVATE);
    }

    private String fail(Exception e) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", e.getMessage() == null ? "Erro interno." : e.getMessage());
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"Erro interno.\"}";
        }
    }

    private String operatorName() {
        return prefs.getString("operador", "Operador 01");
    }

    private int alertDays() {
        return prefs.getInt("dias_alerta", 30);
    }

    /* ===================== CONFIG & NATIVO ===================== */

    @JavascriptInterface
    public String obterConfig() {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("operador", operatorName());
            out.put("deposito", prefs.getString("deposito", "CD Principal · Standalone"));
            out.put("dias_alerta", alertDays());
            out.put("som_ativo", prefs.getBoolean("som_ativo", true));
            out.put("vibracao_ativa", prefs.getBoolean("vibracao_ativa", true));
            out.put("versao", "2.0.0");
            return out.toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    @JavascriptInterface
    public String salvarConfig(String json) {
        try {
            JSONObject data = new JSONObject(json);
            String op = data.optString("operador", "Operador 01").trim();
            String dep = data.optString("deposito", "CD Principal · Standalone").trim();
            int dias = Math.max(1, Math.min(365, data.optInt("dias_alerta", 30)));
            boolean som = data.optBoolean("som_ativo", true);
            boolean vib = data.optBoolean("vibracao_ativa", true);
            if (op.isEmpty()) op = "Operador 01";
            if (dep.isEmpty()) dep = "CD Principal · Standalone";
            prefs.edit()
                    .putString("operador", op)
                    .putString("deposito", dep)
                    .putInt("dias_alerta", dias)
                    .putBoolean("som_ativo", som)
                    .putBoolean("vibracao_ativa", vib)
                    .apply();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", "Configurações salvas no dispositivo.");
            return out.toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    @JavascriptInterface
    public void vibrar(int ms) {
        if (prefs.getBoolean("vibracao_ativa", true)) {
            activity.triggerVibration(ms);
        }
    }

    @JavascriptInterface
    public boolean temPermissaoCamera() {
        return activity.hasCameraPermission();
    }

    @JavascriptInterface
    public void solicitarPermissaoCamera() {
        activity.requestCameraPermissionFromJs();
    }

    @JavascriptInterface
    public String exportarBackupArquivo() {
        try {
            String content = db.exportBackupJson();
            activity.launchExportFile(content, "application/json", "mystock-backup-" + timestampShort() + ".json", "BACKUP_JSON");
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", "Selecione onde salvar o arquivo de backup.");
            return out.toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    @JavascriptInterface
    public String importarBackupArquivo() {
        try {
            activity.launchImportBackupFile();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", "Selecione o arquivo de backup (.json).");
            return out.toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    @JavascriptInterface
    public String exportarEstoqueCsvArquivo() {
        try {
            String csv = db.exportStockCsv();
            activity.launchExportFile(csv, "text/csv", "mystock-estoque-" + timestampShort() + ".csv", "CSV_ESTOQUE");
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", "Selecione onde salvar a planilha CSV.");
            return out.toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    private String timestampShort() {
        return new java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(new java.util.Date());
    }

    /* ===================== DASHBOARD ===================== */

    @JavascriptInterface
    public String resumoDashboard() {
        try { return db.getDashboardSummary(alertDays()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== PRODUTOS & LOTES ===================== */

    @JavascriptInterface
    public String salvarProduto(String json) {
        try { return db.saveProduct(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String editarProduto(String json) {
        try { return db.editProduct(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarProdutos(String filtro) {
        try { return db.listProducts(filtro).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarProdutosUnicos(String filtro) {
        try { return db.listUniqueProducts(filtro).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarLotes(String produto) {
        try { return db.listLots(produto).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== ENDEREÇOS ===================== */

    @JavascriptInterface
    public String salvarEndereco(String json) {
        try { return db.saveAddress(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String excluirEndereco(String codigo) {
        try { return db.deleteAddress(codigo).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarEnderecos(String apenasDisponiveis) {
        try { return db.listAddresses("true".equals(apenasDisponiveis)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String itensDoEndereco(String codigo) {
        try { return db.getAddressItems(codigo).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== ENTRADA & ESTOQUE ===================== */

    @JavascriptInterface
    public String registrarEntrada(String json) {
        try { return db.registerEntry(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String consultarEstoque(String filtro) {
        try { return db.listStock(filtro).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== TRANSFERÊNCIAS & TAREFAS ===================== */

    @JavascriptInterface
    public String transferirEstoque(String json) {
        try { return db.moveStock(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String criarTarefaMovimentacao(String json) {
        try { return db.createMoveTask(new JSONObject(json), operatorName()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarTarefasMovimentacao(String status) {
        try { return db.listMoveTasks(status).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String executarTarefaMovimentacao(String json) {
        try { return db.executeMoveTask(new JSONObject(json), operatorName()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String cancelarTarefaMovimentacao(String idStr) {
        try { return db.cancelMoveTask(Long.parseLong(idStr.trim()), operatorName()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== PEDIDOS & SEPARAÇÃO ===================== */

    @JavascriptInterface
    public String criarPedido(String json) {
        try { return db.createOrder(new JSONObject(json), operatorName()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarPedidos(String filtro) {
        try { return db.listOrders(filtro).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String obterPedido(String numero) {
        try { return db.getOrder(numero).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String cancelarPedido(String numero) {
        try { return db.cancelOrder(numero).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String previewSeparacao(String json) {
        try { return db.previewSeparation(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String confirmarSeparacao(String json) {
        try { return db.confirmSeparation(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== CHECKOUT FÍSICO ===================== */

    @JavascriptInterface
    public String statusCheckout(String numero) {
        try { return db.checkoutStatus(numero).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String iniciarCheckoutFisico(String json) {
        try { return db.iniciarCheckoutFisico(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String biparCaixaCheckout(String json) {
        try { return db.biparCaixaCheckout(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String registrarAvulsasCheckout(String json) {
        try { return db.registrarAvulsasCheckout(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String finalizarCheckoutFisico(String json) {
        try { return db.finalizarCheckoutFisico(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    /* ===================== INVENTÁRIO, ALERTAS, AUDITORIA ===================== */

    @JavascriptInterface
    public String registrarInventario(String json) {
        try { return db.countInventory(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarAlertas() {
        try { return db.listOperationalAlerts(alertDays()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarMovimentacoes(String jsonOrFilter) {
        try {
            String trimmed = jsonOrFilter == null ? "" : jsonOrFilter.trim();
            if (trimmed.startsWith("{")) {
                JSONObject obj = new JSONObject(trimmed);
                return db.listMovements(obj.optString("filtro", ""), obj.optString("tipo", "TODOS")).toString();
            }
            return db.listMovements(trimmed, "TODOS").toString();
        } catch (Exception e) {
            return fail(e);
        }
    }

    /* ===================== DEMO & RESET ===================== */

    @JavascriptInterface
    public String carregarDemonstracao() {
        try { return db.seedDemoData(operatorName()).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String limparBaseLocal() {
        try { return db.clearAllData().toString(); }
        catch (Exception e) { return fail(e); }
    }
}
