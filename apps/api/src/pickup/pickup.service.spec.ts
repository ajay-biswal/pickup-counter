import { Test, TestingModule } from '@nestjs/testing';
import { PickupService } from './pickup.service.js';
import { PrismaService } from '../prisma.service.js';

describe('PickupService', () => {
  let service: PickupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupService,
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PickupService>(PickupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});