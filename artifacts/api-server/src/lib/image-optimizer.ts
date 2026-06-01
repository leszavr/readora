import sharp from "sharp";

export type ImageType = "cover" | "thumbnail" | "avatar" | "content";

interface OptimizationOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  fit: "cover" | "inside";
}

const OPTIMIZATION_PRESETS: Record<ImageType, OptimizationOptions> = {
  cover: { maxWidth: 600, maxHeight: 900, quality: 85, fit: "inside" },
  thumbnail: { maxWidth: 150, maxHeight: 225, quality: 80, fit: "inside" },
  avatar: { maxWidth: 400, maxHeight: 400, quality: 85, fit: "cover" },
  content: { maxWidth: 1600, maxHeight: 1600, quality: 85, fit: "inside" },
};

export async function optimizeImage(inputBuffer: Buffer, type: ImageType = "cover") {
  const options = OPTIMIZATION_PRESETS[type];
  const buffer = await sharp(inputBuffer)
    .rotate()
    .resize(options.maxWidth, options.maxHeight, {
      fit: options.fit,
      withoutEnlargement: true,
    })
    .webp({ quality: options.quality, effort: 4 })
    .toBuffer();

  return {
    buffer,
    mimeType: "image/webp",
    extension: "webp",
    originalSize: inputBuffer.length,
    optimizedSize: buffer.length,
  };
}

