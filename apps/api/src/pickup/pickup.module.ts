import { Module } from '@nestjs/common';
import { PickupController } from './pickup.controller.js';
import { PickupService } from './pickup.service.js';

@Module({
  controllers: [PickupController],
  providers: [PickupService]
})
export class PickupModule {}
