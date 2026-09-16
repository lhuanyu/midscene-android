package com.midscene.android;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * One `[event] {json}` line from the agent runtime, decoded.
 *
 * The runtime writes these to stdout and the service turns them into the pill's
 * state, the notification, and the overlay's box and ripple. Keeping the JSON
 * reading here rather than in the service is what makes the contract testable
 * without Android: the runtime and this app ship separately, so a field that
 * quietly stops arriving (or arrives under a new name) is exactly the failure
 * this shape is meant to catch.
 *
 * A line that is not this app's JSON parses to {@link #kind} == {@code null}.
 */
final class AgentEvent {

    /** Event names the runtime emits. */
    static final String RUN_START = "run.start";
    static final String STEP_START = "step.start";
    static final String ACTION = "action";
    static final String STEP_END = "step.end";
    static final String RUN_END = "run.end";
    static final String LOCATE = "locate";
    static final String TAP = "tap";

    /** The `event` field, or null when the object does not carry one. */
    final String kind;

    private final JSONObject json;

    private AgentEvent(String kind, JSONObject json) {
        this.kind = kind;
        this.json = json;
    }

    /** Decode a payload that already had the `[event] ` marker stripped. */
    static AgentEvent parse(String payload) {
        if (payload == null) {
            return new AgentEvent(null, new JSONObject());
        }
        try {
            JSONObject json = new JSONObject(payload);
            String kind = json.optString("event", "");
            return new AgentEvent(kind.isEmpty() ? null : kind, json);
        } catch (JSONException error) {
            return new AgentEvent(null, new JSONObject());
        }
    }

    String optString(String key) {
        return json.optString(key);
    }

    String optString(String key, String fallback) {
        return json.optString(key, fallback);
    }

    int optInt(String key, int fallback) {
        return json.optInt(key, fallback);
    }

    long optLong(String key, long fallback) {
        return json.optLong(key, fallback);
    }

    double optDouble(String key, double fallback) {
        return json.optDouble(key, fallback);
    }

    /**
     * Rect of the located element, in screen pixels, or null when absent.
     *
     * The other fields on a `locate` event — `geometry`, `scale`, `source`,
     * `taskId`, `description` — describe where the rectangle came from. The
     * overlay only draws, so it reads none of them; they are for a log or a
     * future tooltip.
     */
    Rect locateBox() {
        JSONObject rect = json.optJSONObject("rect");
        if (rect == null) {
            return null;
        }
        return new Rect(
                (float) rect.optDouble("x"),
                (float) rect.optDouble("y"),
                (float) rect.optDouble("w"),
                (float) rect.optDouble("h"));
    }

    /** Screen-pixel point of a tap, or null when the event carries no usable one. */
    Point tapPoint() {
        double x = json.optDouble("x", -1);
        double y = json.optDouble("y", -1);
        if (x < 0 || y < 0) {
            return null;
        }
        return new Point((float) x, (float) y);
    }

    static final class Rect {
        final float x;
        final float y;
        final float w;
        final float h;

        Rect(float x, float y, float w, float h) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
        }
    }

    static final class Point {
        final float x;
        final float y;

        Point(float x, float y) {
            this.x = x;
            this.y = y;
        }
    }
}
