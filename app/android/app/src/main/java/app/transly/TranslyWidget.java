package app.transly;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

/**
 * Home-screen widget in One UI's manner: one large rounded card, a ring with the main number, quiet secondary text
 * and a pill-shaped action. The page sends the numbers ({@code setStats}); the widget only draws them.
 */
public class TranslyWidget extends AppWidgetProvider {
    static final String PREFS = "widget";
    static final String KEY = "stats";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    /** Redraw every placed instance with the latest numbers. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TranslyWidget.class));
        if (ids.length == 0) return;
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int total = 0, approved = 0, waiting = 0, draft = 0;
        String file = "";
        try {
            JSONObject o = new JSONObject(prefs.getString(KEY, "{}"));
            total = o.optInt("total");
            approved = o.optInt("approved");
            waiting = o.optInt("done");
            draft = o.optInt("draft");
            file = o.optString("file");
        } catch (Exception ignored) {
            // No numbers yet: show the invitation instead.
        }

        boolean night = (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget);
        NumberFormat nf = NumberFormat.getIntegerInstance(new Locale("uk", "UA"));

        if (total <= 0) {
            v.setImageViewBitmap(R.id.w_ring, ring(context, 0, 0, night));
            v.setTextViewText(R.id.w_big, context.getString(R.string.widget_empty_title));
            v.setTextViewText(R.id.w_lbl, context.getString(R.string.widget_empty_sub));
            v.setTextViewText(R.id.w_note, "");
        } else {
            int translated = approved + waiting + draft;
            int approvedPct = percent(approved, total);
            int translatedPct = percent(translated, total);
            v.setImageViewBitmap(R.id.w_ring, ring(context, approvedPct, translatedPct, night));
            v.setTextViewText(R.id.w_big, nf.format(approved));
            v.setTextViewText(R.id.w_lbl, "вичитано з " + nf.format(total));
            String note = "перекладено " + translatedPct + "%";
            if (waiting > 0) note += " · чекає вичитування " + nf.format(waiting);
            v.setTextViewText(R.id.w_note, file.isEmpty() ? note : file + " · " + note);
        }

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(android.R.id.background, pi);
            v.setOnClickPendingIntent(R.id.w_btn, pi);
        }
        return v;
    }

    private static int percent(int part, int total) {
        if (total <= 0) return 0;
        // A started job never shows as zero, and an unfinished one never as 100.
        int p = Math.round(100f * part / total);
        if (part > 0 && p == 0) return 1;
        if (part < total && p == 100) return 99;
        return p;
    }

    /** The progress ring: translated share in a soft tone behind, approved share in the accent, the percentage inside. */
    private static android.graphics.Bitmap ring(Context context, int approvedPct, int translatedPct, boolean night) {
        float d = context.getResources().getDisplayMetrics().density;
        int size = Math.round(76 * d);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        int track = night ? 0xFF3C3C42 : 0xFFE4E4EA;
        int soft = night ? 0xFF5B4E96 : 0xFFC8BCF5;
        int accent = night ? 0xFFB6A4FF : 0xFF6F55D9;
        int text = night ? 0xFFF1F1F4 : 0xFF1C1C1E;

        float stroke = 9 * d;
        float c = size / 2f;
        RectF box = new RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(stroke);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(track);
        canvas.drawCircle(c, c, (size - stroke) / 2f, p);
        if (translatedPct > 0) {
            p.setColor(soft);
            canvas.drawArc(box, -90f, 360f * translatedPct / 100f, false, p);
        }
        if (approvedPct > 0) {
            p.setColor(accent);
            canvas.drawArc(box, -90f, 360f * approvedPct / 100f, false, p);
        }

        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(text);
        t.setTextAlign(Paint.Align.CENTER);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setTextSize(19 * d);
        canvas.drawText(approvedPct + "%", c, c - (t.ascent() + t.descent()) / 2f, t);
        return bitmap;
    }
}
