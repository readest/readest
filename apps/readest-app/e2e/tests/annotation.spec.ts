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
