package app.transly;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Today's work as the big number, the streak and the week as chips, the last seven days as bars. */
public class StatsWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_stats);
        v.setTextViewText(R.id.s_today, WidgetKit.num(o.optInt("today")));
        int streak = o.optInt("streak");
        v.setViewVisibility(R.id.s_streak, streak > 1 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.s_streak, "серія " + streak + " дн.");
        v.setTextViewText(R.id.s_week, "тиж. " + WidgetKit.num(o.optInt("week")));
        v.setImageViewBitmap(R.id.s_chart, WidgetKit.bars(c, o.optJSONArray("days")));
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 1, "open", "", ""));
        return v;
    }
}
