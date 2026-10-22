
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../../src/orders/orders.service.js';
import { PickupService } from '../../src/pickup/pickup.service.js';
import { prisma } from './test-database.js';

describe('Order expiry (real PostgreSQL)', () => {
  const ordersService = new OrdersService(prisma as never);
  const pickupService = new PickupService(prisma as never);

  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const product = await prisma.product.create({
      data: {
        name: `Expiry Test ${Date.now()}`,
        pricePaise: 500,
        stock: 2,
      },
    });

    productId = product.id;

    const order = await prisma.order.create({
      data: {
        status: 'HELD',
        totalPaise: 500,
        expiresAt: new Date(Date.now() - 1_000),
        items: {
          create: {
            productId,
            quantity: 1,
            pricePaise: 500,
          },
        },
      },
    });

    orderId = order.id;
  });

  afterAll(async () => {
    if (orderId) {
      await prisma.paymentEvent.deleteMany({ where: { orderId } });
      await prisma.orderItem.deleteMany({ where: { orderId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    }

    if (productId) {
      await prisma.product.deleteMany({ where: { id: productId } });
    }

    await prisma.$disconnect();
  });

  it('transitions an expired hold to EXPIRED when status is checked', async () => {
    const result = await ordersService.getOrderStatus(orderId);

    expect(result.status).toBe('EXPIRED');

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });

    expect(savedOrder.status).toBe('EXPIRED');
  });

  it('rejects pickup of an expired order with 409 Conflict', async () => {
    await expect(
      pickupService.claim(orderId),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
