// Shrink phone photos before upload: longest side ≤ 1600 px, JPEG quality 0.82.

export function fitWithin(w, h, max = 1600) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// Browser only. Returns base64 JPEG data without the "data:...;base64," prefix.
export async function resizeToJpegB64(file, max = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return String(dataUrl).split(',')[1];
}
