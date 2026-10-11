package com.mystock.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MyStockBridge {
    private static final int SERVER_PORT = 8765;
    private static final int DISCOVERY_PORT = 8766;
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
        if (base.isEmpty()) throw new Exception("O computador ainda não foi encontrado na rede.");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(3500);
        connection.setReadTimeout(7000);
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
        if (status == 401) prefs.edit().remove("token").apply();
        return result;
    }

    private boolean serverResponds(String candidate) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(candidate + "/api/status").openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(650);
            connection.setReadTimeout(650);
            return connection.getResponseCode() == 200;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    // Envia um broadcast UDP e testa os endereços anunciados pelo PC antes de os guardar.
    private String discoverServer() throws Exception {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(2200);
            byte[] request = "MYSTOCK_DISCOVER_V1".getBytes(StandardCharsets.UTF_8);
            DatagramPacket packet = new DatagramPacket(request, request.length,
                    InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT);
            socket.send(packet);

            long deadline = System.currentTimeMillis() + 2200;
            byte[] buffer = new byte[4096];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(reply);
                } catch (java.net.SocketTimeoutException timeout) {
                    break;
                }
                JSONObject data = new JSONObject(new String(reply.getData(), reply.getOffset(),
                        reply.getLength(), StandardCharsets.UTF_8));
                if (!"MyStock".equals(data.optString("service"))) continue;
                int port = data.optInt("port", SERVER_PORT);
                JSONArray ips = data.optJSONArray("ips");
                if (ips == null) continue;
                for (int i = 0; i < ips.length(); i++) {
                    String ip = ips.optString(i, "").trim();
                    if (ip.isEmpty() || ip.startsWith("127.")) continue;
                    String candidate = "http://" + ip + ":" + port;
                    if (serverResponds(candidate)) {
                        prefs.edit().putString("server_url", candidate).apply();
                        return candidate;
                    }
                }
            }
        } finally {
            if (socket != null) socket.close();
        }
        throw new Exception("Não encontrei o MyStock na rede. Confira se o PC está ligado, se o MyStock está aberto e se os dois estão no mesmo Wi-Fi.");
    }

    @JavascriptInterface
    public String descobrirServidor() {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("serverUrl", discoverServer());
            return out.toString();
        } catch (Exception e) {
            return fail(e.getMessage());
        }
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
            if (clean.isEmpty()) clean = discoverServer();
            if (!clean.matches("^https?://[^\\s/]+(:[0-9]{1,5})?$"))
                throw new Exception("Endereço inválido. Use o botão para encontrar o computador.");
            prefs.edit().putString("server_url", clean).apply();
            JSONObject data = new JSONObject();
            data.put("username", username == null ? "" : username);
            data.put("password", password == null ? "" : password);
            JSONObject result;
            try {
                result = request("/api/login", data);
            } catch (Exception firstError) {
                String rediscovered = discoverServer();
                prefs.edit().putString("server_url", rediscovered).apply();
                result = request("/api/login", data);
            }
            if (result.optBoolean("ok")) {
                prefs.edit().putString("token", result.optString("token", "")).apply();
            }
            return result.toString();
        } catch (Exception e) {
            return fail("Não foi possível conectar ao computador: " + e.getMessage());
        }
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
            try {
                return request("/api/call", body).toString();
            } catch (Exception firstError) {
                discoverServer();
                return request("/api/call", body).toString();
            }
        } catch (Exception e) {
            return fail("Falha ao acessar o MyStock no computador. O aplicativo tentou localizar o servidor novamente. Confira se o PC está ligado e na mesma rede Wi-Fi. Detalhe: " + e.getMessage());
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