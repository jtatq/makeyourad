function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export async function fileToDataUrl(
  file: File,
  maxEdge = 1280,
  quality = 0.72,
): Promise<{ filename: string; mime: string; dataUrl: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const mime = "image/jpeg";
    const dataUrl = canvas.toDataURL(mime, quality);
    const filename = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    if (dataUrl.length > 2_400_000) {
      return fileToDataUrl(file, Math.round(maxEdge * 0.8), Math.max(0.55, quality - 0.1));
    }
    return { filename, mime, dataUrl };
  } catch {
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl.length > 2_400_000) throw new Error("That photo is too large. Try a smaller one.");
    return { filename: file.name, mime: file.type || "image/jpeg", dataUrl };
  }
}
