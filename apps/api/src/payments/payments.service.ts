import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../prisma.service.js';
import Razorpay from 'razorpay';


type PaymentWebhook = {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'FAILED';
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}


  async createRazorpayOrder(orderId: string) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured',
      );
    }

    if (!orderId || !orderId.trim()) {
      throw new BadRequestException('Order ID is required');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId.trim() },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== 'HELD' || order.expiresAt <= new Date()) {
      throw new ConflictException(
        'Order is no longer eligible for payment',
      );
    }

    // Reuse the gateway order when one was already saved.
    if (order.razorpayOrderId) {
      return {
        keyId,
        razorpayOrderId: order.razorpayOrderId,
        amount: order.totalPaise,
        currency: 'INR',
        internalOrderId: order.id,
      };
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const gatewayOrder = await razorpay.orders.create({
      amount: order.totalPaise,
      currency: 'INR',
      receipt: order.id,
      notes: {
        internalOrderId: order.id,
      },
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: gatewayOrder.id },
    });

    return {
      keyId,
      razorpayOrderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      internalOrderId: order.id,
    };
  }


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


  async verifyRazorpayPayment(input: {
    orderId: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured',
      );
    }

    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = input;

    if (
      !orderId?.trim() ||
      !razorpay_order_id?.trim() ||
      !razorpay_payment_id?.trim() ||
      !/^[a-fA-F0-9]{64}$/.test(razorpay_signature ?? '')
    ) {
      throw new BadRequestException('Invalid payment verification data');
    }

    const expectedSignature = createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest();

    const actualSignature = Buffer.from(razorpay_signature, 'hex');

    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new UnauthorizedException('Invalid Razorpay signature');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId.trim() },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.razorpayOrderId !== razorpay_order_id) {
      throw new ConflictException('Razorpay order does not match');
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (
      payment.order_id !== order.razorpayOrderId ||
      payment.amount !== order.totalPaise ||
      payment.currency !== 'INR'
    ) {
      throw new ConflictException('Payment details do not match the order');
    }

    if (payment.status !== 'captured') {
      throw new ConflictException(
        `Payment is not captured (status: ${payment.status})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException('Order not found');
      }

      const current = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
      });

      if (current.status === 'PAID') {
        return {
          verified: true,
          status: 'PAID',
          orderId: current.id,
        };
      }

      if (
        current.status !== 'HELD' ||
        current.expiresAt <= new Date()
      ) {
        if (current.status === 'HELD' || current.status === 'EXPIRED') {
          await tx.order.update({
            where: { id: current.id },
            data: { status: 'NEEDS_REVIEW' },
          });
        }

        throw new ConflictException(
          'Order is no longer eligible for payment',
        );
      }

      await tx.order.update({
        where: { id: current.id },
        data: { status: 'PAID' },
      });

      return {
        verified: true,
        status: 'PAID',
        orderId: current.id,
      };
    });
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