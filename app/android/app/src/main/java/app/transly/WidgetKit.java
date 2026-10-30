package app.transly;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;

import org.json.JSONArray;
import org.json.JSONObject;

/** What every home-screen widget shares: the numbers the page published, per-widget state, buttons and drawing. */
final class WidgetKit {
    static final String PREFS = "widget";
    static final String KEY = "stats";
    static final String ACT_STEP = "app.transly.WIDGET_STEP";
    static final String ACT_MODE = "app.transly.WIDGET_MODE";
    static final String[] MODES = {"new", "draft", "auto", "waiting"};
    static final String[] MODE_NAMES = {"Нові", "Чернетки", "Авто", "Вичитування"};
    static final String[] MODE_SHORT = {"Нові", "Чернет.", "Авто", "Чекає"};

    private WidgetKit() { }

    static JSONObject data(Context c) {
        try {
            return new JSONObject(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static SharedPreferences state(Context c) {
        return c.getSharedPreferences("wstate", Context.MODE_PRIVATE);
    }

    static int count(JSONObject d, String mode) {
        JSONObject n = d.optJSONObject("counts");
        return n == null ? 0 : n.optInt(mode);
    }

    static JSONArray queue(JSONObject d, String mode) {
        JSONObject q = d.optJSONObject("queue");
        JSONArray a = q == null ? null : q.optJSONArray(mode);
        return a == null ? new JSONArray() : a;
    }

    /** The mode a widget shows: its own choice; when that is empty, the first one that has rows. */
    static int mode(Context c, JSONObject d, int id) {
        int m = state(c).getInt(id + ".m", 0);
        if (m < 0 || m >= MODES.length) m = 0;
        if (count(d, MODES[m]) > 0) return m;
        for (int i = 0; i < MODES.length; i++) if (count(d, MODES[i]) > 0) return i;
        return m;
    }

    static String statusWord(String st) {
        switch (st == null ? "" : st) {
            case "draft": return "чернетка";
            case "done": return "на вичитуванні";
            case "appr": return "вичитано";
            default: return "без перекладу";
        }
    }

    /** A tap that opens the app on a row, optionally doing something there (type, send). */
    static PendingIntent open(Context c, int code, String action, String file, String key) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_FILE, file == null ? "" : file)
                .putExtra(MainActivity.EXTRA_KEY, key == null ? "" : key)
                .putExtra(MainActivity.EXTRA_ACTION, action == null ? "open" : action);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A tap handled by the widget itself (stepping, switching the mode): no app launch. */
    static PendingIntent self(Context c, Class<?> cls, int id, int code, String action, int arg) {
        Intent i = new Intent(c, cls).setAction(action)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .putExtra("arg", arg);
        return PendingIntent.getBroadcast(c, id * 16 + code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        BaseWidget[] all = {new TranslyWidget(), new NextLineWidget(), new RowWidget(), new QueueWidget(), new StatsWidget(), new FileWidget(), new LeftWidget()};
        for (BaseWidget w : all) {
            int[] ids = m.getAppWidgetIds(new ComponentName(c, w.getClass()));
            if (ids.length > 0) w.onUpdate(c, m, ids);
        }
    }

    /** The colour with its own transparency. */
    static int with(int color, int alpha) {
        return (alpha << 24) | (color & 0xFFFFFF);
    }

    static int percent(int part, int total) {
        if (total <= 0) return 0;
        // A started job never shows as zero, and an unfinished one never as 100.
        int p = Math.round(100f * part / total);
        if (part > 0 && p == 0) return 1;
        if (part < total && p == 100) return 99;
        return p;
    }

    /** The progress ring: translated share in a soft tone behind, approved share in white, the percentage inside. */
    static Bitmap ring(Context c, int approvedPct, int translatedPct) {
        float d = c.getResources().getDisplayMetrics().density;
        int size = Math.round(52 * d);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        float stroke = 5 * d, mid = size / 2f;
        RectF box = new RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(stroke);
        p.setStrokeCap(Paint.Cap.ROUND);
        int ink = c.getColor(R.color.w_text);
        p.setColor(with(ink, 0x40));
        canvas.drawCircle(mid, mid, (size - stroke) / 2f, p);
        if (translatedPct > 0) {
            p.setColor(with(ink, 0x80));
            canvas.drawArc(box, -90f, 360f * translatedPct / 100f, false, p);
        }
        if (approvedPct > 0) {
            p.setColor(ink);
            canvas.drawArc(box, -90f, 360f * approvedPct / 100f, false, p);
        }
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(ink);
        t.setTextAlign(Paint.Align.CENTER);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setTextSize(13 * d);
        canvas.drawText(translatedPct + "%", mid, mid - (t.ascent() + t.descent()) / 2f, t);
        return bitmap;
    }

    /** Seven bars with weekday names under them, today last and brightest; an empty day is a dot. */
    static Bitmap bars(Context c, JSONArray days) {
        float d = c.getResources().getDisplayMetrics().density;
        int w = Math.round(150 * d), h = Math.round(84 * d);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        int n = 7, max = 1;
        int[] v = new int[n];
        for (int i = 0; i < n; i++) {
            v[i] = days == null ? 0 : days.optInt(i);
            max = Math.max(max, v[i]);
        }
        String[] names = {"Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"};
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int ink = c.getColor(R.color.w_text);
        float label = 13 * d, gap = 6 * d, bw = (w - gap * (n - 1)) / n, chart = h - label - 6 * d;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setTextAlign(Paint.Align.CENTER);
        t.setTextSize(10 * d);
        for (int i = 0; i < n; i++) {
            float bh = v[i] == 0 ? bw : Math.max(bw, chart * v[i] / max);
            float x = i * (bw + gap);
            p.setColor(i == n - 1 ? ink : with(ink, v[i] == 0 ? 0x33 : 0x8C));
            canvas.drawRoundRect(new RectF(x, chart - bh, x + bw, chart), bw / 2f, bw / 2f, p);
            java.util.Calendar day = (java.util.Calendar) cal.clone();
            day.add(java.util.Calendar.DAY_OF_YEAR, i - (n - 1));
            t.setColor(with(ink, i == n - 1 ? 0xFF : 0x99));
            canvas.drawText(i == n - 1 ? "Сьо" : names[day.get(java.util.Calendar.DAY_OF_WEEK) - 1], x + bw / 2f, h - 2 * d, t);
        }
        return bitmap;
    }

    /** A thin rounded progress bar. */
    static Bitmap hbar(Context c, int pct) {
        float d = c.getResources().getDisplayMetrics().density;
        int w = Math.round(200 * d), h = Math.round(6 * d);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        int ink = c.getColor(R.color.w_text);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(with(ink, 0x40));
        canvas.drawRoundRect(new RectF(0, 0, w, h), h / 2f, h / 2f, p);
        if (pct > 0) {
            p.setColor(ink);
            canvas.drawRoundRect(new RectF(0, 0, Math.max(h, w * pct / 100f), h), h / 2f, h / 2f, p);
        }
        return bitmap;
    }

    static String num(long n) {
        return java.text.NumberFormat.getIntegerInstance(new java.util.Locale("uk", "UA")).format(n);
    }
}
