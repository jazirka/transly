package app.transly;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** «Продовжити»: the file and row you stopped on; the round button opens it, the pencil opens it with the keyboard. */
public class NextLineWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_next);
        int total = o.optInt("total"), approved = o.optInt("approved"), waiting = o.optInt("done"), draft = o.optInt("draft");
        v.setImageViewBitmap(R.id.n_ring, WidgetKit.ring(c, WidgetKit.percent(approved, total), WidgetKit.percent(approved + waiting + draft, total)));
        JSONObject cur = o.optJSONObject("cur");
        String file = "", key = "";
        if (cur == null) {
            v.setTextViewText(R.id.n_title, c.getString(R.string.widget_continue));
            v.setTextViewText(R.id.n_text, c.getString(R.string.widget_next_empty));
        } else {
            file = cur.optString("file");
            key = cur.optString("key");
            v.setTextViewText(R.id.n_title, file.replaceAll("\\.json$", ""));
            v.setTextViewText(R.id.n_text, "Рядок " + cur.optInt("pos") + " з " + cur.optInt("of") + " · " + WidgetKit.statusWord(cur.optString("st")));
        }
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 1, "open", file, key));
        v.setOnClickPendingIntent(R.id.n_play, WidgetKit.open(c, 2, "open", file, key));
        v.setOnClickPendingIntent(R.id.n_edit, WidgetKit.open(c, 3, "keyboard", file, key));
        return v;
    }
}
