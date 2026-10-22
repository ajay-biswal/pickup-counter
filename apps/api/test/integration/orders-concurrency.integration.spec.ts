
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../../src/orders/orders.service.js';
import { prisma } from './test-database.js';

describe('Orders concurrency (real PostgreSQL)', () => {
  const service = new OrdersService(prisma as never);
  let productId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const product = await prisma.product.create({
      data: {
        name: `Concurrency Test ${Date.now()}`,
        pricePaise: 100,
        stock: 2,
      },
    });

    productId = product.id;
  });

  afterAll(async () => {
    if (productId) {
      await prisma.orderItem.deleteMany({ where: { productId } });
      await prisma.order.deleteMany({
        where: {
          items: { some: { productId } },
        },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
    }

    await prisma.$disconnect();
  });

  it('allows only two of ten simultaneous one-unit orders', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.createOrder({
          items: [{ productId, quantity: 1 }],
        }),
      ),
    );

    const succeeded = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const failed = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(8);

    for (const result of failed) {
      if (result.status === 'rejected') {
        expect(result.reason.getStatus()).toBe(409);
      }
    }

    const heldItems = await prisma.orderItem.findMany({
      where: {
        productId,
        order: {
          status: 'HELD',
          expiresAt: { gt: new Date() },
        },
      },
    });

    const heldQuantity = heldItems.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    expect(heldQuantity).toBe(2);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(product.stock).toBe(2);
    expect(product.stock).toBeGreaterThanOrEqual(heldQuantity);
  });
});
