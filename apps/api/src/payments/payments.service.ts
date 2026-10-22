import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../prisma.service.js';

type PaymentWebhook = {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'FAILED';
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private verifySignature(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!secret) {
      throw new Error('PAYMENT_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing payment signature');
    }

    // Accept either a plain hex digest or "sha256=<hex digest>".
    const supplied = signature.startsWith('sha256=')
      ? signature.slice('sha256='.length)
      : signature;

    if (!/^[a-fA-F0-9]{64}$/.test(supplied)) {
      throw new UnauthorizedException('Invalid payment signature');
    }

    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest();

    const actual = Buffer.from(supplied, 'hex');

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid payment signature');
    }
  }

  async handleWebhook(
    body: unknown,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody) {
      throw new BadRequestException('Raw request body is unavailable');
    }

    this.verifySignature(rawBody, signature);

    if (
      typeof body !== 'object' ||
      body === null ||
      !('eventId' in body) ||
      typeof body.eventId !== 'string' ||
      !body.eventId.trim() ||
      !('orderId' in body) ||
      typeof body.orderId !== 'string' ||
      !body.orderId.trim() ||
      !('amountPaise' in body) ||
      typeof body.amountPaise !== 'number' ||
      !Number.isSafeInteger(body.amountPaise) ||
      body.amountPaise < 0 ||
      !('status' in body) ||
      (body.status !== 'captured' && body.status !== 'FAILED')
    ) {
      throw new BadRequestException('Invalid payment event payload');
    }

    const event: PaymentWebhook = {
      eventId: body.eventId.trim(),
      orderId: body.orderId.trim(),
      amountPaise: body.amountPaise,
      status: body.status,
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize payment events for the same order.
        const lockedOrders = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM "Order"
          WHERE id = ${event.orderId}
          FOR UPDATE
        `;

        // Store the event and update the order in the same transaction.
        // The unique eventId constraint prevents duplicate processing.
        await tx.paymentEvent.create({
          data: {
            eventId: event.eventId,
            orderId: event.orderId,
            amountPaise: event.amountPaise,
            providerStatus: event.status,
            payload: body as Prisma.InputJsonValue,
          },
        });

        if (lockedOrders.length === 0) {
          return {
            received: true,
            outcome: 'ORDER_NOT_FOUND',
          };
        }

        const order = await tx.order.findUniqueOrThrow({
          where: { id: event.orderId },
        });

        if (event.status === 'FAILED') {
          return {
            received: true,
            outcome: 'PAYMENT_FAILED',
          };
        }

        if (event.amountPaise !== order.totalPaise) {
          if (order.status === 'HELD' || order.status === 'EXPIRED') {
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'NEEDS_REVIEW' },
            });
          }

          return {
            received: true,
            outcome: 'AMOUNT_MISMATCH_REVIEW',
          };
        }

        if (order.status !== 'HELD' || order.expiresAt <= new Date()) {
          if (order.status === 'HELD' || order.status === 'EXPIRED') {
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'NEEDS_REVIEW' },
            });
          }

          return {
            received: true,
            outcome: 'LATE_OR_INELIGIBLE_PAYMENT_REVIEW',
          };
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID' },
        });

        return {
          received: true,
          outcome: 'PAYMENT_ACCEPTED',
          orderId: order.id,
          status: 'PAID',
        };
      });
    } catch (error) {
      // A concurrent retry of the same event can hit the unique constraint.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          received: true,
          outcome: 'DUPLICATE_EVENT',
        };
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('Order changed while processing payment');
      }

      throw error;
    }
  }
}