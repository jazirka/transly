package app.transly;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Four chips with the counts (new, drafts, filled by the app, waiting) and the top three rows of the chosen one. */
public class QueueWidget extends BaseWidget {
    private static final int[] CHIPS = {R.id.q_c0, R.id.q_c1, R.id.q_c2, R.id.q_c3};
    private static final int[] ROWS = {R.id.q_row0, R.id.q_row1, R.id.q_row2};
    private static final int[] SRC = {R.id.q_s0, R.id.q_s1, R.id.q_s2};
    private static final int[] TR = {R.id.q_t0, R.id.q_t1, R.id.q_t2};

    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_queue);
        int m = WidgetKit.mode(c, o, id);
        for (int k = 0; k < CHIPS.length; k++) {
            boolean on = k == m;
            v.setTextViewText(CHIPS[k], WidgetKit.MODE_SHORT[k] + " " + WidgetKit.count(o, WidgetKit.MODES[k]));
            v.setInt(CHIPS[k], "setBackgroundResource", on ? R.drawable.w_chip_on : R.drawable.w_chip);
            v.setTextColor(CHIPS[k], c.getColor(on ? R.color.w_on_fill : R.color.w_text));
            v.setOnClickPendingIntent(CHIPS[k], WidgetKit.self(c, getClass(), id, k + 1, WidgetKit.ACT_MODE, k));
        }
        JSONArray q = WidgetKit.queue(o, WidgetKit.MODES[m]);
        for (int k = 0; k < ROWS.length; k++) {
            JSONObject r = q.optJSONObject(k);
            if (r == null) {
                v.setViewVisibility(ROWS[k], k == 0 ? View.VISIBLE : View.INVISIBLE);
                v.setTextViewText(SRC[k], k == 0 ? (o.optInt("total") > 0 ? "У цій черзі порожньо" : c.getString(R.string.widget_next_empty)) : "");
                v.setTextViewText(TR[k], "");
                v.setOnClickPendingIntent(ROWS[k], WidgetKit.open(c, 8 + k, "open", "", ""));
                continue;
            }
            v.setViewVisibility(ROWS[k], View.VISIBLE);
            v.setTextViewText(SRC[k], r.optString("s"));
            String t = r.optString("t");
            v.setTextViewText(TR[k], t.isEmpty() ? r.optString("file").replaceAll("\\.json$", "") : t);
            v.setOnClickPendingIntent(ROWS[k], WidgetKit.open(c, 8 + k, "open", r.optString("file"), r.optString("key")));
        }
        int more = WidgetKit.count(o, WidgetKit.MODES[m]) - Math.min(3, q.length());
        v.setTextViewText(R.id.q_more, more > 0 ? "ще " + more + " у черзі «" + WidgetKit.MODE_NAMES[m].toLowerCase() + "»" : "");
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 7, "open", "", ""));
        return v;
    }
}
