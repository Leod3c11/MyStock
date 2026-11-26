package com.mystock.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int CAMERA_REQUEST = 10;
    private static final int CREATE_FILE_REQUEST = 20;
    private static final int OPEN_BACKUP_REQUEST = 21;

    private WebView webView;
    private MyStockDbHelper db;
    private String pendingExportContent;
    private String pendingExportTag;
    private long lastBackPressMs = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            View decor = getWindow().getDecorView();
            decor.setSystemUiVisibility(decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#F1F5F9"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        db = new MyStockDbHelper(this);
        webView.addJavascriptInterface(new MyStockBridge(this, db), "MyStock");

        if (!hasCameraPermission()) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
        }

        webView.loadUrl("file:///android_asset/index.html");
    }

    public boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    public void requestCameraPermissionFromJs() {
        runOnUiThread(() -> {
            if (hasCameraPermission()) {
                notifyJs("window.onCameraPermissionResult && window.onCameraPermissionResult(true);");
            } else {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            notifyJs("window.onCameraPermissionResult && window.onCameraPermissionResult(" + granted + ");");
        }
    }

    public void triggerVibration(int durationMs) {
        int clamped = Math.max(15, Math.min(250, durationMs));
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(clamped, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                //noinspection deprecation
                v.vibrate(clamped);
            }
        } catch (Exception ignored) {
        }
    }

    public void launchExportFile(String content, String mimeType, String suggestedName, String tag) {
        runOnUiThread(() -> {
            pendingExportContent = content;
            pendingExportTag = tag;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
            startActivityForResult(intent, CREATE_FILE_REQUEST);
        });
    }

    public void launchImportBackupFile() {
        runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
            startActivityForResult(intent, OPEN_BACKUP_REQUEST);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CREATE_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportContent != null) {
                Uri uri = data.getData();
                String content = pendingExportContent;
                String tag = pendingExportTag;
                pendingExportContent = null;
                pendingExportTag = null;
                new Thread(() -> {
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) throw new Exception("Não foi possível gravar no destino escolhido.");
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        String msg = "CSV_ESTOQUE".equals(tag)
                                ? "Planilha CSV exportada com sucesso."
                                : "Backup JSON salvo com sucesso no dispositivo.";
                        sendNativeCallback(true, msg);
                    } catch (Exception e) {
                        sendNativeCallback(false, "Falha ao salvar arquivo: " + e.getMessage());
                    }
                }).start();
            } else {
                pendingExportContent = null;
                pendingExportTag = null;
            }
        } else if (requestCode == OPEN_BACKUP_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                new Thread(() -> {
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new Exception("Não foi possível ler o arquivo selecionado.");
                        StringBuilder sb = new StringBuilder();
                        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                            String line;
                            while ((line = br.readLine()) != null) {
                                sb.append(line).append('\n');
                            }
                        }
                        JSONObject res = db.importBackupJson(sb.toString());
                        sendNativeCallback(true, res.optString("message", "Backup restaurado."));
                    } catch (Exception e) {
                        sendNativeCallback(false, "Falha ao restaurar backup: " + e.getMessage());
                    }
                }).start();
            }
        }
    }

    private void sendNativeCallback(boolean ok, String message) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", ok);
            payload.put("message", message == null ? "" : message);
            String jsonLiteral = JSONObject.quote(payload.toString());
            notifyJs("window.onNativeFileResult && window.onNativeFileResult(JSON.parse(" + jsonLiteral + "));");
        } catch (Exception ignored) {
        }
    }

    private void notifyJs(String script) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : 'exit'", value -> {
                if ("\"handled\"".equals(value)) {
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - lastBackPressMs < 2000L) {
                    finish();
                } else {
                    lastBackPressMs = now;
                    Toast.makeText(MainActivity.this, "Pressione voltar novamente para sair", Toast.LENGTH_SHORT).show();
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        if (db != null) {
            db.close();
        }
        super.onDestroy();
    }
}
