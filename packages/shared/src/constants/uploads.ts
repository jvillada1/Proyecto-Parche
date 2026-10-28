// Reglas fijas de subida de imágenes: las firma el backend y el frontend las usa para validar antes de subir.
export const IMAGE_UPLOAD = {
  allowedFormats: ['jpg', 'png', 'webp'],
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxDimensionPx: 2000,
} as const

export type ImageFormat = (typeof IMAGE_UPLOAD.allowedFormats)[number]
