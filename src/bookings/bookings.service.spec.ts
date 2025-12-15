import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BookingsService } from './bookings.service';
import { SeatLock, ReservationStatus } from '../schemas/seat-lock.schema';
import { Booking } from '../schemas/booking.schema';
import { Seat } from '../schemas/seat.schema';
import { SeatsService } from '../seats/seats.service';
import { EventsService } from '../events/events.service';
import { WebSocketGateway } from '../websocket/websocket.gateway';

describe('BookingsService', () => {
  let service: BookingsService;
  let seatLockModel: Model<SeatLock>;
  let bookingModel: Model<Booking>;
  let seatModel: Model<Seat>;

  const mockSeatLockModel = {
    findById: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockBookingModel = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSeatModel = {};

  const mockSeatsService = {
    findByEventAndIds: jest.fn(),
    atomicLockSeats: jest.fn(),
    atomicConfirmSeats: jest.fn(),
    releaseSeatsByReservation: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEventsService = {
    findOne: jest.fn(),
  };

  const mockWebSocketGateway = {
    emitSeatLocked: jest.fn(),
    emitSeatReleased: jest.fn(),
    emitSeatSold: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: getModelToken(SeatLock.name),
          useValue: mockSeatLockModel,
        },
        {
          provide: getModelToken(Booking.name),
          useValue: mockBookingModel,
        },
        {
          provide: getModelToken(Seat.name),
          useValue: mockSeatModel,
        },
        {
          provide: SeatsService,
          useValue: mockSeatsService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: WebSocketGateway,
          useValue: mockWebSocketGateway,
        },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    seatLockModel = module.get<Model<SeatLock>>(getModelToken(SeatLock.name));
    bookingModel = module.get<Model<Booking>>(getModelToken(Booking.name));
    seatModel = module.get<Model<Seat>>(getModelToken(Seat.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReservation', () => {
    it('should create a reservation successfully', async () => {
      const createDto = {
        eventId: 'event1',
        seatIds: ['seat1', 'seat2'],
        holdSeconds: 300,
      };

      const mockEvent = {
        _id: 'event1',
        defaultPrice: 1000,
        commission: { type: 'percentage', value: 10 },
      };

      const mockSeats = [
        { _id: 'seat1', basePrice: 1000 },
        { _id: 'seat2', basePrice: 1000 },
      ];

      mockEventsService.findOne.mockResolvedValue(mockEvent);
      mockSeatsService.findByEventAndIds.mockResolvedValue(mockSeats);
      mockSeatsService.atomicLockSeats.mockResolvedValue({
        success: true,
        failedSeatIds: [],
      });

      const mockSave = jest.fn().mockResolvedValue({ _id: 'reservation1' });
      mockSeatLockModel.create = jest.fn().mockReturnValue({ save: mockSave });

      const result = await service.createReservation(createDto);

      expect(result).toHaveProperty('reservationId');
      expect(result).toHaveProperty('expiresAt');
      expect(mockSeatsService.atomicLockSeats).toHaveBeenCalled();
    });

    it('should fail if seats cannot be locked', async () => {
      const createDto = {
        eventId: 'event1',
        seatIds: ['seat1', 'seat2'],
      };

      const mockEvent = { _id: 'event1', defaultPrice: 1000 };
      const mockSeats = [{ _id: 'seat1' }, { _id: 'seat2' }];

      mockEventsService.findOne.mockResolvedValue(mockEvent);
      mockSeatsService.findByEventAndIds.mockResolvedValue(mockSeats);
      mockSeatsService.atomicLockSeats.mockResolvedValue({
        success: false,
        failedSeatIds: ['seat1'],
      });

      await expect(service.createReservation(createDto)).rejects.toThrow();
    });
  });
});

