import { z } from 'zod'
import { cloudinary } from './cloudinary'

// Imagen que el frontend recibió de Cloudinary y envía junto con el formulario.
export const uploadedImageSchema = z
  .object({
    url: z.string('Falta la URL de la imagen').trim().max(500),
    publicId: z.string('Falta el publicId de la imagen').trim().min(1).max(300),
  })
  .refine(cloudinary.isOwnImage, {
    message: 'La imagen debe subirse a través de Parche',
    path: ['url'],
  })

export type UploadedImageInput = z.infer<typeof uploadedImageSchema>
