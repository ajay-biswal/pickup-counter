import {
  BadRequestException,
  ConflictException,
  Injectable,
   NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service.js';

const HOLD_SECONDS = 120;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(body: unknown) {
    if (
      typeof body !== 'object' ||
      body === null ||
      !('items' in body) ||
      !Array.isArray(body.items) ||
      body.items.length === 0
    ) {
      throw new BadRequestException(
        'items must be a non-empty array',
      );
    }

    const quantities = new Map<string, number>();

    for (const item of body.items) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('productId' in item) ||
        typeof item.productId !== 'string' ||
        !item.productId.trim() ||
        !('quantity' in item) ||
        typeof item.quantity !== 'number' ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        throw new BadRequestException(
          'Each item needs a productId and a positive integer quantity',
        );
      }

      const productId = item.productId.trim();
      const quantity =
        (quantities.get(productId) ?? 0) + item.quantity;

      if (!Number.isSafeInteger(quantity)) {
        throw new BadRequestException('Quantity is too large');
      }

      quantities.set(productId, quantity);
    }

    // Lock products in sorted order to reduce deadlock risk
    // when orders contain multiple products.
    const productIds = [...quantities.keys()].sort();

    const result = await this.prisma.$transaction(async (tx) => {
      for (const productId of productIds) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM "Product"
          WHERE id = ${productId}
          FOR UPDATE
        `;

        if (rows.length === 0) {
          throw new BadRequestException(
            `Product ${productId} does not exist`,
          );
        }
      }

      const now = new Date();

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const reservations = await tx.orderItem.findMany({
        where: {
          productId: { in: productIds },
          order: {
            OR: [
              { status: 'PAID' },
              {
                status: 'HELD',
                expiresAt: { gt: now },
              },
            ],
          },
        },
        select: {
          productId: true,
          quantity: true,
        },
      });

      const reserved = new Map<string, number>();

      for (const item of reservations) {
        reserved.set(
          item.productId,
          (reserved.get(item.productId) ?? 0) + item.quantity,
        );
      }

      const items = products.map((product) => {
        const quantity = quantities.get(product.id)!;
        const available =
          product.stock - (reserved.get(product.id) ?? 0);

        if (quantity > available) {
          throw new ConflictException(
            `Insufficient stock for ${product.name}. Available: ${Math.max(0, available)}`,
          );
        }

        return {
          productId: product.id,
          quantity,
          pricePaise: product.pricePaise,
        };
      });

      const totalPaise = items.reduce(
        (total, item) =>
          total + item.pricePaise * item.quantity,
        0,
      );

      if (!Number.isSafeInteger(totalPaise)) {
        throw new BadRequestException('Order total is too large');
      }

      const expiresAt = new Date(
        now.getTime() + HOLD_SECONDS * 1000,
      );

      const order = await tx.order.create({
        data: {
          totalPaise,
          expiresAt,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              pricePaise: item.pricePaise,
            })),
          },
        },
        include: { items: true },
      });

      return { order, expiresAt };
    });

    return {
      id: result.order.id,
      status: result.order.status,
      totalPaise: result.order.totalPaise,
      expiresAt: result.expiresAt.toISOString(),
      expiresInSeconds: Math.max(
        0,
        Math.ceil(
          (result.expiresAt.getTime() - Date.now()) / 1000,
        ),
      ),
      items: result.order.items,
    };
  }

  async getOrderStatus(id: string) {
  return this.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "Order"
      WHERE id = ${id}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException('Order not found');
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id },
    });

    if (
      order.status === 'HELD' &&
      order.expiresAt <= new Date()
    ) {
      const expiredOrder = await tx.order.update({
        where: { id },
        data: { status: 'EXPIRED' },
      });

      return {
        id: expiredOrder.id,
        status: expiredOrder.status,
        totalPaise: expiredOrder.totalPaise,
        expiresAt: expiredOrder.expiresAt.toISOString(),
      };
    }

    return {
      id: order.id,
      status: order.status,
      totalPaise: order.totalPaise,
      expiresAt: order.expiresAt.toISOString(),
    };
  });
}
}