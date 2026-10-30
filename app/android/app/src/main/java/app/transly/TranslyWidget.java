package app.transly;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

/** Progress card: a ring with the approved share, the main number and the quiet details. */
public class TranslyWidget extends BaseWidget {
    static final String PREFS = WidgetKit.PREFS;
    static final String KEY = WidgetKit.KEY;

    @Override
    RemoteViews build(Context c, int id, JSONObject o) {
        int total = o.optInt("total"), approved = o.optInt("approved"), waiting = o.optInt("done"), draft = o.optInt("draft");
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        NumberFormat nf = NumberFormat.getIntegerInstance(new Locale("uk", "UA"));
        if (total <= 0) {
            v.setImageViewBitmap(R.id.w_ring, WidgetKit.ring(c, 0, 0));
            v.setTextViewText(R.id.w_big, c.getString(R.string.widget_empty_title));
            v.setTextViewText(R.id.w_lbl, c.getString(R.string.widget_empty_sub));
        } else {
            int translatedPct = WidgetKit.percent(approved + waiting + draft, total);
            v.setImageViewBitmap(R.id.w_ring, WidgetKit.ring(c, WidgetKit.percent(approved, total), translatedPct));
            v.setTextViewText(R.id.w_big, nf.format(approved));
            String note = "перекладено " + translatedPct + "%";
            if (waiting > 0) note += " · чекає " + nf.format(waiting);
            v.setTextViewText(R.id.w_lbl, "вичитано з " + nf.format(total) + " · " + note);
        }
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open != null) {
            v.setOnClickPendingIntent(android.R.id.background, PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return v;
    }
}
