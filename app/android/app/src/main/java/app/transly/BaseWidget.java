package app.transly;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** A widget whose card is drawn from the published numbers; ‹ › and the mode chips are handled here, without the app. */
abstract class BaseWidget extends AppWidgetProvider {
    abstract RemoteViews build(Context c, int id, JSONObject data);

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        JSONObject d = WidgetKit.data(c);
        for (int id : ids) {
            try {
                manager.updateAppWidget(id, build(c, id, d));
            } catch (Exception ignored) {
                // A broken payload must not take the launcher's widget host down with it.
            }
        }
    }

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        int id = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0);
        if (id != 0 && WidgetKit.ACT_STEP.equals(a)) {
            android.content.SharedPreferences s = WidgetKit.state(c);
            s.edit().putInt(id + ".i", s.getInt(id + ".i", 0) + i.getIntExtra("arg", 1)).apply();
            onUpdate(c, AppWidgetManager.getInstance(c), new int[]{id});
        } else if (id != 0 && WidgetKit.ACT_MODE.equals(a)) {
            WidgetKit.state(c).edit().putInt(id + ".m", i.getIntExtra("arg", 0)).putInt(id + ".i", 0).apply();
            onUpdate(c, AppWidgetManager.getInstance(c), new int[]{id});
        } else {
            super.onReceive(c, i);
        }
    }
}
