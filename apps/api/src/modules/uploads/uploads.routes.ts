import { Router } from 'express'
import { requireAuth, requireRole } from '../../middlewares/auth'
import { uploadSignatureRateLimiter } from '../../middlewares/rate-limit'
import { cloudinary } from './cloudinary'

// El archivo nunca pasa por el backend: el navegador lo sube directo a Cloudinary con esta firma.
export const uploadsRoutes = Router()

uploadsRoutes.post(
  '/signature',
  requireAuth,
  requireRole('manager'),
  uploadSignatureRateLimiter,
  (_req, res) => {
    res.json({ data: cloudinary.createUploadSignature() })
  },
)
