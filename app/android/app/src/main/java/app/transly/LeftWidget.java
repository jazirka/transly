package app.transly;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Rows still without a translation and, at the current pace, how many days that is. */
public class LeftWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_left);
        int total = o.optInt("total");
        int left = Math.max(0, total - o.optInt("approved") - o.optInt("done") - o.optInt("draft"));
        v.setTextViewText(R.id.l_num, total <= 0 ? "—" : WidgetKit.num(left));
        int pace = o.optInt("today") > 0 ? o.optInt("today") : Math.round(o.optInt("week") / 7f);
        String eta = left == 0 ? (total > 0 ? "усе перекладено" : "") : pace > 0 ? "≈ " + WidgetKit.num((left + pace - 1) / pace) + " дн. при " + pace + "/день" : "зробіть кілька рядків, щоб оцінити темп";
        v.setTextViewText(R.id.l_eta, eta);
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 1, "open", "", ""));
        return v;
    }
}
