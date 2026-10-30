package app.transly;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** The file you are working in and how much of it is translated. */
public class FileWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_file);
        String name = o.optString("curName");
        int p = o.optInt("curP");
        v.setTextViewText(R.id.f_name, name.isEmpty() ? c.getString(R.string.widget_next_empty) : name + " · " + p + "%");
        v.setImageViewBitmap(R.id.f_bar, WidgetKit.hbar(c, p));
        JSONObject cur = o.optJSONObject("cur");
        v.setOnClickPendingIntent(android.R.id.background, cur == null ? WidgetKit.open(c, 1, "open", "", "") : WidgetKit.open(c, 1, "open", cur.optString("file"), cur.optString("key")));
        return v;
    }
}
