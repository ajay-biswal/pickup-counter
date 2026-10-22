
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const now = new Date();

    const products = await this.prisma.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        orderItems: {
          where: {
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
            quantity: true,
          },
        },
      },
    });

    return products.map((product) => {
      const reservedUnits = product.orderItems.reduce(
        (total, item) => total + item.quantity,
        0,
      );

      return {
        id: product.id,
        name: product.name,
        pricePaise: product.pricePaise,
        availableUnits: Math.max(0, product.stock - reservedUnits),
      };
    });
  }
}
