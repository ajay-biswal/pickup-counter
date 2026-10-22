
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '../prisma.service.js';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject an invalid webhook signature', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

    const body = {
      eventId: 'evt-invalid-signature',
      orderId: 'order-test',
      amountPaise: 500,
      status: 'captured',
    };

    const rawBody = Buffer.from(JSON.stringify(body));

    await expect(
      service.handleWebhook(body, rawBody, '0'.repeat(64)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject a missing webhook signature', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

    const body = {
      eventId: 'evt-missing-signature',
      orderId: 'order-test',
      amountPaise: 500,
      status: 'captured',
    };

    const rawBody = Buffer.from(JSON.stringify(body));

    await expect(
      service.handleWebhook(body, rawBody, undefined),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject a signature that does not have the expected format', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';

    const body = {
      eventId: 'evt-malformed-signature',
      orderId: 'order-test',
      amountPaise: 500,
      status: 'captured',
    };

    const rawBody = Buffer.from(JSON.stringify(body));

    await expect(
      service.handleWebhook(body, rawBody, 'not-a-valid-signature'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
