package app.transly;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Today's work, the streak of days, the week as bars and the file that is furthest along. */
public class StatsWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_stats);
        int total = o.optInt("total"), approved = o.optInt("approved"), waiting = o.optInt("done"), draft = o.optInt("draft");
        v.setImageViewBitmap(R.id.s_ring, WidgetKit.ring(c, WidgetKit.percent(approved, total), WidgetKit.percent(approved + waiting + draft, total)));
        int today = o.optInt("today"), streak = o.optInt("streak");
        v.setTextViewText(R.id.s_today, today == 0 ? "Сьогодні ще нічого" : "Сьогодні " + today);
        String sub = streak > 1 ? "серія " + streak + " дн." : "за тиждень " + o.optInt("week");
        v.setTextViewText(R.id.s_sub, sub);
        v.setImageViewBitmap(R.id.s_chart, WidgetKit.bars(c, o.optJSONArray("days")));
        JSONArray files = o.optJSONArray("files");
        JSONObject f = files == null ? null : files.optJSONObject(0);
        v.setTextViewText(R.id.s_file, f == null ? "" : f.optString("n") + " · " + f.optInt("p") + "%");
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 1, "open", "", ""));
        return v;
    }
}
