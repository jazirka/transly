package app.transly;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** "Next line" widget: the next untranslated row of the open file; a tap opens it in the editor. */
public class NextLineWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NextLineWidget.class));
        if (ids.length == 0) return;
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_next);
        String text = "", file = "", key = "";
        try {
            JSONObject o = new JSONObject(context.getSharedPreferences(TranslyWidget.PREFS, Context.MODE_PRIVATE).getString(TranslyWidget.KEY, "{}"));
            JSONObject next = o.optJSONObject("next");
            if (next != null) {
                text = next.optString("text");
                file = next.optString("file");
                key = next.optString("key");
            }
        } catch (Exception ignored) {
            // No numbers yet.
        }
        v.setTextViewText(R.id.n_text, text.isEmpty() ? context.getString(R.string.widget_next_empty) : text);
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_FILE, file)
                .putExtra(MainActivity.EXTRA_KEY, key);
        // The extras differ per line, so the PendingIntent must be replaced when they do.
        PendingIntent pi = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(android.R.id.background, pi);
        return v;
    }
}
