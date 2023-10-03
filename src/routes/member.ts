import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { User } from '@prisma/client'

export async function memberRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/groups/:id/members',
    {
      onRequest: [authenticate]
    },
    async (request, reply) => {
      const queryParams = z.object({
        id: z.string().cuid()
      })
      const { id } = queryParams.parse(request.params)

      const group = await prisma.group.findUnique({
        where: {
          id
        }
      })

      if (!group) return reply.status(404).send()

      const members = await prisma.member.findMany({
        where: {
          group_id: id
        },
        include: {
          member: true
        }
      })
      return { members }
    }
  )

  fastify.get(
    '/recent-members',
    {
      onRequest: [authenticate]
    },
    async request => {
      const { sub: user_id } = request.user

      const groups = await prisma.group.findMany({
        include: {
          Member: {
            include: {
              member: true
            }
          }
        },
        where: {
          Member: {
            some: {
              user_id
            }
          }
        }
      })

      const members: User[] = []

      groups.forEach(({ Member }) => {
        Member.forEach(({ member }) => {
          if (
            !members.find(({ id }) => id === member.id) &&
            member.id !== user_id
          ) {
            members.push(member)
          }
        })
      })

      return { members }
    }
  )

  fastify.patch(
    '/groups/:id/members',
    {
      onRequest: [authenticate]
    },
    async (request, reply) => {
      const createGroupBody = z.object({
        members: z.array(z.string().email())
      })

      const { members } = createGroupBody.parse(request.body)

      const queryParams = z.object({
        id: z.string().cuid()
      })
      const { id } = queryParams.parse(request.params)

      const group = await prisma.group.findUnique({
        where: {
          id
        }
      })

      if (!group) return reply.status(404).send()

      members.map(async member => {
        let user = await prisma.user.findUnique({
          where: {
            email: member
          }
        })

        if (!user)
          user = await prisma.user.create({
            data: {
              email: member
            }
          })

        const groupMember = await prisma.member.findFirst({
          where: {
            group_id: id,
            user_id: user.id
          }
        })

        if (!groupMember)
          await prisma.member.create({
            data: {
              group_id: group.id,
              user_id: user.id
            }
          })
      })

      const groupMembers = await prisma.member.findMany({
        where: {
          group_id: id
        },
        include: {
          member: true
        }
      })

      groupMembers.map(async groupMember => {
        const memberExists = members.includes(groupMember.member.email)
        if (!memberExists) {
          await prisma.member.delete({
            where: {
              group_id_user_id: {
                group_id: groupMember.group_id,
                user_id: groupMember.user_id
              }
            }
          })
        }
      })

      return {
        status: true
      }
    }
  )

  fastify.delete(
    '/groups/:id/members/:user_id',
    {
      onRequest: [authenticate]
    },
    async (request, reply) => {
      const queryParams = z.object({
        id: z.string().cuid(),
        user_id: z.string().cuid()
      })
      const { id, user_id } = queryParams.parse(request.params)

      const groupMember = await prisma.member.findFirst({
        where: {
          group_id: id,
          user_id
        }
      })

      if (!groupMember) return reply.status(404).send()

      await prisma.member.deleteMany({
        where: {
          group_id: id,
          user_id
        }
      })

      return {
        status: true
      }
    }
  )
}
