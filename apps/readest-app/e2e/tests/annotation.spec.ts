import { expect, test } from '../fixtures/base';

test.describe('Annotation', () => {
  test('shows the annotation popup when text is selected', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();

    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
  });

  test('creates a highlight from the selected text', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();

    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);
  });

  test('closing the dictionary popup returns to the selection toolbar (#5213)', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Dictionary').click();
    await expect(reader.dictionaryPopup).toBeVisible();
    await expect(reader.annotationPopup).toBeHidden();

    await reader.page.keyboard.press('Escape');

    await expect(reader.dictionaryPopup).toBeHidden();
    // The selection survives the lookup, so its toolbar must come back with
    // it — before the fix the dismiss discarded both.
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
  });

  // The translator and proofread popups keep the selection alive by the same
  // mechanism as the dictionary, so their dismiss lands on the same toolbar.
  test('closing the translator popup returns to the selection toolbar (#5213)', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Translate').click();
    await expect(reader.translatorPopup).toBeVisible();
    await expect(reader.annotationPopup).toBeHidden();

    await reader.page.keyboard.press('Escape');

    await expect(reader.translatorPopup).toBeHidden();
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
  });

  test('closing the proofread popup returns to the selection toolbar (#5213)', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.popupTool('Proofread').click();
    await expect(reader.proofreadPopup).toBeVisible();
    await expect(reader.annotationPopup).toBeHidden();

    await reader.page.keyboard.press('Escape');

    await expect(reader.proofreadPopup).toBeHidden();
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
  });

  // The instant dictionary is the other side of the #5213 boundary: the word was
  // tapped to be looked up, not selected, so the lookup owns the gesture end to
  // end — nothing is left to highlight or copy afterwards.
  test('the instant dictionary drops the selection and dismisses clean (#5585)', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.setQuickAction('Dictionary');
    await reader.selectWord();

    await expect(reader.dictionaryPopup).toBeVisible();
    await expect(reader.annotationPopup).toBeHidden();
    // iOS paints its native selection handles and blue highlight above web
    // content, i.e. on top of the popup, so the lookup deselects as it opens.
    expect(await reader.selectedSectionText()).toBe('');

    await reader.page.keyboard.press('Escape');

    await expect(reader.dictionaryPopup).toBeHidden();
    // No live selection left, so the dismiss has no toolbar to return to.
    await expect(reader.annotationPopup).toBeHidden();
  });

  // Tapping a highlight (or holding one out with Instant Highlight) opens its
  // range editor: app-drawn handles in a fixed overlay painted after the lookup
  // popups, so they floated on top of the dictionary (#5815). A lookup hides
  // them; they come back only with the toolbar.
  test('hides the range-edit handles while the dictionary popup is open (#5815)', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();
    await reader.dismissPopup();
    await reader.clickHighlight();

    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.rangeHandles).toHaveCount(2);

    await reader.popupTool('Dictionary').click();

    await expect(reader.dictionaryPopup).toBeVisible();
    await expect(reader.rangeHandles).toHaveCount(0);

    await reader.page.keyboard.press('Escape');

    await expect(reader.dictionaryPopup).toBeHidden();
    // A highlight tap carries no live selection, so the dismiss is the full
    // one: no toolbar to return to and no editor to bring back.
    await expect(reader.annotationPopup).toBeHidden();
    await expect(reader.rangeHandles).toHaveCount(0);
  });

  test('changes the highlight color', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();
    await reader.selectHighlightColor('green');

    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);
  });

  test('adds a note to the selected text', async ({ openBook }) => {
    const reader = await openBook();
    const noteText = 'A note added by the e2e suite';

    await reader.selectText();
    await reader.addNote(noteText);

    await reader.openAnnotationsTab();
    await expect(reader.annotationItems.getByText(noteText)).toBeVisible();
  });

  test('copies a link to the highlight once Copy Link is enabled', async ({
    openBook,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const reader = await openBook();

    // Opt-in only: the tool is absent from the default toolbar.
    await reader.selectText();
    await expect(reader.popupTool('Copy Link')).toHaveCount(0);
    await reader.dismissPopup();

    await reader.enableAnnotationTool('Copy Link');

    await reader.selectText();
    await reader.highlightSelection();
    await reader.popupTool('Copy Link').click();

    const copied = await reader.readClipboard();
    expect(copied).toMatch(/\/o\/book\/[^/]+\/annotation\/[^?]+\?cfi=/);
  });

  test('leaves the first line of text hittable when the page header is off', async ({
    openBook,
  }) => {
    // #4977: the header bar's hover strip was a fixed 44px, the default page
    // header margin. With the page header off the text moves up to the 16px
    // compact margin and rendered under the strip, which took the press that
    // should have started a selection. Desktop Chrome is the platform that
    // still arms the strip (mobile keeps it inert since #5429).
    const TRIGGER_BAND_PX = 44;
    const reader = await openBook();
    await reader.openTocChapter(3);
    await reader.setPageHeaderVisible(false);

    const hit = await reader.firstLineHitTestNearTop(TRIGGER_BAND_PX);

    // Guard the premise: a line the strip never reached proves nothing.
    expect(hit?.top).toBeLessThan(TRIGGER_BAND_PX);
    expect(hit?.owner).toBe('reader');
  });

  test('deletes an annotation', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();
    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);

    await reader.deleteFirstAnnotation();

    await expect(reader.annotationItems).toHaveCount(0);
  });
});
