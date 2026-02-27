/**
 * Extracts the average (dominant) color from an image URL using heavily downsampled canvas.
 * Returns a hex color string or null if calculation fails (CORS, network error, etc.).
 */
export async function extractDominantColor(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous'; // Required for cross-origin images to not taint canvas

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
          resolve(null);
          return;
        }

        // Draw image very small (e.g. 10x10) to average the colors
        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);

        const imageData = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        const count = imageData.length / 4;

        for (let i = 0; i < imageData.length; i += 4) {
          r += imageData[i];
          g += imageData[i + 1];
          b += imageData[i + 2];
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        // Convert to hex
        const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch (e) {
        console.warn('Failed to extract dominant color (likely CORS taint):', e);
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = imageUrl;
  });
}
