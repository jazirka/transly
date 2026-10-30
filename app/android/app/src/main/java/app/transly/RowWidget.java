package app.transly;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One row of the queue as a square card. ‹ › step through it and the chip switches between new / drafts / filled by
 * the app / waiting for review (empty modes are skipped) without opening the app; the pencil opens the editor with the
 * keyboard, the arrow sends the row (only offered when it has a translation).
 */
public class RowWidget extends BaseWidget {
    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row);
        int m = WidgetKit.mode(c, o, id);
        String mode = WidgetKit.MODES[m];
        JSONArray q = WidgetKit.queue(o, mode);
        int n = q.length();
        // The chip jumps to the next mode that has something in it.
        int next = m;
        for (int k = 1; k <= WidgetKit.MODES.length; k++) {
            int cand = (m + k) % WidgetKit.MODES.length;
            if (WidgetKit.count(o, WidgetKit.MODES[cand]) > 0) { next = cand; break; }
        }
        v.setTextViewText(R.id.r_mode, WidgetKit.MODE_NAMES[m] + " · " + WidgetKit.num(WidgetKit.count(o, mode)));
        v.setOnClickPendingIntent(R.id.r_mode, WidgetKit.self(c, getClass(), id, 1, WidgetKit.ACT_MODE, next));
        v.setOnClickPendingIntent(R.id.r_prev, WidgetKit.self(c, getClass(), id, 2, WidgetKit.ACT_STEP, -1));
        v.setOnClickPendingIntent(R.id.r_next, WidgetKit.self(c, getClass(), id, 3, WidgetKit.ACT_STEP, 1));

        if (n == 0) {
            v.setTextViewText(R.id.r_pos, "");
            v.setTextViewText(R.id.r_where, "");
            v.setTextViewText(R.id.r_src, "Тут порожньо");
            v.setTextViewText(R.id.r_tr, o.optInt("total") > 0 ? "У цій черзі нічого немає: молодець!" : c.getString(R.string.widget_next_empty));
            v.setViewVisibility(R.id.r_send, View.GONE);
            v.setOnClickPendingIntent(R.id.r_edit, WidgetKit.open(c, 4, "open", "", ""));
            v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 5, "open", "", ""));
            return v;
        }
        int i = Math.floorMod(WidgetKit.state(c).getInt(id + ".i", 0), n);
        JSONObject r = q.optJSONObject(i);
        if (r == null) r = new JSONObject();
        String file = r.optString("file"), key = r.optString("key"), tr = r.optString("t");
        v.setTextViewText(R.id.r_pos, (i + 1) + "/" + n);
        v.setTextViewText(R.id.r_where, file.replaceAll("\\.json$", "") + " · " + WidgetKit.statusWord(r.optString("st")));
        v.setTextViewText(R.id.r_src, r.optString("s"));
        v.setTextViewText(R.id.r_tr, tr.isEmpty() ? "Перекладу ще немає: торкніться олівця" : tr);
        boolean canSend = !tr.isEmpty() && !"appr".equals(r.optString("st"));
        v.setViewVisibility(R.id.r_send, canSend ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(android.R.id.background, WidgetKit.open(c, 4, "open", file, key));
        v.setOnClickPendingIntent(R.id.r_edit, WidgetKit.open(c, 5, "keyboard", file, key));
        v.setOnClickPendingIntent(R.id.r_send, WidgetKit.open(c, 6, "send", file, key));
        return v;
    }
}
