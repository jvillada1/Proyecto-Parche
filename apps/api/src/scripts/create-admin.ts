import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { createAdminSchema } from '../modules/auth/auth.schemas'
import { createAdmin } from '../modules/auth/auth.service'
import { formatZodIssues } from '../utils/zod-issues'

// Uso:
//   pnpm --filter api admin:create                      → pide los datos por consola
//   ADMIN_NAME=… ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm …  → sin interacción (CI / despliegue)

let muted = false
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding)
    callback()
  },
})

async function prompt(question: string, { hidden = false } = {}) {
  const rl = createInterface({ input: stdin, output, terminal: true })
  try {
    if (!hidden) return await rl.question(question)

    stdout.write(question)
    muted = true
    const answer = await rl.question('')
    muted = false
    stdout.write('\n')
    return answer
  } finally {
    rl.close()
  }
}

async function readInput() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (ADMIN_NAME && ADMIN_EMAIL && ADMIN_PASSWORD) {
    return { name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  }

  if (!stdin.isTTY) {
    throw new Error('Sin terminal interactiva: define ADMIN_NAME, ADMIN_EMAIL y ADMIN_PASSWORD')
  }

  const name = await prompt('Nombre: ')
  const email = await prompt('Correo: ')
  const password = await prompt('Contraseña: ', { hidden: true })
  const confirmation = await prompt('Confirma la contraseña: ', { hidden: true })
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden')

  return { name, email, password }
}

async function main() {
  const parsed = createAdminSchema.safeParse(await readInput())
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error).map(
      (issue) => `  - ${issue.path}: ${issue.message}`,
    )
    throw new Error(`Datos inválidos:\n${issues.join('\n')}`)
  }

  await connectDB()
  const admin = await createAdmin(parsed.data)
  console.log(`✅ Administrador creado: ${admin.email} (id ${String(admin._id)})`)
}

try {
  await main()
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
