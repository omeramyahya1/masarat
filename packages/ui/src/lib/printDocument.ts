// Opens the browser's print dialog for the open document dialog (the receipt and manifest, or the
// report); "Save as PDF" there makes the PDF. The page title is the name the browser suggests for
// the file, so it's set to the document's for the length of the print.
export function printDocument(fileName: string): void {
  const title = document.title
  document.title = fileName
  window.addEventListener('afterprint', () => (document.title = title), { once: true })
  window.print()
}
