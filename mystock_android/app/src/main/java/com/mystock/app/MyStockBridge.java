package com.mystock.app;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

public class MyStockBridge {
    private final MyStockDbHelper db;

    public MyStockBridge(MyStockDbHelper db) {
        this.db = db;
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

    @JavascriptInterface
    public String salvarProduto(String json) {
        try { return db.saveProduct(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String salvarEndereco(String json) {
        try { return db.saveAddress(new JSONObject(json)).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarEnderecos(String apenasDisponiveis) {
        try { return db.listAddresses("true".equals(apenasDisponiveis)).toString(); }
        catch (Exception e) { return fail(e); }
    }

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

    @JavascriptInterface
    public String listarLotes(String produto) {
        try { return db.listLots(produto).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarProdutos(String filtro) {
        try { return db.listProducts(filtro).toString(); }
        catch (Exception e) { return fail(e); }
    }

    @JavascriptInterface
    public String listarMovimentacoes(String filtro) {
        try { return db.listMovements(filtro).toString(); }
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
}
