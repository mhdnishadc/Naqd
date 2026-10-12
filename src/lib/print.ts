/**
 * Open the print dialog with `name` as the suggested PDF file name.
 * Browsers take "Save as PDF" file names from document.title, so swap it in for the print
 * and put it back afterwards (afterprint, because mobile print dialogs don't block).
 */
export function printAs(name: string) {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  const prev = document.title
  if (clean) document.title = clean
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore) }
  window.addEventListener('afterprint', restore)
  window.print()
}
