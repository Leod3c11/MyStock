package com.mystock.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MyStockBridge {
    private final SharedPreferences prefs;

    public MyStockBridge(Context context) {
        prefs = context.getSharedPreferences("mystock_lan_session", Context.MODE_PRIVATE);
    }

    private String fail(String message) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", message == null ? "Falha de comunicação com o computador." : message);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"Falha de comunicação com o computador.\"}";
        }
    }

    private String serverUrl() {
        return prefs.getString("server_url", "").trim().replaceAll("/+$", "");
    }

    private JSONObject request(String endpoint, JSONObject body) throws Exception {
        String base = serverUrl();
        if (base.isEmpty()) throw new Exception("Informe o endereço do computador que está executando o MyStock.");
        URL url = new URL(base + endpoint);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder response = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) response.append(line);
            }
        }
        connection.disconnect();
        JSONObject result = new JSONObject(response.length() == 0 ? "{}" : response.toString());
        if (status == 401) {
            prefs.edit().remove("token").apply();
        }
        return result;
    }

    @JavascriptInterface
    public String servidorSalvo() {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("serverUrl", serverUrl());
            out.put("loggedIn", !prefs.getString("token", "").isEmpty());
            return out.toString();
        } catch (Exception e) { return fail(e.getMessage()); }
    }

    @JavascriptInterface
    public String loginRemoto(String baseUrl, String username, String password) {
        try {
            String clean = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
            if (!clean.matches("^https?://[^\\s/]+(:[0-9]{1,5})?$"))
                throw new Exception("Informe o endereço no formato http://IP-DO-PC:8765");
            prefs.edit().putString("server_url", clean).apply();
            JSONObject data = new JSONObject();
            data.put("username", username == null ? "" : username);
            data.put("password", password == null ? "" : password);
            JSONObject result = request("/api/login", data);
            if (result.optBoolean("ok")) {
                prefs.edit().putString("token", result.optString("token", "")).apply();
            }
            return result.toString();
        } catch (Exception e) { return fail("Não foi possível conectar ao computador: " + e.getMessage()); }
    }

    @JavascriptInterface
    public String logoutRemoto() {
        try {
            String token = prefs.getString("token", "");
            if (!token.isEmpty()) {
                JSONObject body = new JSONObject();
                body.put("token", token);
                request("/api/logout", body);
            }
        } catch (Exception ignored) {}
        prefs.edit().remove("token").apply();
        return "{\"ok\":true}";
    }

    private String call(String method, String payload) {
        try {
            String token = prefs.getString("token", "");
            if (token.isEmpty()) return fail("Entre com seu usuário para continuar.");
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("method", method);
            body.put("payload", payload == null ? "" : payload);
            return request("/api/call", body).toString();
        } catch (Exception e) {
            return fail("Falha ao acessar o MyStock no computador. Confira se o PC está ligado, conectado ao mesmo Wi-Fi e se o endereço está correto. Detalhe: " + e.getMessage());
        }
    }

    @JavascriptInterface public String salvarProduto(String json) { return call("salvarProduto", json); }
    @JavascriptInterface public String salvarEndereco(String json) { return call("salvarEndereco", json); }
    @JavascriptInterface public String listarEnderecos(String apenasDisponiveis) { return call("listarEnderecos", apenasDisponiveis); }
    @JavascriptInterface public String registrarEntrada(String json) { return call("registrarEntrada", json); }
    @JavascriptInterface public String consultarEstoque(String filtro) { return call("consultarEstoque", filtro); }
    @JavascriptInterface public String listarLotes(String produto) { return call("listarLotes", produto); }
    @JavascriptInterface public String listarProdutos(String filtro) { return call("listarProdutos", filtro); }
    @JavascriptInterface public String listarMovimentacoes(String filtro) { return call("listarMovimentacoes", filtro); }
    @JavascriptInterface public String previewSeparacao(String json) { return call("previewSeparacao", json); }
    @JavascriptInterface public String confirmarSeparacao(String json) { return call("confirmarSeparacao", json); }
}
