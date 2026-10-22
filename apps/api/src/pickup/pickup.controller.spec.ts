
import { Test, TestingModule } from '@nestjs/testing';
import { PickupController } from './pickup.controller.js';
import { PickupService } from './pickup.service.js';

describe('PickupController', () => {
  let controller: PickupController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PickupController],
      providers: [
        {
          provide: PickupService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<PickupController>(PickupController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
