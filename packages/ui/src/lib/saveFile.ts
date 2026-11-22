// Hands a downloaded file to the browser to save, under its name
export function saveFile(file: { blob: Blob; fileName: string }): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  document.body.append(link)
  link.click()
  link.remove()
  // After the click has started the download
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
