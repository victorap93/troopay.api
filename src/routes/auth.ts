import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { compareSync, genSaltSync, hashSync } from 'bcrypt'
import { User } from '@prisma/client'
import { sendMail } from '../lib/nodemailer'
import cryptoRandomString from 'crypto-random-string'
import { emailTemplate } from '../lib/emailTemplate'

export const tokenGenerator = (
  { firstname, lastname, avatarUrl, email, id }: User,
  fastify: FastifyInstance
) => {
  return fastify.jwt.sign(
    { firstname, lastname, avatarUrl, email },
    {
      sub: id,
      expiresIn: '60 days'
    }
  )
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/me',
    {
      onRequest: [authenticate]
    },
    async request => {
      return { user: request.user }
    }
  )

  fastify.post('/sign-in', async request => {
    const createUserBody = z.object({
      email: z.string().email(),
      password: z.string()
    })

    const { email, password } = createUserBody.parse(request.body)

    let user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user || (!user.password && !user.googleId))
      return {
        status: false,
        message: 'Usuário não existe.',
        error: 'USER_DOES_NOT_EXIST'
      }

    if (!compareSync(password, user?.password || ''))
      return {
        status: false,
        message: 'Senha inválida.',
        error: 'INVALID_PASSWORD'
      }

    return {
      status: true,
      token: tokenGenerator(user, fastify),
      user: {
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        avatarUrl: user.avatarUrl
      }
    }
  })

  fastify.post('/sign-up', async (request, reply) => {
    const createUserBody = z.object({
      firstname: z.string().min(3),
      lastname: z.string().min(3),
      email: z.string().email(),
      password: z.string().min(6)
    })
    const { firstname, lastname, email, password } = createUserBody.parse(
      request.body
    )
    let user = await prisma.user.findUnique({
      where: { email }
    })
    if (user && (user.password || user.googleId))
      return {
        status: false,
        message: user.googleId
          ? 'Usuário autenticado com o Google.'
          : 'Usuário já cadastrado.',
        error: user.googleId
          ? 'USER_AUTHENTICATED_WITH_GOOGLE'
          : 'USER_ALREADY_EXISTS'
      }
    const hash = hashSync(password, genSaltSync(10))
    const data = {
      firstname,
      lastname,
      email,
      password: hash
    }
    user =
      user && !user.password
        ? await prisma.user.update({
            data,
            where: {
              email
            }
          })
        : await prisma.user.create({ data })
    return reply.status(201).send({
      status: true,
      message: 'Usuário cadastrado com sucesso.',
      token: tokenGenerator(user, fastify)
    })
  })

  fastify.post('/google-auth', async request => {
    const createUserBody = z.object({
      accessToken: z.string()
    })
    const { accessToken } = createUserBody.parse(request.body)
    const userResponse = await fetch(process.env.GOOGLE_PROFILE_URL || '', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const userData = await userResponse.json()
    const userInfoSchema = z.object({
      id: z.string(),
      email: z.string().email(),
      given_name: z.string(),
      family_name: z.string(),
      picture: z.string().url()
    })
    const { id, email, given_name, family_name, picture } =
      userInfoSchema.parse(userData)
    let user = await prisma.user.findUnique({
      where: {
        googleId: id
      }
    })
    if (!user) {
      const userDataGoogle = {
        googleId: id,
        firstname: given_name,
        lastname: family_name,
        email: email,
        avatarUrl: picture
      }
      const userVerify = await prisma.user.findUnique({
        where: {
          email
        }
      })
      if (userVerify) {
        user = await prisma.user.update({
          data: userDataGoogle,
          where: {
            email
          }
        })
      } else {
        user = await prisma.user.create({
          data: userDataGoogle
        })
      }
    }
    const token = tokenGenerator(user, fastify)
    return { status: true, token, user }
  })

  fastify.post('/password-recovery', async request => {
    const createUserBody = z.object({
      email: z.string().email()
    })

    const { email } = createUserBody.parse(request.body)

    let user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user || !user.password)
      return {
        status: false,
        message: 'Usuário não existe.',
        error: 'USER_DOES_NOT_EXIST'
      }

    const code = cryptoRandomString({ length: 5, type: 'numeric' })

    const html = `
    <p>Recebemos uma solicitação para redefinição da senha.</p>
    <div style="background: #ddd;padding: 10px; text-align: center;">
      <h2>${code}</h2>
    </div>
    <p>Por favor, utilize este código acima para redefinir sua senha no nosso app.</p>
    <p>Se você não solicitou a redefinição de senha, ignore este e-mail.</p>
    `

    sendMail(
      {
        to: email,
        subject: 'TrooPay - Código para redefinição de senha',
        html: emailTemplate(
          'Código para redefinição de senha',
          `${user.firstname} ${user.lastname}`,
          html
        )
      },
      (error, info) => {
        if (error) console.log(error)
        else console.log(info)
      }
    )

    return {
      status: true
    }
  })
}
