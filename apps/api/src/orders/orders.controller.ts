
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(@Body() body: unknown) {
    return this.ordersService.createOrder(body);
  }

  @Get(':id')
  getOrderStatus(@Param('id') id: string) {
    return this.ordersService.getOrderStatus(id);
  }
}
