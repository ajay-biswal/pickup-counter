import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../prisma.service.js';

type PaymentWebhook = {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'FAILED';
};

type PaymentOrder = {
  id: string;
  status: 'HELD' | 'PAID' | 'EXPIRED' | 'NEEDS_REVIEW' | 'PICKED_UP';
  totalPaise: number;
  expiresAt: Date;
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private verifySignature(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!secret?.trim()) {
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

    const expected = createHmac('sha256', secret).update(rawBody).digest();

    const actual = Buffer.from(supplied, 'hex');

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid payment signature');
    }
  }

  async simulatePayment(orderId: string) {
    const normalizedId = orderId?.trim();
    if (!normalizedId) throw new BadRequestException('Order ID is required');

    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret?.trim()) {
      throw new ServiceUnavailableException(
        'Simulated payments are not configured',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${normalizedId} FOR UPDATE
      `;
      if (rows.length === 0) throw new NotFoundException('Order not found');

      const order = await tx.order.findUniqueOrThrow({
        where: { id: normalizedId },
      });
      if (order.status !== 'HELD' || order.expiresAt <= new Date()) {
        throw new ConflictException('Order is no longer eligible for payment');
      }

      const event: PaymentWebhook = {
        eventId: randomUUID(),
        orderId: order.id,
        amountPaise: order.totalPaise,
        status: 'captured',
      };
      const result = await this.processEvent(tx, event, event, order);
      if (result.outcome !== 'PAYMENT_ACCEPTED') {
        throw new ConflictException('Order is no longer eligible for payment');
      }

      return { initiated: true, eventId: event.eventId, orderId: order.id };
    });
  }

  private async processEvent(
    tx: Prisma.TransactionClient,
    event: PaymentWebhook,
    payload: unknown,
    lockedOrder?: PaymentOrder,
  ) {
    // Simulated payments pass the already locked row; webhook calls lock here.
    const lockedOrders = lockedOrder
      ? [{ id: lockedOrder.id }]
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Order" WHERE id = ${event.orderId} FOR UPDATE
        `;

    await tx.paymentEvent.create({
      data: {
        eventId: event.eventId,
        orderId: event.orderId,
        amountPaise: event.amountPaise,
        providerStatus: event.status,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    if (lockedOrders.length === 0) {
      return { received: true, outcome: 'ORDER_NOT_FOUND' };
    }

    const order =
      lockedOrder ??
      (await tx.order.findUniqueOrThrow({ where: { id: event.orderId } }));
    if (event.status === 'FAILED') {
      return { received: true, outcome: 'PAYMENT_FAILED' };
    }

    const amountMismatch = event.amountPaise !== order.totalPaise;
    const lateOrIneligible =
      order.status !== 'HELD' || order.expiresAt <= new Date();
    if (amountMismatch || lateOrIneligible) {
      if (order.status === 'HELD' || order.status === 'EXPIRED') {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'NEEDS_REVIEW' },
        });
      }

      return {
        received: true,
        outcome: amountMismatch
          ? 'AMOUNT_MISMATCH_REVIEW'
          : 'LATE_OR_INELIGIBLE_PAYMENT_REVIEW',
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
      return await this.prisma.$transaction((tx) =>
        this.processEvent(tx, event, body),
      );
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
