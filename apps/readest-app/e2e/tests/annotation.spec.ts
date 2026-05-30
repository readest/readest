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

    await expect(reader.notebook.getByText(noteText)).toBeVisible();
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
