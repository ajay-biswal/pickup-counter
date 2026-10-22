
import { Controller, Param, Post } from '@nestjs/common';
import { PickupService } from './pickup.service.js';

@Controller('orders')
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Post(':id/pickup-claim')
  claim(@Param('id') id: string) {
    return this.pickupService.claim(id);
  }
}
