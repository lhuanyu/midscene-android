package com.midscene.android;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/**
 * The progress panel's geometry.
 *
 * The panel used to be sized to its content, and its content ticks: the timings go from
 * "9s" to "10s", a step description arrives, the next one is shorter. Every one of those
 * changed the card's width and its centred position, so the panel visibly twitched for the
 * whole run — and a stop control inside it would have moved with it. These tests pin the
 * two properties that fix that: the box is a function of the screen alone, and the control
 * stays inside the box it was reserved in.
 *
 * The width is a function of the screen too, in the other sense: a phone keeps the compact
 * card and a tablet gets a wider one, so the second row — the one carrying a whole sentence —
 * is not ellipsised on the device with the most room to show it.
 */
public class OverlayPanelTest {

    /** A 1080x2340 phone at 3x, status bar 66px. */
    private static final int SCREEN = 1080;
    private static final int INSET = 66;
    private static final float DENSITY = 3f;
    /** A 800x1280 tablet at 2x. */
    private static final int TABLET = 1600;

    @Test
    public void theBoxDependsOnTheScreenAndNotOnWhatItSays() {
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        // Same screen, insets and density — nothing else goes into it, so no amount of
        // "Step 12.4s · Total 3m20s" can resize the card.
        OverlayView.Panel again = new OverlayView.Panel(SCREEN, INSET, DENSITY);

        assertEquals(phone.left, again.left, 0.01f);
        assertEquals(phone.width, again.width, 0.01f);
        assertEquals(phone.height, again.height, 0.01f);
        assertEquals(phone.buttonLeft, again.buttonLeft, 0.01f);
        assertEquals(phone.buttonTop, again.buttonTop, 0.01f);
        // A fixed width, and a height that reserves both rows whether they are filled or not.
        assertEquals(OverlayView.Panel.WIDTH_DP * DENSITY, phone.width, 0.01f);
        assertTrue("the second row is part of the box",
                phone.height >= (OverlayView.Panel.ROW_HEIGHT_DP
                        + OverlayView.Panel.DETAIL_HEIGHT_DP) * DENSITY);
    }

    @Test
    public void thePanelIsCentredAndStaysOnScreen() {
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        assertEquals(SCREEN / 2f, phone.left + phone.width / 2f, 0.01f);
        assertTrue(phone.left >= 0f);
        assertTrue(phone.left + phone.width <= SCREEN);
        // Below the status bar, never behind the clock.
        assertTrue(phone.top > INSET);
    }

    @Test
    public void aNarrowScreenGetsMarginsRatherThanOverflow() {
        // A small phone at a high density: the panel has to shrink to the screen.
        OverlayView.Panel small = new OverlayView.Panel(720, 48, 3f);
        assertTrue(small.width > 0f);
        assertTrue(small.left >= 0f);
        assertTrue(small.left + small.width <= 720);
    }

    @Test
    public void theStopControlSitsInsideTheFirstRowItWasReservedIn() {
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        float rowTop = phone.top + OverlayView.Panel.PAD_DP * DENSITY;
        float rowCenter = rowTop + OverlayView.Panel.ROW_HEIGHT_DP * DENSITY / 2f;

        assertTrue("inside the card horizontally",
                phone.buttonLeft >= phone.left
                        && phone.buttonRight(DENSITY) <= phone.left + phone.width);
        assertTrue("inside the card vertically",
                phone.buttonTop >= phone.top
                        && phone.buttonTop + phone.buttonHeight <= phone.top + phone.height);
        // Centred on the row it belongs to: taller than the row's text band by design (a
        // 19dp button is not a tap target), which the card's padding absorbs.
        assertEquals(rowCenter, phone.buttonTop + phone.buttonHeight / 2f, 0.5f);
        // And the text column stops before the control, so nothing is drawn underneath it.
        assertTrue(phone.textRight(DENSITY) <= phone.buttonLeft);
        assertTrue(phone.textRight(DENSITY) > phone.innerLeft(DENSITY));
    }

    @Test
    public void theControlIsBigEnoughToHitAndTheTextRowIsStillUsable() {
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        assertTrue("a tap target of at least 44dp wide",
                phone.buttonWidth >= 44f * DENSITY);
        assertTrue("and 24dp tall", phone.buttonHeight >= 24f * DENSITY);
        // The first row has to hold, in this order: dot (7dp) + gap (8dp) + phase label
        // (~52dp for "Starting") + gap (8dp) + the counter chip (~34dp) + gap (8dp) + the
        // run's clock (~30dp for "1:04"). 150dp is that budget with the longest of the
        // short labels, so a compact row still reads in both languages.
        float textColumn = phone.textRight(DENSITY) - phone.innerLeft(DENSITY);
        assertTrue("room for label, counter and clock", textColumn >= 150f * DENSITY);
        // Compact: no wider than the content-sized card it replaced could get.
        assertTrue("the panel stays narrow", phone.width <= 300f * DENSITY);
    }

    @Test
    public void aWideScreenGetsAWiderPanelThanAPhone() {
        // 1600x2560 at 2x: 800dp across, i.e. a tablet. Compared in dp, because the card is
        // laid out in dp — pixels differ between the two devices' densities.
        OverlayView.Panel tablet = new OverlayView.Panel(TABLET, 48, 2f);
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        float tabletDp = tablet.width / 2f;
        float phoneDp = phone.width / DENSITY;

        assertTrue("a tablet card is wider in dp than a phone one", tabletDp > phoneDp);
        // 48% of 800dp, as arithmetic: a reading width, not an edge-to-edge banner.
        assertEquals(384f, tabletDp, 0.01f);
    }

    @Test
    public void thePhoneCardIsUnchanged() {
        // The width the panel was tuned to on a phone is a floor, not a fraction: at 360dp
        // (the common phone) 48% of the screen would be *narrower* than the layout has room
        // for on one row, so the phone keeps the card it has always had.
        OverlayView.Panel phone = new OverlayView.Panel(SCREEN, INSET, DENSITY);
        assertEquals(OverlayView.Panel.WIDTH_DP * DENSITY, phone.width, 0.01f);
        // 2340px at 3x is 780dp, which is past a phone: the width follows the screen dp, not
        // a list of device names.
        OverlayView.Panel wide = new OverlayView.Panel(2340, INSET, DENSITY);
        assertTrue(wide.width > phone.width);
    }

    @Test
    public void aPanelNeverWiderThanItsScreenKeepsItsMargins() {
        // A 720px screen at 3x is 240dp: the card has to shrink to it, margins and all,
        // rather than being drawn off the edge.
        OverlayView.Panel small = new OverlayView.Panel(720, 48, 3f);
        assertEquals(720f - 2 * 16f * 3f, small.width, 0.01f);
        assertTrue(small.left >= 0f);
        assertTrue(small.left + small.width <= 720);
    }

    @Test
    public void wideningStopsBeforeTheCardBecomesABanner() {
        // A desktop-sized display: the second row carries one sentence, so the card stops
        // growing rather than spanning a screen nobody can read across.
        OverlayView.Panel huge = new OverlayView.Panel(5120, 64, 2f);
        assertTrue("capped", huge.width <= 460f * 2f);
        assertTrue("but wider than a phone", huge.width > OverlayView.Panel.WIDTH_DP * 2f);
        assertEquals(5120 / 2f, huge.left + huge.width / 2f, 0.01f);
    }

    @Test
    public void everyScreenSizeKeepsTheControlInsideTheCard() {
        // The stop control is placed from the same arithmetic, so widening the card must not
        // let the button or the text column fall outside it on any of them.
        float[] densities = {2f, 2.5f, 3f, 4f};
        int[] screens = {720, 1080, 1440, 1600, 2560, 5120};
        for (float density : densities) {
            for (int screen : screens) {
                OverlayView.Panel panel = new OverlayView.Panel(screen, 48, density);
                assertTrue("width fits " + screen + "@" + density,
                        panel.width > 0f && panel.left >= 0f
                                && panel.left + panel.width <= screen);
                assertTrue("button inside " + screen + "@" + density,
                        panel.buttonLeft >= panel.left
                                && panel.buttonRight(density) <= panel.left + panel.width);
                assertTrue("text column in front of the button " + screen + "@" + density,
                        panel.textRight(density) <= panel.buttonLeft
                                && panel.textRight(density) > panel.innerLeft(density));
            }
        }
    }
}
