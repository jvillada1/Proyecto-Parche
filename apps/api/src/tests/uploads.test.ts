import { Types } from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { IMAGE_UPLOAD } from '@parche/shared'
import { createApp } from '../app'
import { signAccessToken } from '../lib/tokens'
import { createCloudinary, signParams } from '../modules/uploads/cloudinary'
import { uploadedImageSchema } from '../modules/uploads/uploads.schemas'

const app = createApp()
const SIGNATURE = '/api/v1/uploads/signature'
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0)

const config = {
  cloudName: 'mi-nube',
  apiKey: '111222333',
  apiSecret: 'secreto',
  folder: 'parche',
  now: () => NOW,
}

function bearer(role: 'manager' | 'user' | 'admin') {
  return `Bearer ${signAccessToken(new Types.ObjectId(), role)}`
}

describe('signParams', () => {
  it('coincide con el ejemplo de la documentación de Cloudinary', () => {
    const signature = signParams(
      {
        timestamp: '1315060510',
        public_id: 'sample_image',
        eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
      },
      'abcd',
    )

    expect(signature).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e')
  })
})

describe('createUploadSignature', () => {
  it('firma carpeta, formatos y tamaño fijos', () => {
    const result = createCloudinary(config).createUploadSignature()

    expect(result).toEqual({
      uploadUrl: 'https://api.cloudinary.com/v1_1/mi-nube/image/upload',
      params: {
        allowed_formats: 'jpg,png,webp',
        folder: 'parche',
        timestamp: String(NOW / 1000),
        transformation: 'c_limit,h_2000,w_2000',
        api_key: '111222333',
        signature: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
      allowedFormats: IMAGE_UPLOAD.allowedFormats,
      maxFileSizeBytes: IMAGE_UPLOAD.maxFileSizeBytes,
    })
  })

  it('la firma cubre exactamente los parámetros que se envían a Cloudinary', () => {
    const { params } = createCloudinary(config).createUploadSignature()
    const { signature, ...signed } = params
    delete (signed as Record<string, string>).api_key

    expect(signature).toBe(signParams(signed, 'secreto'))
    expect(signature).not.toBe(signParams({ ...signed, folder: 'otra' }, 'secreto'))
  })

  it.each(['cloudName', 'apiKey', 'apiSecret'] as const)(
    'responde UPLOADS_NOT_CONFIGURED si falta %s',
    (missing) => {
      const cloudinary = createCloudinary({ ...config, [missing]: undefined })

      expect(() => cloudinary.createUploadSignature()).toThrow(
        expect.objectContaining({ status: 503, code: 'UPLOADS_NOT_CONFIGURED' }),
      )
    },
  )
})

describe('isOwnImage', () => {
  const { isOwnImage } = createCloudinary(config)
  const publicId = 'parche/abc123'

  it.each([
    [
      'con versión',
      'https://res.cloudinary.com/mi-nube/image/upload/v1730000000/parche/abc123.jpg',
    ],
    ['sin versión', 'https://res.cloudinary.com/mi-nube/image/upload/parche/abc123.webp'],
  ])('acepta una imagen de la cuenta %s', (_case, url) => {
    expect(isOwnImage({ url, publicId })).toBe(true)
  })

  it.each([
    ['de otra cuenta', 'https://res.cloudinary.com/otra-nube/image/upload/v1/parche/abc123.jpg'],
    ['por http', 'http://res.cloudinary.com/mi-nube/image/upload/v1/parche/abc123.jpg'],
    ['de otro dominio', 'https://evil.com/mi-nube/image/upload/v1/parche/abc123.jpg'],
    [
      'con un dominio parecido',
      'https://res.cloudinary.com.evil.com/mi-nube/image/upload/v1/parche/abc123.jpg',
    ],
    ['de otro publicId', 'https://res.cloudinary.com/mi-nube/image/upload/v1/parche/otra.jpg'],
    [
      'con transformaciones en la URL',
      'https://res.cloudinary.com/mi-nube/image/upload/w_10/v1/parche/abc123.jpg',
    ],
    [
      'con formato no permitido',
      'https://res.cloudinary.com/mi-nube/image/upload/v1/parche/abc123.gif',
    ],
    ['de video', 'https://res.cloudinary.com/mi-nube/video/upload/v1/parche/abc123.jpg'],
    [
      'con query string',
      'https://res.cloudinary.com/mi-nube/image/upload/v1/parche/abc123.jpg?x=1',
    ],
    ['que no es URL', 'no-es-una-url'],
  ])('rechaza una URL %s', (_case, url) => {
    expect(isOwnImage({ url, publicId })).toBe(false)
  })

  it('rechaza un publicId fuera de la carpeta', () => {
    const url = 'https://res.cloudinary.com/mi-nube/image/upload/v1/otra/abc123.jpg'

    expect(isOwnImage({ url, publicId: 'otra/abc123' })).toBe(false)
  })

  it('rechaza todo si no hay cuenta configurada', () => {
    const url = 'https://res.cloudinary.com/mi-nube/image/upload/v1/parche/abc123.jpg'

    expect(
      createCloudinary({ ...config, cloudName: undefined }).isOwnImage({ url, publicId }),
    ).toBe(false)
  })
})

describe('uploadedImageSchema', () => {
  it('valida contra la cuenta configurada en el entorno', () => {
    const own = {
      url: 'https://res.cloudinary.com/parche-test/image/upload/v1/parche-test/logo.png',
      publicId: 'parche-test/logo',
    }
    const foreign = { ...own, url: own.url.replace('parche-test/image', 'otra/image') }

    expect(uploadedImageSchema.safeParse(own).success).toBe(true)
    const result = uploadedImageSchema.safeParse(foreign)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['url'],
      message: 'La imagen debe subirse a través de Parche',
    })
  })
})

describe('POST /api/v1/uploads/signature', () => {
  it('responde 401 sin token', async () => {
    await request(app).post(SIGNATURE).expect(401)
  })

  it.each(['user', 'admin'] as const)('responde 403 con rol %s', async (role) => {
    await request(app).post(SIGNATURE).set('Authorization', bearer(role)).expect(403)
  })

  it('devuelve la firma al gestor', async () => {
    const response = await request(app).post(SIGNATURE).set('Authorization', bearer('manager'))

    expect(response.status).toBe(200)
    const { uploadUrl, params } = response.body.data
    expect(uploadUrl).toBe('https://api.cloudinary.com/v1_1/parche-test/image/upload')
    expect(params).toMatchObject({
      api_key: '123456789012345',
      folder: 'parche-test',
      allowed_formats: 'jpg,png,webp',
      transformation: 'c_limit,h_2000,w_2000',
    })
    const { signature, ...signed } = params
    delete (signed as Record<string, string>).api_key
    expect(signature).toBe(signParams(signed, 'secreto-de-pruebas'))
    expect(JSON.stringify(response.body)).not.toContain('secreto-de-pruebas')
  })

  it('ignora carpeta o formatos enviados en el body', async () => {
    const response = await request(app)
      .post(SIGNATURE)
      .set('Authorization', bearer('manager'))
      .send({ folder: 'otra', allowed_formats: 'svg' })

    expect(response.body.data.params).toMatchObject({
      folder: 'parche-test',
      allowed_formats: 'jpg,png,webp',
    })
  })
})
