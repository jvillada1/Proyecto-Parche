import { createHash } from 'node:crypto'
import { IMAGE_UPLOAD } from '@parche/shared'
import { env } from '../../config/env'
import { UploadsNotConfiguredError } from '../../utils/app-error'

interface CloudinaryConfig {
  cloudName?: string
  apiKey?: string
  apiSecret?: string
  folder: string
  now?: () => number
}

export interface UploadedImage {
  url: string
  publicId: string
}

// Firma de Cloudinary: parámetros ordenados por nombre como `a=1&b=2`, seguidos del secreto, en SHA-1.
export function signParams(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex')
}

// Cloudinary aplica la transformación al recibir el archivo: lo que se guarda nunca supera estas dimensiones.
const INCOMING_TRANSFORMATION = `c_limit,h_${IMAGE_UPLOAD.maxDimensionPx},w_${IMAGE_UPLOAD.maxDimensionPx}`

export function createCloudinary({
  cloudName,
  apiKey,
  apiSecret,
  folder,
  now = Date.now,
}: CloudinaryConfig) {
  // Carpeta, formatos y transformación van dentro de la firma: si el navegador cambia alguno,
  // Cloudinary rechaza la subida.
  function createUploadSignature() {
    if (!cloudName || !apiKey || !apiSecret) throw new UploadsNotConfiguredError()

    const params = {
      allowed_formats: IMAGE_UPLOAD.allowedFormats.join(','),
      folder,
      timestamp: String(Math.floor(now() / 1000)),
      transformation: INCOMING_TRANSFORMATION,
    }

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      params: { ...params, api_key: apiKey, signature: signParams(params, apiSecret) },
      allowedFormats: IMAGE_UPLOAD.allowedFormats,
      maxFileSizeBytes: IMAGE_UPLOAD.maxFileSizeBytes,
    }
  }

  // Acepta solo la `secure_url` que devuelve Cloudinary para una imagen de esta cuenta y carpeta:
  // https://res.cloudinary.com/<cloud>/image/upload/v<versión>/<publicId>.<formato>
  function isOwnImage({ url, publicId }: UploadedImage) {
    if (!cloudName || !publicId.startsWith(`${folder}/`) || publicId.includes('..')) return false

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return false
    if (parsed.port || parsed.username || parsed.search || parsed.hash) return false

    const prefix = `/${cloudName}/image/upload/`
    if (!parsed.pathname.startsWith(prefix)) return false

    const asset = parsed.pathname.slice(prefix.length).replace(/^v\d+\//, '')
    const extension = asset.slice(publicId.length + 1)
    return (
      asset.startsWith(`${publicId}.`) &&
      (IMAGE_UPLOAD.allowedFormats as readonly string[]).includes(extension)
    )
  }

  return { createUploadSignature, isOwnImage }
}

export const cloudinary = createCloudinary({
  cloudName: env.CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
  folder: env.CLOUDINARY_FOLDER,
})
