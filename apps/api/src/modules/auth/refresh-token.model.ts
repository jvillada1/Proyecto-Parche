import { Schema, model, type InferSchemaType } from 'mongoose'

const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    userAgent: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type RefreshTokenDoc = InferSchemaType<typeof refreshTokenSchema>
export const RefreshToken = model('RefreshToken', refreshTokenSchema)
