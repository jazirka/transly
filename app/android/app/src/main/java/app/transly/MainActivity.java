package app.transly;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Hosts the web app in a WebView. The app's files live in the APK (assets/) and are served under a fixed https origin,
 * so the page is a secure context with its own storage, like on the web, and needs no server.
 * What a WebView lacks is provided here: a file chooser, saving files to Downloads, back-button handling, and
 * progress numbers for the home-screen widget.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_FILES = 1;
    private static final String TAG = "Transly";
    static final String EXTRA_FILE = "file";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_ACTION = "action";

    private WebView web;
    private ValueCallback<Uri[]> chooser;

    // A file being saved to Downloads, written in pieces so a large project never sits in memory twice.
    private OutputStream saving;
    private Uri savingUri;
    private String savingName;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        // The sync server of a home network is often plain http.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        web.addJavascriptInterface(new Bridge(), "TranslyAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { Log.w(TAG, "no handler for " + u); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILES);
                } catch (Exception e) {
                    chooser = null;
                    return false;
                }
                return true;
            }
        });
        web.loadUrl("https://" + HOST + "/index.html");
        openFromIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openFromIntent(intent);
    }

    /**
     * A tap on a widget button: open the row, open it with the keyboard, or send it. The page may still be loading, so
     * the call waits for it; a send is a quick action and leaves the app again, back to the home screen.
     */
    private void openFromIntent(Intent intent) {
        String file = intent == null ? null : intent.getStringExtra(EXTRA_FILE);
        String key = intent == null ? null : intent.getStringExtra(EXTRA_KEY);
        String action = intent == null ? null : intent.getStringExtra(EXTRA_ACTION);
        if (file == null || file.isEmpty() || key == null || key.isEmpty()) return;
        intent.removeExtra(EXTRA_FILE);
        intent.removeExtra(EXTRA_ACTION);
        String act = action == null ? "open" : action;
        boolean send = "send".equals(act), keyboard = "keyboard".equals(act);
        String js = "(function(){var f=" + org.json.JSONObject.quote(file) + ",k=" + org.json.JSONObject.quote(key) + ",a=" + org.json.JSONObject.quote(act)
                + ";var t=setInterval(function(){if(window.__widgetAction&&window.__open){clearInterval(t);window.__open(f,k);window.__widgetState=window.__widgetAction(a,f,k)}},200);setTimeout(function(){clearInterval(t)},10000)})()";
        web.post(() -> {
            web.evaluateJavascript(js, null);
            if (keyboard) web.postDelayed(() -> {
                web.requestFocus();
                android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
            }, 900);
            if (send) web.postDelayed(() -> web.evaluateJavascript("(function(){return String(window.__widgetState||'')})()", v -> {
                String r = v == null ? "" : v.replace("\"", "");
                Toast.makeText(MainActivity.this, "ok".equals(r) ? "Надіслано" : (r.isEmpty() ? "Не вдалося надіслати" : r), Toast.LENGTH_SHORT).show();
                if ("ok".equals(r)) moveTaskToBack(true);
            }), 1600);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILES && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            chooser = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        // The page closes a dialog or a panel first; only when there is nothing to close does the app leave.
        web.evaluateJavascript("(function(){return !!(window.__back&&window.__back())})()", v -> {
            if (!"true".equals(v)) finish();
        });
    }

    @Override
    protected void onPause() {
        // Translations are saved a moment after typing: make sure the last edit is written before the app is cached.
        web.evaluateJavascript("window.__flush&&window.__flush()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    /** Serve the app's own files for the fixed origin; everything else goes to the network as usual. */
    private WebResourceResponse serve(Uri uri) {
        if (!HOST.equals(uri.getHost())) return null;
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (path.isEmpty() || path.equals("/")) path = "/index.html";
        path = path.substring(1);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        try {
            InputStream in = getAssets().open(path);
            return new WebResourceResponse(mime(path), "utf-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
        }
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show());
    }

    /** What the page can ask of the app. Called on a background thread. */
    public final class Bridge {
        /** Progress numbers (JSON) for the home-screen widget. */
        @JavascriptInterface
        public void setStats(String json) {
            getSharedPreferences(TranslyWidget.PREFS, MODE_PRIVATE).edit().putString(TranslyWidget.KEY, json).apply();
            WidgetKit.refreshAll(MainActivity.this);
        }

        /** Start saving a file to the Downloads folder. */
        @JavascriptInterface
        public boolean beginSave(String name, String mime) {
            closeSave();
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                savingUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (savingUri == null) return false;
                saving = getContentResolver().openOutputStream(savingUri);
                savingName = name;
                return saving != null;
            } catch (Exception e) {
                Log.w(TAG, "beginSave failed", e);
                closeSave();
                return false;
            }
        }

        /** One piece of the file, base64 (a multiple of 4 characters). */
        @JavascriptInterface
        public boolean saveChunk(String base64) {
            if (saving == null) return false;
            try {
                saving.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                Log.w(TAG, "saveChunk failed", e);
                closeSave();
                return false;
            }
        }

        /** Download the new APK from a release of the (private) repository and open the system installer. */
        @JavascriptInterface
        public void installUpdate(String url, String token) {
            if (url == null || !url.startsWith("https://api.github.com/repos/") || !url.contains("/releases/assets/") || url.contains("..")) {
                report("error", "Оновлення можна брати лише з релізу GitHub");
                return;
            }
            if (!getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))));
                report("permission", "Дозвольте цьому застосунку встановлювати оновлення (відкрилися налаштування), потім повторіть оновлення");
                return;
            }
            new Thread(() -> {
                try {
                    report("download", "Завантажую оновлення…");
                    Uri apk = downloadUpdate(url, token);
                    report("install", "Відкриваю встановлення: підтвердьте його в системному вікні");
                    runOnUiThread(() -> startActivity(new Intent(Intent.ACTION_VIEW)
                            .setDataAndType(apk, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK)));
                } catch (Exception e) {
                    report("error", e.getMessage() == null ? "Не вдалося завантажити оновлення" : e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public boolean endSave() {
            if (saving == null) return false;
            String name = savingName;
            boolean ok = closeSave();
            if (ok) toast("Збережено в «Завантаження»: " + name);
            return ok;
        }
    }

    /** Tell the page how an update is going ("download", "install", "permission", "error"). */
    private void report(String stage, String text) {
        web.post(() -> web.evaluateJavascript("window.__updateState&&window.__updateState(" + org.json.JSONObject.quote(stage) + "," + org.json.JSONObject.quote(text) + ")", null));
    }

    private HttpURLConnection open(String address, String token) throws java.io.IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "transly");
        if (token != null) {
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "application/octet-stream");
        }
        return c;
    }

    /** Download a release asset of a private repository into Downloads. The redirect to the file store is followed without the token. */
    private Uri downloadUpdate(String url, String token) throws Exception {
        HttpURLConnection c = open(url, token);
        int code = c.getResponseCode();
        if (code >= 301 && code <= 308) {
            String loc = c.getHeaderField("Location");
            if (loc == null || !loc.startsWith("https://")) throw new java.io.IOException("GitHub надіслав небезпечну адресу файлу");
            c.disconnect();
            c = open(loc, null);
            code = c.getResponseCode();
        }
        if (code == 401) throw new java.io.IOException("Токен недійсний або прострочений");
        if (code == 403 || code == 404) throw new java.io.IOException("Немає доступу до релізу: токен має мати право читати вміст репозиторію");
        if (code != 200) throw new java.io.IOException("Помилка завантаження: " + code);
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, "transly-update.apk");
        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/vnd.android.package-archive");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new java.io.IOException("Не вдалося створити файл у Завантаженнях");
        long total = 0;
        try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(uri)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; }
        }
        if (total == 0) throw new java.io.IOException("Порожній файл оновлення");
        return uri;
    }

    private boolean closeSave() {
        boolean ok = saving != null;
        try {
            if (saving != null) saving.close();
        } catch (IOException e) {
            ok = false;
        }
        saving = null;
        savingUri = null;
        savingName = null;
        return ok;
    }
}
