export const removeTabIndex = (document: Document) => {
  document.querySelectorAll('a').forEach((a) => {
    a.setAttribute('tabindex', '-1');
  });
};
