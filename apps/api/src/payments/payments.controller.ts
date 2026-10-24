
import {  BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('simulate')
  simulatePayment(@Body() body: { orderId?: unknown }) {
    if (typeof body?.orderId !== 'string' || !body.orderId.trim()) {
      throw new BadRequestException('A valid orderId is required');
    }

    return this.paymentsService.simulatePayment(body.orderId);
  }

  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
  ) {
    return this.paymentsService.handleWebhook(
      req.body,
      req.rawBody,
      signature,
    );
  }
}
