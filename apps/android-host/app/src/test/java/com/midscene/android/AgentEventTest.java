package com.midscene.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The event contract between the bundled agent runtime and this app.
 *
 * The payloads below are copied verbatim from `[event]` lines captured on the
 * emulator (a `screenshotShrinkFactor: 2` run against Settings, 1080x2400), so a
 * renamed or dropped field — the failure that leaves the overlay's box in the
 * wrong place or missing entirely — fails here rather than only on a device.
 */
public class AgentEventTest {

    /**
     * The point-only case, which is what `deepseek-flash` returns: the runtime
     * synthesises a fixed 48x48 marker around the centre and says so in
     * `geometry`, leaving `screenshot` null. The rectangle is already in screen
     * pixels by this stage, so the app must not scale it again.
     */
    @Test
    public void readsTheLocateBoxOfAPointOnlyResult() {
        AgentEvent event = AgentEvent.parse(
                "{\"event\":\"locate\",\"rect\":{\"x\":516,\"y\":196,\"w\":48,\"h\":48},"
                        + "\"geometry\":\"point\",\"source\":\"output.element\","
                        + "\"taskId\":\"11eb29a5-ff10-4c9b-b081-226917f20ea3\",\"action\":\"Locate\","
                        + "\"description\":\"设置页顶部的搜索框（Search settings 搜索栏）\","
                        + "\"screenshot\":null,\"center\":[270,110],\"scale\":2}");

        assertEquals(AgentEvent.LOCATE, event.kind);
        AgentEvent.Rect box = event.locateBox();
        assertNotNull(box);
        assertEquals(516f, box.x, 0f);
        assertEquals(196f, box.y, 0f);
        assertEquals(48f, box.w, 0f);
        assertEquals(48f, box.h, 0f);
    }

    /** A real bounding box keeps its own size; only `geometry` distinguishes it. */
    @Test
    public void readsTheLocateBoxOfARealBoundingBox() {
        AgentEvent event = AgentEvent.parse(
                "{\"event\":\"locate\",\"rect\":{\"x\":708,\"y\":1230,\"w\":96,\"h\":64},"
                        + "\"geometry\":\"bbox\",\"source\":\"param.locate\",\"scale\":1}");

        AgentEvent.Rect box = event.locateBox();
        assertNotNull(box);
        assertEquals(96f, box.w, 0f);
        assertEquals(64f, box.h, 0f);
    }

    @Test
    public void readsTheTapPoint() {
        AgentEvent event = AgentEvent.parse("{\"event\":\"tap\",\"x\":540,\"y\":220}");

        assertEquals(AgentEvent.TAP, event.kind);
        AgentEvent.Point point = event.tapPoint();
        assertNotNull(point);
        assertEquals(540f, point.x, 0f);
        assertEquals(220f, point.y, 0f);
    }

    /** A tap without coordinates must not draw a ripple at the origin. */
    @Test
    public void ignoresATapWithoutCoordinates() {
        assertNull(AgentEvent.parse("{\"event\":\"tap\"}").tapPoint());
        assertNull(AgentEvent.parse("{\"event\":\"tap\",\"x\":-1,\"y\":-1}").tapPoint());
    }

    @Test
    public void readsTheProgressFields() {
        AgentEvent start = AgentEvent.parse(
                "{\"event\":\"step.start\",\"index\":2,\"total\":2,\"name\":\"tap-search-field\","
                        + "\"taskType\":\"yaml\",\"phase\":\"acting\",\"prompt\":\"script: tasks:\","
                        + "\"startedAt\":1789532660861}");

        assertEquals(AgentEvent.STEP_START, start.kind);
        assertEquals(2, start.optInt("index", 0));
        assertEquals(2, start.optInt("total", 0));
        assertEquals("acting", start.optString("phase", ""));
        assertEquals(1789532660861L, start.optLong("startedAt", 0L));
        // step.start falls back to `name` when there is no prompt.
        assertEquals("tap-search-field", start.optString("name", ""));
    }

    @Test
    public void readsAnActionTip() {
        AgentEvent event = AgentEvent.parse(
                "{\"event\":\"action\",\"seq\":2,\"tip\":\"Tap - 设置页顶部的搜索框\"}");

        assertEquals(AgentEvent.ACTION, event.kind);
        assertEquals("Tap - 设置页顶部的搜索框", event.optString("tip", ""));
        assertEquals(2, event.optInt("seq", 0));
    }

    /** Lines that are not events, and malformed payloads, are simply not events. */
    @Test
    public void ignoresNonEventsAndMalformedJson() {
        assertNull(AgentEvent.parse("not json at all").kind);
        assertNull(AgentEvent.parse("{\"no\":\"event field\"}").kind);
        assertNull(AgentEvent.parse(null).kind);
        // A known-looking object with the wrong shape yields no box, not a crash.
        assertNull(AgentEvent.parse("{\"event\":\"locate\"}").locateBox());
        assertNull(AgentEvent.parse("{\"event\":\"locate\",\"rect\":\"nope\"}").locateBox());
    }
}
